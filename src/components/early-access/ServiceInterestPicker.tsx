"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export type InterestService = { id: string; name: string; categoryId: string };
export type InterestCategory = { id: string; name: string };
export type InterestCatalog =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; services: InterestService[]; categories: InterestCategory[] };

// TRACE-103: services come from the live catalog, the same list the interest command
// validates against. A failed lookup is shown, never replaced by a static list.
export function useInterestCatalog(): InterestCatalog {
  const [state, setState] = useState<{ attempt: number; value: InterestCatalog }>({ attempt: 0, value: { status: "loading" } });
  const attempt = state.attempt;
  useEffect(() => {
    let active = true;
    const client = createClient();
    void Promise.all([
      client.from("service_categories").select("id, name").eq("is_active", true).order("sort_order"),
      client.from("services_catalog").select("id, name, category_id").eq("is_active", true).order("sort_order"),
    ]).then(([categories, services]) => {
      if (!active) return;
      if (categories.error || services.error) {
        setState({ attempt, value: { status: "error", retry: () => setState({ attempt: attempt + 1, value: { status: "loading" } }) } });
        return;
      }
      setState({ attempt, value: {
        status: "ready",
        categories: (categories.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string })),
        services: (services.data ?? []).map((row) => ({ id: row.id as string, name: row.name as string, categoryId: row.category_id as string })),
      } });
    });
    return () => { active = false; };
  }, [attempt]);
  return state.value;
}

export function ServiceInterestPicker({ id, catalog, selected, stillExploring, disabled, error, onChange }: {
  id: string;
  catalog: InterestCatalog;
  selected: string[];
  stillExploring: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (next: { serviceIds: string[]; stillExploring: boolean }) => void;
}) {
  const describedBy = [`${id}-help`, error && `${id}-error`].filter(Boolean).join(" ");
  // Groups holding a selection start open; after any interaction the person's choice stands.
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);

  let groups: { category: InterestCategory; services: InterestService[] }[] = [];
  if (catalog.status === "ready") {
    const categories = [...catalog.categories];
    const known = new Set(categories.map((category) => category.id));
    if (catalog.services.some((service) => !known.has(service.categoryId))) categories.push({ id: "", name: "Other services" });
    groups = categories
      .map((category) => ({ category, services: catalog.services.filter((service) => (known.has(service.categoryId) ? service.categoryId : "") === category.id) }))
      .filter((group) => group.services.length > 0);
  }
  const open = openIds ?? new Set(groups.filter((group) => group.services.some((service) => selected.includes(service.id))).map((group) => group.category.id));
  const toggle = (serviceId: string, checked: boolean) => {
    if (!openIds) setOpenIds(open);
    onChange({
      serviceIds: checked ? [...new Set([...selected, serviceId])] : selected.filter((item) => item !== serviceId),
      stillExploring: false,
    });
  };

  return (
    <fieldset id={id} tabIndex={-1} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className="min-w-0 space-y-3 rounded-xl border border-border p-3 outline-none focus-visible:ring-3 focus-visible:ring-focus-ring sm:p-4">
      <legend className="px-1 text-sm font-medium">Services you’re interested in (required)</legend>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">Choose any that apply, or tell us you’re still exploring.</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm font-medium">
        <input type="checkbox" className="size-5 shrink-0 accent-commitment" checked={stillExploring} disabled={disabled}
          onChange={(event) => { if (!openIds) setOpenIds(open); onChange({ serviceIds: event.target.checked ? [] : selected, stillExploring: event.target.checked }); }} />
        I’m still exploring
      </label>
      {catalog.status === "loading" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Loading services…</p>
      )}
      {catalog.status === "error" && (
        <div role="alert" className="space-y-2 rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm text-status-warning">
          <p>Services couldn’t be loaded. You can choose “I’m still exploring,” or try again.</p>
          <Button type="button" variant="outline" size="sm" onClick={catalog.retry}><RefreshCw aria-hidden="true" />Try again</Button>
        </div>
      )}
      {groups.map(({ category, services }) => {
        const count = services.filter((service) => selected.includes(service.id)).length;
        return (
          <details key={category.id || "other"} open={open.has(category.id)} className="group rounded-lg border border-border"
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              if (isOpen === open.has(category.id)) return;
              const next = new Set(open);
              if (isOpen) next.add(category.id); else next.delete(category.id);
              setOpenIds(next);
            }}>
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
              <span>{category.name}</span>
              {count > 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-commitment">{count} selected</span>}
            </summary>
            <ul className="border-t border-border px-3 py-1">
              {services.map((service) => (
                <li key={service.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1 text-sm">
                    <input type="checkbox" className="size-5 shrink-0 accent-commitment" checked={selected.includes(service.id)} disabled={disabled}
                      onChange={(event) => toggle(service.id, event.target.checked)} />
                    {service.name}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset>
  );
}
