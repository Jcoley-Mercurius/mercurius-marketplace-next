export type MoneySummaryValues = {
  service: number; addons: number; discount: number; adjustment: number; tax: number;
  tip: number; deposit: number; total: number; paid: number; refunded: number;
};
export const formatMoney = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

/** Values are server-owned integer cents. The caller supplies the role-appropriate projection. */
export function MoneySummary({ values }: { values: MoneySummaryValues }) {
  const rows: [string, number][] = [
    ["Service", values.service], ["Add-ons", values.addons], ["Discounts", -values.discount],
    ["Adjustments", values.adjustment], ["Tax", values.tax], ["Tip for your provider", values.tip],
    ["Total", values.total], ["Deposit included in total", values.deposit],
    ["Payments confirmed", values.paid], ["Refunds confirmed", values.refunded],
    ...(values.refunded === 0 ? [["Remaining payment", Math.max(0, values.total - values.paid)] as [string, number]] : []),
  ];
  return <dl aria-label="Payment breakdown" className="divide-y rounded-xl border bg-card px-4 text-card-foreground">
    {rows.map(([label, amount]) => <div key={label} className="flex min-w-0 flex-wrap justify-between gap-x-6 gap-y-1 py-3">
      <dt className={label === "Total" ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className="font-medium tabular-nums">{formatMoney(amount)}</dd>
    </div>)}
  </dl>;
}
