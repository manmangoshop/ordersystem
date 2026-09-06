"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COOKIE_NAME, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("未授權");
}

export async function logout() {
  (await cookies()).delete(COOKIE_NAME);
  redirect("/admin/login");
}

export async function setStoreStatus(formData: FormData) {
  await requireAdmin();
  const status = z.enum(["OPEN", "CLOSED"]).parse(formData.get("status"));
  const sql = db();
  await sql`
    INSERT INTO settings(key, value, updated_at) VALUES ('store_status', ${sql.json(status)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function createProduct(formData: FormData) {
  await requireAdmin();
  const input = z.object({
    sku: z.string().trim().min(1).max(40), brandCode: z.string().trim().min(1).max(30),
    brandName: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200),
    price: z.coerce.number().int().min(0), shelfLifeDays: z.coerce.number().int().positive().optional(),
    imageUrl: z.string().trim().url().optional().or(z.literal("")),
  }).parse(Object.fromEntries(formData));
  const sql = db();
  await sql.begin(async (tx) => {
    const [brand] = await tx<{ id: string }[]>`
      INSERT INTO brands(code, name) VALUES (${input.brandCode}, ${input.brandName})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `;
    await tx`
      INSERT INTO products(sku, brand_id, name, price_cents, shelf_life_days, image_url)
      VALUES (${input.sku}, ${brand.id}, ${input.name}, ${input.price * 100}, ${input.shelfLifeDays ?? null}, ${input.imageUrl || null})
      ON CONFLICT (sku) DO UPDATE SET brand_id=EXCLUDED.brand_id, name=EXCLUDED.name,
        price_cents=EXCLUDED.price_cents, shelf_life_days=EXCLUDED.shelf_life_days,
        image_url=EXCLUDED.image_url, updated_at=now()
    `;
  });
  revalidatePath("/admin");
}

export async function receiveInventory(formData: FormData) {
  await requireAdmin();
  const optionalNumber = (maximum: number) => z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.number().finite().min(0).max(maximum).optional(),
  );
  const input = z.object({
    sku: z.string().trim().min(1),
    batchCode: z.string().trim()
      .regex(/^\d+[A-Za-z]$/, "批次編號請使用數字加一個英文字母，例如 2609A")
      .transform((value) => value.toUpperCase()),
    quantity: z.coerce.number().int().positive(),
    receivedAt: z.string().optional(), expiryDate: z.string().optional(),
    foreignUnitCost: optionalNumber(10_000_000), exchangeRate: optionalNumber(100),
    unitWeightGrams: optionalNumber(1_000_000), freightPerKg: optionalNumber(1_000_000),
    manualUnitCost: optionalNumber(10_000_000), note: z.string().trim().max(300).optional(),
  }).superRefine((value, context) => {
    const hasForeignCost = value.foreignUnitCost != null;
    const hasRate = value.exchangeRate != null;
    if (hasForeignCost !== hasRate) context.addIssue({ code: "custom", message: "日幣單價與匯率必須一起填寫" });
    const hasWeight = value.unitWeightGrams != null;
    const hasFreight = value.freightPerKg != null;
    if (hasWeight !== hasFreight) context.addIssue({ code: "custom", message: "商品重量與每公斤運費必須一起填寫" });
    if (value.manualUnitCost == null && !hasForeignCost) context.addIssue({ code: "custom", message: "請輸入日幣成本與匯率，或直接輸入台幣單位成本" });
  }).parse(Object.fromEntries(formData));

  const goodsUnitCostCents = input.foreignUnitCost != null && input.exchangeRate != null
    ? Math.round(input.foreignUnitCost * input.exchangeRate * 100)
    : null;
  const unitWeightKg = input.unitWeightGrams == null ? null : input.unitWeightGrams / 1000;
  const freightUnitCostCents = unitWeightKg != null && input.freightPerKg != null
    ? Math.round(unitWeightKg * input.freightPerKg * 100)
    : 0;
  const calculatedUnitCostCents = goodsUnitCostCents == null ? null : goodsUnitCostCents + freightUnitCostCents;
  const unitCostCents = input.manualUnitCost == null
    ? calculatedUnitCostCents
    : Math.round(input.manualUnitCost * 100);
  const sql = db();
  await sql.begin(async (tx) => {
    const [product] = await tx<{ id: string }[]>`SELECT id FROM products WHERE sku = ${input.sku} FOR UPDATE`;
    if (!product) throw new Error("找不到商品編號");
    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO inventory_batches(
        product_id, batch_code, received_at, expiry_date, received_qty, remaining_qty,
        unit_cost_cents, foreign_currency, foreign_unit_cost, exchange_rate,
        unit_weight_kg, freight_per_kg_twd, goods_unit_cost_cents, freight_unit_cost_cents, note
      ) VALUES (
        ${product.id}, ${input.batchCode}, ${input.receivedAt || null}, ${input.expiryDate || null}, ${input.quantity}, ${input.quantity},
        ${unitCostCents}, ${goodsUnitCostCents == null ? null : "JPY"}, ${input.foreignUnitCost ?? null}, ${input.exchangeRate ?? null},
        ${unitWeightKg}, ${input.freightPerKg ?? null}, ${goodsUnitCostCents}, ${freightUnitCostCents || null}, ${input.note || null}
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO inventory_movements(product_id, batch_id, movement_type, quantity, reference_type, reference_id, note)
      VALUES (${product.id}, ${batch.id}, 'purchase', ${input.quantity}, 'batch', ${batch.id}, ${input.note || null})
    `;
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function toggleProduct(formData: FormData) {
  await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));
  await db()`UPDATE products SET active = NOT active, updated_at = now() WHERE id = ${id}`;
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function updateOrderStatus(formData: FormData) {
  await requireAdmin();
  const input = z.object({ id: z.string().uuid(), status: z.enum(["pending_payment","paid","processing","shipped","completed","cancelled"]) }).parse(Object.fromEntries(formData));
  const sql = db();
  await sql.begin(async (tx) => {
    const [order] = await tx<{ status: string }[]>`SELECT status FROM orders WHERE id = ${input.id} FOR UPDATE`;
    if (!order) throw new Error("找不到訂單");
    if (order.status === "cancelled" && input.status !== "cancelled") throw new Error("取消的訂單不可直接恢復，請建立新訂單");
    if (input.status === "cancelled" && order.status !== "cancelled") {
      const allocations = await tx<{ batch_id: string; quantity: number; product_id: string }[]>`
        SELECT oa.batch_id, oa.quantity, oi.product_id FROM order_allocations oa
        JOIN order_items oi ON oi.id = oa.order_item_id WHERE oi.order_id = ${input.id}
      `;
      for (const allocation of allocations) {
        await tx`UPDATE inventory_batches SET remaining_qty = remaining_qty + ${allocation.quantity} WHERE id = ${allocation.batch_id}`;
        await tx`
          INSERT INTO inventory_movements(product_id, batch_id, movement_type, quantity, reference_type, reference_id)
          VALUES (${allocation.product_id}, ${allocation.batch_id}, 'cancel', ${allocation.quantity}, 'order', ${input.id})
        `;
      }
    }
    const payment = input.status === "paid" ? "paid" : undefined;
    const fulfillment = input.status === "shipped" ? "shipped" : input.status === "completed" ? "delivered" : input.status === "cancelled" ? "cancelled" : undefined;
    await tx`
      UPDATE orders SET status=${input.status},
        payment_status=COALESCE(${payment ?? null}, payment_status),
        fulfillment_status=COALESCE(${fulfillment ?? null}, fulfillment_status), updated_at=now()
      WHERE id=${input.id}
    `;
  });
  revalidatePath("/admin");
  revalidatePath("/");
}
