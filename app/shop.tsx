"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type Product = {
  sku: string;
  name: string;
  brand: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  shelfLifeDays: number | null;
};

type Cart = Record<string, number>;
type CatalogResponse = { status: "OPEN" | "CLOSED"; products: Product[] };

const money = (cents: number) => `NT$ ${(cents / 100).toLocaleString("zh-TW")}`;

export default function Shop() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("全部");
  const [checkout, setCheckout] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  useEffect(() => {
    fetch("/api/catalog", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("無法讀取商品");
        return response.json();
      })
      .then(setCatalog)
      .catch(() => setError("目前無法讀取商品，請稍後再試。"));
    const saved = localStorage.getItem("manmango-cart");
    if (saved) {
      try {
        const restored = JSON.parse(saved);
        queueMicrotask(() => setCart(restored));
      } catch { localStorage.removeItem("manmango-cart"); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("manmango-cart", JSON.stringify(cart));
  }, [cart]);

  const products = useMemo(() => catalog?.products ?? [], [catalog]);
  const brands = useMemo(() => ["全部", ...Array.from(new Set(products.map((p) => p.brand)))], [products]);
  const visible = products.filter((product) => {
    const keyword = search.trim().toLowerCase();
    return (brand === "全部" || product.brand === brand) &&
      (!keyword || `${product.name} ${product.sku} ${product.brand}`.toLowerCase().includes(keyword));
  });
  const selected = products.filter((p) => (cart[p.sku] ?? 0) > 0);
  const itemCount = selected.reduce((sum, p) => sum + cart[p.sku], 0);
  const subtotal = selected.reduce((sum, p) => sum + p.price * cart[p.sku], 0);
  const estimatedDiscount = itemCount >= 2 ? Math.round(subtotal * .05) : 0;

  function changeQty(product: Product, delta: number) {
    setCart((current) => ({
      ...current,
      [product.sku]: Math.max(0, Math.min(product.stock, (current[product.sku] ?? 0) + delta)),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const idempotencyKey = crypto.randomUUID();
    const body = {
      idempotencyKey,
      customerName: form.get("customerName"),
      customerPhone: form.get("customerPhone"),
      recipientName: form.get("recipientName"),
      recipientPhone: form.get("recipientPhone"),
      email: form.get("email"),
      lineName: form.get("lineName"),
      shippingMethod: form.get("shippingMethod"),
      address: form.get("address"),
      taxId: form.get("taxId") || undefined,
      note: form.get("note") || undefined,
      items: selected.map((p) => ({ sku: p.sku, quantity: cart[p.sku] })),
    };
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "訂單建立失敗");
      setOrderNumber(result.orderNumber);
      setCart({});
      localStorage.removeItem("manmango-cart");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "訂單建立失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <nav className="topbar">
        <div className="shell topbar-inner">
          <div className="brand">満満菓 <small>MANMANGO SHOP</small></div>
          <button className="cart-pill" onClick={() => itemCount > 0 && setCheckout(true)}>購物袋 · {itemCount}</button>
        </div>
      </nav>

      <header className="hero">
        <div className="shell hero-grid">
          <div>
            <div className="eyebrow">FROM JAPAN, WITH DELIGHT</div>
            <h1>把旅途中的好味道，帶回日常。</h1>
            <p>精選日本人氣伴手禮與季節限定商品。庫存與訂單由新系統即時確認，送出前會再次核對數量與價格。</p>
          </div>
          <div className="hero-note"><strong>全館任選兩件 95 折</strong><br />超商滿 $1,500 免運，宅配滿 $3,000 免運。</div>
        </div>
      </header>

      <main className="shell catalog">
        <div className="toolbar">
          <input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋品牌、商品或編號" aria-label="搜尋商品" />
          <span>{visible.length} 項商品</span>
        </div>
        <div className="filter-row">
          {brands.map((item) => <button key={item} className={`filter ${brand === item ? "active" : ""}`} onClick={() => setBrand(item)}>{item}</button>)}
        </div>

        {!catalog && !error && <div className="empty">正在讀取商品…</div>}
        {error && !checkout && <div className="notice">{error}</div>}
        {catalog?.status === "CLOSED" && <div className="empty">目前暫停接單，請稍後再回來看看。</div>}
        {catalog?.status === "OPEN" && <div className="product-grid">
          {visible.map((product) => (
            <article className="product-card" key={product.sku}>
              <div className="product-image">{product.imageUrl && <Image src={product.imageUrl} alt={product.name} fill sizes="(max-width: 560px) 100vw, (max-width: 800px) 50vw, 33vw" unoptimized />}</div>
              <div className="product-body">
                <div className="product-brand">{product.brand} · {product.sku}</div>
                <h3>{product.name}</h3>
                <div className="product-meta">
                  <div><span className="price">{money(product.price)}</span><span className="stock">庫存 {product.stock} 件</span></div>
                  <div className="qty"><button onClick={() => changeQty(product, -1)} aria-label={`減少 ${product.name}`}>−</button><span>{cart[product.sku] ?? 0}</span><button onClick={() => changeQty(product, 1)} aria-label={`增加 ${product.name}`}>＋</button></div>
                </div>
              </div>
            </article>
          ))}
        </div>}
      </main>

      {itemCount > 0 && <div className="cart-bar">
        <div className="cart-total">{itemCount} 件商品 · 預估折扣後<strong>{money(subtotal - estimatedDiscount)}</strong></div>
        <button onClick={() => setCheckout(true)}>填寫訂購資料</button>
      </div>}

      {checkout && <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal">
          {orderNumber ? <div className="success-box">
            <div className="eyebrow">訂單建立完成</div><h2>謝謝你的訂購</h2>
            <div className="order-number">{orderNumber}</div>
            <p>訂單確認資訊將寄至你的電子信箱。請保存訂單編號，以便付款與查詢。</p>
            <button className="primary" onClick={() => { setCheckout(false); setOrderNumber(""); }}>回到商品頁</button>
          </div> : <>
            <div className="modal-head"><div><div className="eyebrow">CHECKOUT</div><h2>訂購資料</h2></div><button className="close" onClick={() => setCheckout(false)} aria-label="關閉">×</button></div>
            <form onSubmit={submit}>
              <div className="form-grid">
                <div className="form-group"><label>訂購姓名</label><input className="field" name="customerName" required maxLength={80} /></div>
                <div className="form-group"><label>聯絡電話</label><input className="field" name="customerPhone" required pattern="09[0-9]{8}" placeholder="09xxxxxxxx" /></div>
                <div className="form-group"><label>收件姓名</label><input className="field" name="recipientName" required maxLength={80} /></div>
                <div className="form-group"><label>收件電話</label><input className="field" name="recipientPhone" required pattern="09[0-9]{8}" placeholder="09xxxxxxxx" /></div>
                <div className="form-group"><label>電子郵件</label><input className="field" name="email" type="email" required /></div>
                <div className="form-group"><label>LINE 名稱</label><input className="field" name="lineName" required maxLength={80} /></div>
                <div className="form-group"><label>配送方式</label><select className="field" name="shippingMethod" required defaultValue="超商取貨"><option>超商取貨</option><option>宅配到府</option></select></div>
                <div className="form-group"><label>統一編號（選填）</label><input className="field" name="taxId" pattern="[0-9]{8}" /></div>
                <div className="form-group full"><label>地址／超商門市與店號</label><input className="field" name="address" required maxLength={200} /></div>
                <div className="form-group full"><label>備註（選填）</label><textarea className="field" name="note" rows={3} maxLength={500} /></div>
              </div>
              <div className="summary">
                {selected.map((p) => <div className="summary-row" key={p.sku}><span>{p.name} × {cart[p.sku]}</span><b>{money(p.price * cart[p.sku])}</b></div>)}
                {estimatedDiscount > 0 && <div className="summary-row"><span>任選兩件 95 折</span><b>− {money(estimatedDiscount)}</b></div>}
                <div className="summary-row total"><span>商品折扣後</span><span>{money(subtotal - estimatedDiscount)}</span></div>
              </div>
              {error && <p className="error">{error}</p>}
              <p className="notice">送出後，後端會用即時庫存與售價重新計算；最終金額包含所選配送方式的運費。</p>
              <button className="primary" style={{ width: "100%", marginTop: 16 }} disabled={submitting}>{submitting ? "正在建立訂單…" : "確認送出訂單"}</button>
            </form>
          </>}
        </div>
      </div>}
    </>
  );
}
