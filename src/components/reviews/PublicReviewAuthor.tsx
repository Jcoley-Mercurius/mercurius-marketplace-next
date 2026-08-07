import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatPublicReviewerName,
  VERIFIED_HOMEOWNER_LABEL,
} from "@/lib/reviews/publicIdentity";

type PublicReviewAuthorProps = {
  displayName?: string | null;
  className?: string;
};

export function PublicReviewAuthor({ displayName, className }: PublicReviewAuthorProps) {
  const label = formatPublicReviewerName(displayName);
  const initial = label === VERIFIED_HOMEOWNER_LABEL ? "H" : Array.from(label)[0];

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-light text-sm font-semibold text-sage-dark ring-1 ring-sage/20">
        {initial}
      </span>
      <div>
        <p className="font-semibold leading-tight text-foreground">{label}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-sage-dark">
          <BadgeCheck className="h-3.5 w-3.5" /> Verified service
        </p>
      </div>
    </div>
  );
}
