import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import postgres from "postgres";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("用法：npm run import:xlsx -- /path/to/商品主檔.xlsx");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(path.resolve(sourcePath));

const inventorySheet = workbook.getWorksheet("商品進貨明細");
const salesSheet = workbook.getWorksheet("銷售明細");
if (!inventorySheet) throw new Error("找不到「商品進貨明細」分頁");

const legacyProducts = new Map();
try {
  const html = await fs.readFile(path.join(process.cwd(), "legacy/index.html"), "utf8");
  const itemPattern = /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*price:\s*(\d+),\s*life:\s*"([^"]*)",\s*img:\s*"([^"]*)"\s*\}/g;
  for (const match of html.matchAll(itemPattern)) {
    legacyProducts.set(match[1], { name: match[2], price: Number(match[3]), life: match[4], imageUrl: match[5] });
  }
} catch {
  console.warn("找不到舊版網頁，商品圖片將不匯入");
}

function numberValue(cell) {
  const raw = cell.value;
  const candidate = raw && typeof raw === "object" && "result" in raw ? raw.result : raw ?? cell.text ?? 0;
  const value = Number(candidate);
  return Number.isFinite(value) ? value : 0;
}

function dateValue(cell) {
  const value = cell.value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = cell.text?.trim();
  if (!text) return null;
  const compact = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const productByBatch = new Map();
const remainingByRow = new Map();
let productCount = 0;
let batchCount = 0;

const inventoryGroups = new Map();
for (let rowNumber = 6; rowNumber <= inventorySheet.rowCount; rowNumber++) {
  const row = inventorySheet.getRow(rowNumber);
  const sku = row.getCell(3).text.trim();
  const batchCode = row.getCell(4).text.trim();
  if (!sku || !batchCode) continue;
  const stockCell = row.getCell(16);
  const groupKey = stockCell.master.address;
  const group = inventoryGroups.get(groupKey) || {
    totalRemaining: Math.max(0, Math.round(numberValue(stockCell.master))),
    rows: [],
  };
  group.rows.push({ rowNumber, receivedQty: Math.max(0, Math.round(numberValue(row.getCell(10)))) });
  inventoryGroups.set(groupKey, group);
}

for (const group of inventoryGroups.values()) {
  let unallocated = group.totalRemaining;
  const receivedRows = group.rows.filter((item) => item.receivedQty > 0).reverse();
  for (const item of receivedRows) {
    const remaining = Math.min(item.receivedQty, unallocated);
    remainingByRow.set(item.rowNumber, remaining);
    unallocated -= remaining;
  }
  if (unallocated > 0 && receivedRows.length > 0) {
    const newest = receivedRows[0];
    remainingByRow.set(newest.rowNumber, (remainingByRow.get(newest.rowNumber) || 0) + unallocated);
  } else if (unallocated > 0 && group.rows.length > 0) {
    remainingByRow.set(group.rows[group.rows.length - 1].rowNumber, unallocated);
  }
}

try {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM inventory_movements WHERE reference_type='migration'`;
    for (let rowNumber = 6; rowNumber <= inventorySheet.rowCount; rowNumber++) {
      const row = inventorySheet.getRow(rowNumber);
      const brandCode = row.getCell(2).text.trim();
      const sku = row.getCell(3).text.trim();
      const batchCode = row.getCell(4).text.trim();
      const sheetName = row.getCell(5).text.trim();
      if (!sku || !sheetName) continue;

      const legacy = legacyProducts.get(sku);
      const brandName = sheetName.split(/\s+/).filter(Boolean).slice(0, 2).join(" ") || brandCode;
      const [brand] = await tx`
        INSERT INTO brands(code, name) VALUES (${brandCode || sku.replace(/\d.*/, "")}, ${brandName})
        ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id
      `;
      const sheetPrice = Math.round(numberValue(row.getCell(34)));
      const price = legacy?.price || sheetPrice;
      const shelfLifeDays = Number.parseInt(row.getCell(6).text, 10) || null;
      const weight = numberValue(row.getCell(7)) || null;
      const [product] = await tx`
        INSERT INTO products(sku, brand_id, name, price_cents, shelf_life_days, weight_kg, image_url)
        VALUES (${sku}, ${brand.id}, ${legacy?.name || sheetName}, ${price * 100}, ${shelfLifeDays}, ${weight}, ${legacy?.imageUrl || null})
        ON CONFLICT (sku) DO UPDATE SET brand_id=EXCLUDED.brand_id, name=EXCLUDED.name,
          price_cents=EXCLUDED.price_cents, shelf_life_days=EXCLUDED.shelf_life_days,
          weight_kg=EXCLUDED.weight_kg, image_url=COALESCE(EXCLUDED.image_url,products.image_url), updated_at=now()
        RETURNING id
      `;
      productCount++;
      if (batchCode) productByBatch.set(batchCode, { id: product.id, sku, name: legacy?.name || sheetName });

      const receivedQty = Math.max(0, Math.round(numberValue(row.getCell(10))));
      const remainingQty = remainingByRow.get(rowNumber) || 0;
      if (!batchCode || (receivedQty === 0 && remainingQty === 0)) continue;
      const [batch] = await tx`
        INSERT INTO inventory_batches(product_id,batch_code,received_at,expiry_date,received_qty,remaining_qty,unit_cost_cents,exchange_rate,note)
        VALUES (${product.id},${batchCode},${dateValue(row.getCell(8))},${dateValue(row.getCell(9))},
          ${Math.max(receivedQty, remainingQty)},${remainingQty},${Math.round(numberValue(row.getCell(32)) * 100) || null},
          ${numberValue(row.getCell(26)) || null},'由 Google 試算表匯入')
        ON CONFLICT (batch_code) DO UPDATE SET product_id=EXCLUDED.product_id,received_at=EXCLUDED.received_at,
          expiry_date=EXCLUDED.expiry_date,received_qty=EXCLUDED.received_qty,remaining_qty=EXCLUDED.remaining_qty,
          unit_cost_cents=EXCLUDED.unit_cost_cents,exchange_rate=EXCLUDED.exchange_rate
        RETURNING id
      `;
      if (remainingQty > 0) {
        await tx`
          INSERT INTO inventory_movements(product_id,batch_id,movement_type,quantity,reference_type,reference_id,note)
          VALUES (${product.id},${batch.id},'adjustment',${remainingQty},'migration',${batch.id},'初始庫存匯入')
        `;
      }
      batchCount++;
    }

    if (salesSheet) {
      await tx`DELETE FROM orders WHERE idempotency_key LIKE 'legacy:%'`;
      const itemColumns = [21, 25, 29, 33, 37];
      for (let rowNumber = 8; rowNumber <= salesSheet.rowCount; rowNumber++) {
        const row = salesSheet.getRow(rowNumber);
        const orderNumber = row.getCell(6).text.trim();
        if (!orderNumber) continue;
        const [exists] = await tx`SELECT id FROM orders WHERE order_number=${orderNumber}`;
        if (exists) continue;
        const total = Math.max(0, Math.round(numberValue(row.getCell(12)) * 100));
        const [order] = await tx`
          INSERT INTO orders(order_number,idempotency_key,source,status,customer_name,customer_phone,recipient_name,
            recipient_phone,email,line_name,shipping_method,address,subtotal_cents,total_cents,payment_status,fulfillment_status,created_at)
          VALUES (${orderNumber},${`legacy:${orderNumber}`},${row.getCell(1).text.trim() || "歷史資料"},'completed',
            ${row.getCell(9).text.trim() || "歷史顧客"},'',${row.getCell(9).text.trim() || "歷史顧客"},'','','','超商取貨','',${total},${total},'paid','delivered',
            COALESCE(${dateValue(row.getCell(3))}::date, CURRENT_DATE)) RETURNING id
        `;
        for (const column of itemColumns) {
          const batchCode = row.getCell(column).text.trim();
          const quantity = Math.round(numberValue(row.getCell(column + 2)));
          if (!batchCode || quantity <= 0) continue;
          const mapped = productByBatch.get(batchCode);
          if (!mapped) continue;
          const lineTotal = Math.round(numberValue(row.getCell(column + 3)) * 100);
          await tx`
            INSERT INTO order_items(order_id,product_id,sku,product_name,unit_price_cents,quantity,line_total_cents)
            VALUES (${order.id},${mapped.id},${mapped.sku},${mapped.name},${Math.round(lineTotal / quantity)},${quantity},${lineTotal})
          `;
        }
      }
    }
  });
  console.log(`匯入完成：處理 ${productCount} 筆商品／批次列、${batchCount} 個有庫存批次`);
} finally {
  await sql.end();
}
