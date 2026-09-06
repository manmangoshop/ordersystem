import { db } from "@/lib/db";
import { createProduct, setStoreStatus, toggleProduct, updateOrderStatus } from "./actions";
import InventoryForm from "./inventory-form";

export const dynamic = "force-dynamic";

const money = (cents: number) => `NT$ ${(cents / 100).toLocaleString("zh-TW")}`;
const statusLabel: Record<string, string> = {
  pending_payment: "待付款", paid: "已付款", processing: "處理中", shipped: "已出貨", completed: "已完成", cancelled: "已取消",
};

export default async function AdminPage() {
  const sql = db();
  const [[setting], [metrics], products, orders, batches] = await Promise.all([
    sql<{ value: string }[]>`SELECT value #>> '{}' AS value FROM settings WHERE key='store_status'`,
    sql<{ orders_today: number; revenue_month: number; low_stock: number; pending: number; expired_stock: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM orders WHERE created_at >= date_trunc('day', now()) AND status <> 'cancelled') AS orders_today,
        (SELECT COALESCE(SUM(total_cents),0)::int FROM orders WHERE created_at >= date_trunc('month', now()) AND status <> 'cancelled') AS revenue_month,
        (SELECT COUNT(*)::int FROM (
          SELECT p.id FROM products p LEFT JOIN inventory_batches ib ON ib.product_id=p.id
            AND ib.remaining_qty>0 AND (ib.expiry_date IS NULL OR ib.expiry_date>=CURRENT_DATE)
          WHERE p.active=true GROUP BY p.id HAVING COALESCE(SUM(ib.remaining_qty),0) <= 3
        ) x) AS low_stock,
        (SELECT COUNT(*)::int FROM orders WHERE status='pending_payment') AS pending,
        (SELECT COALESCE(SUM(remaining_qty),0)::int FROM inventory_batches
          WHERE remaining_qty>0 AND expiry_date<CURRENT_DATE) AS expired_stock
    `,
    sql<{ id: string; sku: string; name: string; brand: string; price_cents: number; active: boolean; sellable_stock: number; expired_stock: number; nearest_expiry: string | null }[]>`
      SELECT p.id,p.sku,p.name,COALESCE(b.name,'') brand,p.price_cents,p.active,
        COALESCE(SUM(ib.remaining_qty) FILTER (WHERE ib.expiry_date IS NULL OR ib.expiry_date>=CURRENT_DATE),0)::int sellable_stock,
        COALESCE(SUM(ib.remaining_qty) FILTER (WHERE ib.expiry_date<CURRENT_DATE),0)::int expired_stock,
        MIN(ib.expiry_date) FILTER (WHERE ib.expiry_date>=CURRENT_DATE)::text nearest_expiry
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id
      LEFT JOIN inventory_batches ib ON ib.product_id=p.id AND ib.remaining_qty>0
      GROUP BY p.id,b.name ORDER BY p.active DESC,b.name,p.name LIMIT 300
    `,
    sql<{ id: string; order_number: string; customer_name: string; total_cents: number; status: string; created_at: string; item_count: number }[]>`
      SELECT o.id,o.order_number,o.customer_name,o.total_cents,o.status,o.created_at::text,
        COALESCE(SUM(oi.quantity),0)::int item_count
      FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
      GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100
    `,
    sql<{ batch_code: string; sku: string; name: string; received_at: string | null; received_qty: number; remaining_qty: number; foreign_unit_cost: string | null; exchange_rate: string | null; unit_weight_kg: string | null; freight_per_kg_twd: string | null; unit_cost_cents: number | null }[]>`
      SELECT ib.batch_code,p.sku,p.name,ib.received_at::text,ib.received_qty,ib.remaining_qty,
        ib.foreign_unit_cost::text,ib.exchange_rate::text,ib.unit_weight_kg::text,
        ib.freight_per_kg_twd::text,ib.unit_cost_cents
      FROM inventory_batches ib JOIN products p ON p.id=ib.product_id
      ORDER BY ib.created_at DESC LIMIT 50
    `,
  ]);

  return <main className="shell admin-main">
    <div className="panel-head">
      <div><div className="eyebrow">OPERATIONS</div><h1>營運總覽</h1></div>
      <form action={setStoreStatus}>
        <input type="hidden" name="status" value={setting?.value === "CLOSED" ? "OPEN" : "CLOSED"} />
        <button className={setting?.value === "CLOSED" ? "primary" : "danger"}>{setting?.value === "CLOSED" ? "開放網站接單" : "暫停網站接單"}</button>
      </form>
    </div>

    <section className="stats">
      <div className="stat"><span>今日訂單</span><strong>{metrics.orders_today}</strong></div>
      <div className="stat"><span>本月營業額</span><strong>{money(metrics.revenue_month)}</strong></div>
      <div className="stat"><span>低庫存商品</span><strong>{metrics.low_stock}</strong></div>
      <div className="stat"><span>待付款</span><strong>{metrics.pending}</strong></div>
      <div className="stat"><span>已過期庫存</span><strong>{metrics.expired_stock}</strong></div>
    </section>

    <section className="panel">
      <div className="panel-head"><h2>最新訂單</h2><span className="badge">最近 100 筆</span></div>
      <table><thead><tr><th>訂單</th><th>日期</th><th>顧客</th><th>件數</th><th>金額</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.id}>
          <td><b>{order.order_number}</b></td><td>{new Date(order.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</td><td>{order.customer_name}</td><td>{order.item_count}</td><td>{money(order.total_cents)}</td><td><span className={`badge ${order.status === "completed" ? "ok" : order.status === "pending_payment" ? "warn" : ""}`}>{statusLabel[order.status]}</span></td>
          <td><form action={updateOrderStatus} style={{ display: "flex", gap: 6 }}><input type="hidden" name="id" value={order.id} /><select className="field" name="status" defaultValue={order.status}>{Object.entries(statusLabel).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><button className="secondary">更新</button></form></td>
        </tr>)}</tbody>
      </table>
      {orders.length === 0 && <div className="empty">尚無訂單</div>}
    </section>

    <section className="panel">
      <div className="panel-head"><h2>商品與即時庫存</h2><span className="badge">{products.length} 項</span></div>
      <table><thead><tr><th>商品編號</th><th>品牌／商品</th><th>售價</th><th>可售庫存</th><th>已過期</th><th>最近到期</th><th>狀態</th></tr></thead>
        <tbody>{products.map((product) => <tr key={product.id}><td><b>{product.sku}</b></td><td>{product.brand}<br />{product.name}</td><td>{money(product.price_cents)}</td><td><span className={`badge ${product.sellable_stock <= 3 ? "warn" : "ok"}`}>{product.sellable_stock}</span></td><td><span className={`badge ${product.expired_stock > 0 ? "warn" : ""}`}>{product.expired_stock}</span></td><td>{product.nearest_expiry || "—"}</td><td><form action={toggleProduct}><input type="hidden" name="id" value={product.id} /><button className={product.active ? "secondary" : "danger"}>{product.active ? "販售中" : "已下架"}</button></form></td></tr>)}</tbody>
      </table>
    </section>

    <section className="panel">
      <h2>登記進貨</h2>
      <InventoryForm products={products.map(({ sku, name }) => ({ sku, name }))} />
    </section>

    <section className="panel">
      <div className="panel-head"><h2>最近進貨批次</h2><span className="badge">最近 50 筆</span></div>
      <table><thead><tr><th>批次</th><th>商品</th><th>進貨日</th><th>數量／剩餘</th><th>日幣單價／匯率</th><th>重量／公斤運費</th><th>最終單位成本</th></tr></thead>
        <tbody>{batches.map((batch) => <tr key={batch.batch_code}>
          <td><b>{batch.batch_code}</b></td><td>{batch.sku}<br />{batch.name}</td><td>{batch.received_at || "—"}</td>
          <td>{batch.received_qty}／{batch.remaining_qty}</td>
          <td>{batch.foreign_unit_cost == null ? "—" : `¥${Number(batch.foreign_unit_cost).toLocaleString("zh-TW")}／${Number(batch.exchange_rate).toFixed(4)}`}</td>
          <td>{batch.unit_weight_kg == null ? "—" : `${Number(batch.unit_weight_kg) * 1000}g／NT$${Number(batch.freight_per_kg_twd).toLocaleString("zh-TW")}`}</td>
          <td>{batch.unit_cost_cents == null ? "—" : money(batch.unit_cost_cents)}</td>
        </tr>)}</tbody>
      </table>
    </section>

    <section className="panel">
      <h2>新增或更新商品</h2>
      <form action={createProduct} className="form-grid">
        <div className="form-group"><label>商品編號</label><input className="field" name="sku" required /></div>
        <div className="form-group"><label>商品名稱</label><input className="field" name="name" required /></div>
        <div className="form-group"><label>品牌代號</label><input className="field" name="brandCode" required /></div>
        <div className="form-group"><label>品牌名稱</label><input className="field" name="brandName" required /></div>
        <div className="form-group"><label>售價（元）</label><input className="field" name="price" type="number" min="0" required /></div>
        <div className="form-group"><label>保存天數</label><input className="field" name="shelfLifeDays" type="number" min="1" /></div>
        <div className="form-group full"><label>商品圖片網址</label><input className="field" name="imageUrl" type="url" /></div>
        <div><button className="primary">儲存商品</button></div>
      </form>
    </section>
  </main>;
}
