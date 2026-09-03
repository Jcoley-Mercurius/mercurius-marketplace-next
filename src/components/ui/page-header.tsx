import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, metadata, actions }: {
  eyebrow?: string; title: string; description?: string; metadata?: ReactNode; actions?: ReactNode;
}) {
  return <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0 space-y-2">
      {eyebrow && <p className="text-sm font-medium text-sage-dark">{eyebrow}</p>}
      <h1 className="text-3xl font-semibold break-words">{title}</h1>
      {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
      {metadata}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
  </header>;
}
