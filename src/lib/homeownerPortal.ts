export const dashboardSections = [
  "overview",
  "upcoming",
  "past",
  "invoices",
  "payment-methods",
] as const;

export type DashboardSection = (typeof dashboardSections)[number];

export function dashboardSectionFromParam(
  value: string | null | undefined,
): DashboardSection {
  return dashboardSections.includes(value as DashboardSection)
    ? (value as DashboardSection)
    : "overview";
}

export function dashboardSectionHref(section: DashboardSection): string {
  return section === "overview" ? "/dashboard" : `/dashboard?tab=${section}`;
}
