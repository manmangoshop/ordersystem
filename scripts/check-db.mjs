import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL");
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

try {
  const [summary] = await sql`
    SELECT
      (SELECT count(*)::int FROM brands) AS brands,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM inventory_batches) AS batches,
      (SELECT coalesce(sum(remaining_qty), 0)::int FROM inventory_batches) AS stock,
      (SELECT coalesce(sum(remaining_qty), 0)::int FROM inventory_batches
        WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE) AS sellable_stock,
      (SELECT coalesce(sum(remaining_qty), 0)::int FROM inventory_batches
        WHERE expiry_date < CURRENT_DATE) AS expired_stock,
      (SELECT count(*)::int FROM orders) AS orders,
      (SELECT count(*)::int FROM order_items) AS order_items,
      (SELECT count(*)::int FROM orders WHERE created_at::date = CURRENT_DATE) AS orders_today,
      (SELECT min(created_at)::date FROM orders) AS first_order_date,
      (SELECT max(created_at)::date FROM orders) AS latest_order_date
  `;
  const [integrity] = await sql`
    SELECT
      count(*) FILTER (WHERE remaining_qty < 0)::int AS negative_batches,
      count(*) FILTER (WHERE remaining_qty > received_qty)::int AS overfilled_batches
    FROM inventory_batches
  `;
  console.log(JSON.stringify({ summary, integrity }, null, 2));
} finally {
  await sql.end();
}
