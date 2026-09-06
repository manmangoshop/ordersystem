import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = db();
    const [setting] = await sql<{ value: string }[]>`SELECT value #>> '{}' AS value FROM settings WHERE key = 'store_status'`;
    const products = await sql<{
      sku: string; name: string; brand: string; price: number; stock: number;
      imageUrl: string | null; shelfLifeDays: number | null;
    }[]>`
      SELECT p.sku, p.name, COALESCE(b.name, '') AS brand,
        p.price_cents AS price, COALESCE(SUM(ib.remaining_qty), 0)::int AS stock,
        p.image_url AS "imageUrl", p.shelf_life_days AS "shelfLifeDays"
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN inventory_batches ib ON ib.product_id = p.id AND ib.remaining_qty > 0
        AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
      WHERE p.active = true
      GROUP BY p.id, b.name, b.display_order
      HAVING COALESCE(SUM(ib.remaining_qty), 0) > 0
      ORDER BY b.display_order, p.display_order, p.name
    `;
    return NextResponse.json({ status: setting?.value === "CLOSED" ? "CLOSED" : "OPEN", products });
  } catch (error) {
    console.error("catalog", error);
    return NextResponse.json({ error: "目前無法讀取商品" }, { status: 500 });
  }
}
