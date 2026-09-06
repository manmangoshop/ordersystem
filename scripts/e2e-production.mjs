import { randomUUID } from "node:crypto";
import postgres from "postgres";

const baseUrl = process.env.BASE_URL;
if (!baseUrl || !process.env.DATABASE_URL) throw new Error("缺少 BASE_URL 或 DATABASE_URL");

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
let orderId = null;
let orderNumber = null;

try {
  const [product] = await sql`
    SELECT p.sku, sum(ib.remaining_qty)::int AS stock
    FROM products p JOIN inventory_batches ib ON ib.product_id = p.id
    WHERE p.active = true AND ib.remaining_qty > 0
      AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
    GROUP BY p.id ORDER BY sum(ib.remaining_qty), p.sku LIMIT 1
  `;
  if (!product) throw new Error("沒有可用於測試的庫存商品");

  const idempotencyKey = randomUUID();
  const payload = {
    idempotencyKey,
    customerName: "系統測試",
    customerPhone: "0900000000",
    recipientName: "系統測試",
    recipientPhone: "0900000000",
    email: "system-test@example.com",
    lineName: "system-test",
    shippingMethod: "超商取貨",
    address: "系統測試門市",
    note: "自動驗證後立即清除",
    items: [{ sku: product.sku, quantity: 1 }],
  };

  const submit = () => fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  const first = await submit();
  const firstBody = await first.json();
  if (first.status !== 201) throw new Error(`建立訂單失敗：${first.status} ${JSON.stringify(firstBody)}`);
  orderNumber = firstBody.orderNumber;

  const second = await submit();
  const secondBody = await second.json();
  if (second.status !== 201 || secondBody.orderNumber !== orderNumber) throw new Error("重複送單保護驗證失敗");

  const [order] = await sql`SELECT id FROM orders WHERE idempotency_key = ${idempotencyKey}`;
  if (!order) throw new Error("找不到剛建立的訂單");
  orderId = order.id;
  const [{ stock: afterStock }] = await sql`
    SELECT coalesce(sum(ib.remaining_qty), 0)::int AS stock
    FROM inventory_batches ib JOIN products p ON p.id = ib.product_id WHERE p.sku = ${product.sku}
  `;
  if (afterStock !== product.stock - 1) throw new Error("訂單沒有正確扣除庫存");

  console.log(JSON.stringify({ orderCreated: true, idempotencyPassed: true, stockDeducted: true, orderNumber }));
} finally {
  if (orderId) {
    await sql.begin(async (tx) => {
      const allocations = await tx`
        SELECT oa.batch_id, oa.quantity FROM order_allocations oa
        JOIN order_items oi ON oi.id = oa.order_item_id WHERE oi.order_id = ${orderId}
      `;
      for (const allocation of allocations) {
        await tx`UPDATE inventory_batches SET remaining_qty = remaining_qty + ${allocation.quantity} WHERE id = ${allocation.batch_id}`;
      }
      await tx`DELETE FROM inventory_movements WHERE reference_type = 'order' AND reference_id = ${orderId}`;
      await tx`DELETE FROM orders WHERE id = ${orderId}`;
    });
    console.log(JSON.stringify({ testOrderRemoved: true, stockRestored: true, orderNumber }));
  }
  await sql.end();
}
