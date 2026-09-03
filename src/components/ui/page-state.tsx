import type { ReactNode } from "react";
import { CircleAlert, Inbox, LoaderCircle, LockKeyhole } from "lucide-react";

export function PageState({ kind, title, description, action }: {
  kind: "loading" | "empty" | "error" | "permission";
  title: string; description?: string; action?: ReactNode;
}) {
  const Icon = { loading: LoaderCircle, empty: Inbox, error: CircleAlert, permission: LockKeyhole }[kind];
  return <section className="space-y-3 rounded-xl border bg-card p-6 text-card-foreground">
    <div role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
      <Icon aria-hidden="true" className={kind === "loading" ? "mb-3 size-6 animate-spin" : "mb-3 size-6"} />
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
    </div>
    {action}
  </section>;
}
