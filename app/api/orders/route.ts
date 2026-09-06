import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { calculateOrder } from "@/lib/order";
import { productDisplayName } from "@/lib/product-name";

const orderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  customerName: z.string().trim().min(1).max(80),
  customerPhone: z.string().regex(/^09\d{8}$/),
  recipientName: z.string().trim().min(1).max(80),
  recipientPhone: z.string().regex(/^09\d{8}$/),
  email: z.string().trim().email().max(200),
  lineName: z.string().trim().min(1).max(80),
  shippingMethod: z.enum(["超商取貨", "宅配到府"]),
  address: z.string().trim().min(3).max(200),
  taxId: z.string().regex(/^\d{8}$/).optional(),
  note: z.string().trim().max(500).optional(),
  items: z.array(z.object({ sku: z.string().trim().min(1).max(40), quantity: z.number().int().min(1).max(99) })).min(1).max(100),
});

function newOrderNumber() {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }).replaceAll("-", "").slice(2);
  return `MMG${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function POST(request: NextRequest) {
  const parsed = orderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "訂購資料格式不正確" }, { status: 400 });
  if (request.headers.get("idempotency-key") !== parsed.data.idempotencyKey) {
    return NextResponse.json({ error: "訂單識別碼不一致" }, { status: 400 });
  }

  const sql = db();
  try {
    const result = await sql.begin(async (tx) => {
      const [existing] = await tx<{ order_number: string; total_cents: number }[]>`
        SELECT order_number, total_cents FROM orders WHERE idempotency_key = ${parsed.data.idempotencyKey}
      `;
      if (existing) return { orderNumber: existing.order_number, total: existing.total_cents };

      const [setting] = await tx<{ value: string }[]>`SELECT value #>> '{}' AS value FROM settings WHERE key = 'store_status'`;
      if (setting?.value === "CLOSED") throw new Error("STORE_CLOSED");

      const combined = new Map<string, number>();
      for (const item of parsed.data.items) combined.set(item.sku, (combined.get(item.sku) ?? 0) + item.quantity);
      const skus = [...combined.keys()];
      const rawProducts = await tx<{ id: string; sku: string; name: string; brand: string; price_cents: number }[]>`
        SELECT p.id, p.sku, p.name, COALESCE(b.name, '') brand, p.price_cents
        FROM products p LEFT JOIN brands b ON b.id=p.brand_id
        WHERE p.sku IN ${tx(skus)} AND p.active = true
        FOR UPDATE OF p
      `;
      if (rawProducts.length !== skus.length) throw new Error("PRODUCT_NOT_FOUND");
      const products = rawProducts.map((product) => ({
        ...product,
        name: productDisplayName(product.brand, product.name),
      }));

      const pricedItems = products.map((p) => ({ sku: p.sku, name: p.name, priceCents: p.price_cents, quantity: combined.get(p.sku)! }));
      const totals = calculateOrder(pricedItems, parsed.data.shippingMethod, Boolean(parsed.data.taxId));
      const orderNumber = newOrderNumber();
      const [order] = await tx<{ id: string }[]>`
        INSERT INTO orders (
          order_number, idempotency_key, customer_name, customer_phone, recipient_name,
          recipient_phone, email, line_name, shipping_method, address, tax_id, note,
          subtotal_cents, discount_cents, tax_cents, shipping_cents, total_cents
        ) VALUES (
          ${orderNumber}, ${parsed.data.idempotencyKey}, ${parsed.data.customerName}, ${parsed.data.customerPhone},
          ${parsed.data.recipientName}, ${parsed.data.recipientPhone}, ${parsed.data.email}, ${parsed.data.lineName},
          ${parsed.data.shippingMethod}, ${parsed.data.address}, ${parsed.data.taxId ?? null}, ${parsed.data.note ?? null},
          ${totals.subtotal}, ${totals.discount}, ${totals.tax}, ${totals.shipping}, ${totals.total}
        ) RETURNING id
      `;

      for (const product of products) {
        const quantity = combined.get(product.sku)!;
        const batches = await tx<{ id: string; remaining_qty: number }[]>`
          SELECT id, remaining_qty FROM inventory_batches
          WHERE product_id = ${product.id} AND remaining_qty > 0
            AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
          ORDER BY expiry_date ASC NULLS LAST, received_at ASC NULLS LAST, created_at
          FOR UPDATE
        `;
        if (batches.reduce((sum, b) => sum + b.remaining_qty, 0) < quantity) throw new Error(`OUT_OF_STOCK:${product.name}`);

        const [item] = await tx<{ id: string }[]>`
          INSERT INTO order_items (order_id, product_id, sku, product_name, unit_price_cents, quantity, line_total_cents)
          VALUES (${order.id}, ${product.id}, ${product.sku}, ${product.name}, ${product.price_cents}, ${quantity}, ${product.price_cents * quantity})
          RETURNING id
        `;
        let pending = quantity;
        for (const batch of batches) {
          if (pending === 0) break;
          const allocated = Math.min(pending, batch.remaining_qty);
          await tx`UPDATE inventory_batches SET remaining_qty = remaining_qty - ${allocated} WHERE id = ${batch.id}`;
          await tx`INSERT INTO order_allocations (order_item_id, batch_id, quantity) VALUES (${item.id}, ${batch.id}, ${allocated})`;
          await tx`
            INSERT INTO inventory_movements (product_id, batch_id, movement_type, quantity, reference_type, reference_id)
            VALUES (${product.id}, ${batch.id}, 'sale', ${-allocated}, 'order', ${order.id})
          `;
          pending -= allocated;
        }
      }
      return { orderNumber, total: totals.total };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "STORE_CLOSED") return NextResponse.json({ error: "目前暫停接單" }, { status: 409 });
    if (message === "PRODUCT_NOT_FOUND") return NextResponse.json({ error: "部分商品已下架，請重新整理" }, { status: 409 });
    if (message.startsWith("OUT_OF_STOCK:")) return NextResponse.json({ error: `${message.slice(13)} 庫存不足，請重新整理` }, { status: 409 });
    console.error("create order", error);
    return NextResponse.json({ error: "訂單建立失敗，請稍後再試" }, { status: 500 });
  }
}
