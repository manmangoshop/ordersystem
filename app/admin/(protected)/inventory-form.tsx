"use client";

import { useMemo, useState } from "react";
import { receiveInventory } from "./actions";

type ProductOption = { sku: string; name: string };

const numberOrZero = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const money = (value: number) => `NT$ ${value.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roundToCents = (value: number) => Math.round(value * 100) / 100;

export default function InventoryForm({ products }: { products: ProductOption[] }) {
  const [quantity, setQuantity] = useState("1");
  const [foreignUnitCost, setForeignUnitCost] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [weightGrams, setWeightGrams] = useState("");
  const [freightPerKg, setFreightPerKg] = useState("");
  const [manualUnitCost, setManualUnitCost] = useState("");

  const calculation = useMemo(() => {
    const qty = Math.max(1, Math.floor(numberOrZero(quantity)));
    const goods = roundToCents(numberOrZero(foreignUnitCost) * numberOrZero(exchangeRate));
    const freight = roundToCents(numberOrZero(weightGrams) / 1000 * numberOrZero(freightPerKg));
    const automatic = goods + freight;
    const finalUnit = manualUnitCost === "" ? automatic : numberOrZero(manualUnitCost);
    return { goods, freight, automatic, finalUnit, totalFreight: freight * qty, total: finalUnit * qty };
  }, [exchangeRate, foreignUnitCost, freightPerKg, manualUnitCost, quantity, weightGrams]);

  return <form action={receiveInventory} className="form-grid">
    <div className="form-group"><label>商品編號</label><input className="field" name="sku" list="product-skus" required placeholder="YM1" /><datalist id="product-skus">{products.map((product) => <option key={product.sku} value={product.sku}>{product.name}</option>)}</datalist></div>
    <div className="form-group"><label>批次編號</label><input className="field" name="batchCode" required placeholder="YM1-260906-A" /></div>
    <div className="form-group"><label>進貨數量</label><input className="field" name="quantity" type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
    <div className="form-group"><label>日幣單價（¥／件）</label><input className="field" name="foreignUnitCost" type="number" min="0" step="0.01" value={foreignUnitCost} onChange={(event) => setForeignUnitCost(event.target.value)} placeholder="500" /></div>
    <div className="form-group"><label>日幣匯率（1日幣＝台幣）</label><input className="field" name="exchangeRate" type="number" min="0" step="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} placeholder="0.215" /></div>
    <div className="form-group"><label>每件商品重量（公克）</label><input className="field" name="unitWeightGrams" type="number" min="0" step="0.01" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value)} placeholder="350" /></div>
    <div className="form-group"><label>本批每公斤運費（台幣）</label><input className="field" name="freightPerKg" type="number" min="0" step="0.01" value={freightPerKg} onChange={(event) => setFreightPerKg(event.target.value)} placeholder="180" /></div>
    <div className="form-group"><label>手動最終單位成本（選填）</label><input className="field" name="manualUnitCost" type="number" min="0" step="0.01" value={manualUnitCost} onChange={(event) => setManualUnitCost(event.target.value)} placeholder="可加入退稅或其他費用後覆蓋" /></div>
    <div className="form-group"><label>進貨日期</label><input className="field" name="receivedAt" type="date" /></div>
    <div className="form-group"><label>賞味期限</label><input className="field" name="expiryDate" type="date" /></div>
    <div className="cost-preview full" aria-live="polite">
      <div><span>商品成本／件</span><strong>{money(calculation.goods)}</strong></div>
      <div><span>運費／件</span><strong>{money(calculation.freight)}</strong></div>
      <div><span>自動單位成本</span><strong>{money(calculation.automatic)}</strong></div>
      <div><span>本批總運費</span><strong>{money(calculation.totalFreight)}</strong></div>
      <div className="cost-total"><span>本批最終總成本</span><strong>{money(calculation.total)}</strong></div>
    </div>
    <div className="form-group full"><label>備註</label><input className="field" name="note" maxLength={300} /></div>
    <div><button className="primary">新增進貨批次</button></div>
  </form>;
}
