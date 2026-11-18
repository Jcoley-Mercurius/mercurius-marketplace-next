import { Briefcase, Clock, ShieldCheck } from "lucide-react";
import type { ProfileBusiness } from "@/lib/providerProfile/model";
import { yearsLabel } from "@/lib/utils";

/**
 * TRACE-156 (P2B): supported business information from the public listing that the gallery
 * composition had no slot for — experience, completed jobs through Mercurius, verified
 * specialty, the provider's promise and video. Each appears only when the listing supplies it.
 */
export function ProfileBusinessFacts({ business, providerName }: { business: ProfileBusiness; providerName: string }) {
  const facts = [
    business.yearsExperience !== null
      ? { key: "experience", icon: Clock, label: "Experience", value: yearsLabel(business.yearsExperience) }
      : null,
    business.completedJobs !== null && business.completedJobs > 0
      ? { key: "completed", icon: Briefcase, label: "Completed through Mercurius", value: String(business.completedJobs) }
      : null,
    business.verifiedSpecialty
      ? { key: "specialty", icon: ShieldCheck, label: "Verified specialty", value: business.verifiedSpecialty }
      : null,
  ].filter((fact) => fact !== null);

  return <>
    {facts.length > 0 && <ul aria-label="Business facts" data-business-facts className="mt-4 grid gap-3 sm:grid-cols-3">
      {facts.map(({ key, icon: Icon, label, value }) => <li key={key} data-business-fact={key} className="flex min-w-0 items-start gap-3 rounded-xl bg-secondary p-4">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-sage-dark" />
        <p className="min-w-0">
          <span className="block text-sm text-slate">{label}</span>
          <span className="block text-base font-semibold text-foreground [overflow-wrap:anywhere]">{value}</span>
        </p>
      </li>)}
    </ul>}

    {business.ourPromise && <div data-business-promise className="mt-6">
      <h3 className="text-lg font-semibold text-foreground">Our promise</h3>
      <p className="mt-1 max-w-3xl whitespace-pre-line text-base leading-6 text-foreground [overflow-wrap:anywhere]">{business.ourPromise}</p>
    </div>}

    {business.videoUrl && <div data-business-video className="mt-6 max-w-3xl">
      <h3 className="text-lg font-semibold text-foreground">Video</h3>
      <ProviderVideo url={business.videoUrl} title={`${providerName} video`} />
    </div>}
  </>;
}

/** The inherited storefront's player: YouTube and Vimeo embed; anything else plays directly. */
function ProviderVideo({ url, title }: { url: string; title: string }) {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  const embed = youtube ? `https://www.youtube.com/embed/${youtube[1]}` : vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : null;
  return <div className="mt-2 aspect-video overflow-hidden rounded-xl bg-secondary">
    {embed
      ? <iframe src={embed} title={title} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      : <video src={url} controls title={title} className="h-full w-full object-cover" />}
  </div>;
}
