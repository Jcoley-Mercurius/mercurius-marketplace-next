import { LEE_ZIP_MAP_LABELS, LEE_ZIP_MAP_VIEWBOX, LEE_ZIP_SHAPES } from "@/lib/leeZipMap";
import type { PublicServiceArea } from "@/lib/vendorServiceAreas";

// TRACE-105: a drawn Lee County map shading the provider's service ZIPs. Decorative summary of
// the ZIP list beside it; PO-box ZIPs have no boundary and appear only in the list.
export function ServiceAreaMap({ areas }: { areas: readonly PublicServiceArea[] }) {
  const served = new Set(areas.flatMap((area) => area.zips));
  const servedCities = new Set(areas.map((area) => area.city));
  if (!LEE_ZIP_SHAPES.some((shape) => served.has(shape.zip))) return null;

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${LEE_ZIP_MAP_VIEWBOX.width} ${LEE_ZIP_MAP_VIEWBOX.height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Map of Lee County, Florida. Shaded areas are ZIP codes this provider serves."
      >
        <g strokeLinejoin="round">
          {LEE_ZIP_SHAPES.map((shape) => (
            <path
              key={shape.zip}
              d={shape.d}
              data-zip={shape.zip}
              data-served={served.has(shape.zip) || undefined}
              className={served.has(shape.zip) ? "fill-accent stroke-card" : "fill-muted-foreground/20 stroke-card"}
              strokeWidth={1}
              fillRule="evenodd"
            >
              <title>{served.has(shape.zip) ? `${shape.zip} · served` : shape.zip}</title>
            </path>
          ))}
        </g>
        <g aria-hidden="true" className="pointer-events-none" fontSize={18} textAnchor="middle" dominantBaseline="middle">
          {LEE_ZIP_MAP_LABELS.map((label) => {
            const active = label.cities.some((city) => servedCities.has(city));
            return (
              <text
                key={label.name}
                x={label.x}
                y={label.y}
                className={active ? "fill-foreground stroke-card font-semibold" : "fill-muted-foreground stroke-card"}
                strokeWidth={4}
                paintOrder="stroke"
              >
                {label.name}
              </text>
            );
          })}
        </g>
      </svg>
      <figcaption className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-accent" aria-hidden="true" />Serves</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-muted-foreground/20" aria-hidden="true" />Not served</span>
      </figcaption>
    </figure>
  );
}
