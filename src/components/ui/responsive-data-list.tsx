import type { ReactNode } from "react";

export type DataColumn<T> = { key: string; label: string; render: (row: T) => ReactNode };

/** One data model, native table on desktop and labelled records on small screens. */
export function ResponsiveDataList<T>({ label, rows, columns, rowKey, rowLabel }: {
  label: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  rowLabel: (row: T) => string;
}) {
  return <>
    <ul aria-label={label} className="divide-y xl:hidden">
      {rows.map(row => <li key={rowKey(row)} className="min-w-0 space-y-3 break-words p-4">
        <h2 className="text-base font-semibold">{rowLabel(row)}</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {columns.map(column => <div key={column.key} className="min-w-0">
            <dt className="mb-1 text-xs font-medium text-muted-foreground">{column.label}</dt>
            <dd className="text-sm">{column.render(row)}</dd>
          </div>)}
        </dl>
      </li>)}
    </ul>
    <div role="region" aria-label={`${label} table; scroll horizontally if needed`} tabIndex={0} className="hidden max-w-full overflow-x-auto xl:block">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="border-b bg-muted/60"><tr>
          {columns.map(column => <th key={column.key} scope="col" className="p-4 font-medium text-muted-foreground">{column.label}</th>)}
        </tr></thead>
        <tbody className="divide-y">{rows.map(row => <tr key={rowKey(row)} className="hover:bg-muted/30">
          {columns.map((column, index) => index === 0
            ? <th key={column.key} scope="row" className="p-4 font-normal">{column.render(row)}</th>
            : <td key={column.key} className="p-4">{column.render(row)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}
