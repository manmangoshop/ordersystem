export type PricedItem = { sku: string; name: string; priceCents: number; quantity: number };

export function calculateOrder(items: PricedItem[], shippingMethod: string, needsTax: boolean) {
  const subtotal = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const itemDiscount = itemCount >= 2 ? Math.round(subtotal * 0.05) : 0;
  const afterDiscount = subtotal - itemDiscount;
  const tax = needsTax ? Math.round(afterDiscount * 0.05) : 0;
  const taxableTotal = afterDiscount + tax;
  const shipping = shippingMethod === "超商取貨"
    ? (taxableTotal >= 150000 ? 0 : 6000)
    : (taxableTotal >= 300000 ? 0 : 21000);
  return { subtotal, discount: itemDiscount, tax, shipping, total: taxableTotal + shipping };
}
