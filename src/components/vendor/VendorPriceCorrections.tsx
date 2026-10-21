"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { describeChange, formatCorrectionTime, parseCorrections, type PriceCorrection } from "@/lib/packagePriceCorrections";

// DEC-2026-034 (TRACE-109): the vendor reads Mercurius price corrections to its own
// packages, what changed and why. Nothing renders when there are none or the read fails;
// the notification remains the primary signal.

const SHOWN = 3;

export function VendorPriceCorrections() {
  const [items, setItems] = useState<PriceCorrection[]>([]);

  useEffect(() => {
    let current = true;
    void createClient().rpc("vendor_my_package_price_corrections").then(({ data, error }) => {
      if (current && !error) setItems(parseCorrections(data));
    });
    return () => { current = false; };
  }, []);

  if (!items.length) return null;

  return <section aria-labelledby="vendor-price-corrections" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
    <div>
      <h2 id="vendor-price-corrections" className="font-semibold">Price changes by Mercurius</h2>
      <p className="mt-1 text-sm text-muted-foreground">Earlier price corrections and any listing Mercurius paused. Mercurius now asks for your approval before changing a price. Requests and quotes you had already agreed keep their price. Questions? Contact Mercurius support.</p>
    </div>
    <ol className="space-y-3">{items.slice(0, SHOWN).map((item) => <Correction key={item.id} item={item} />)}</ol>
    {items.length > SHOWN && <details>
      <summary className="cursor-pointer text-sm font-medium">Show {items.length - SHOWN} earlier {items.length - SHOWN === 1 ? "change" : "changes"}</summary>
      <ol className="mt-3 space-y-3">{items.slice(SHOWN).map((item) => <Correction key={item.id} item={item} />)}</ol>
    </details>}
  </section>;
}

function Correction({ item }: { item: PriceCorrection }) {
  return <li className="rounded-lg border bg-muted/20 p-3 text-sm">
    <p className="font-medium break-words">{item.packageName}</p>
    <p className="text-xs text-muted-foreground">{formatCorrectionTime(item.createdAt)}</p>
    <ul className="mt-2 list-disc space-y-0.5 pl-5">{item.changes.map((change, index) => <li key={index}>{describeChange(change)}</li>)}</ul>
    <p className="mt-2 break-words"><span className="text-muted-foreground">Reason: </span>{item.reason}</p>
  </li>;
}
