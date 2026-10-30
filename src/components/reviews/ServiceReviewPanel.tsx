"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { formatAppointment } from "@/lib/appointments";
import {
  commentError, eligibilityLine, historyDetail, historyLabel, MODERATION_RULE, RATING_LABELS, REVIEW_COMMENT_MAX,
  reviewErrorMessage, reviewStateLabel, reviewStateLine, type OwnReview, type ServiceReview,
} from "@/lib/reviews/serviceReview";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type State = { mode: "loading" } | { mode: "error"; message: string } | { mode: "ready"; data: ServiceReview };

// TRACE-130: the homeowner's review of one completed service or visit. The server decides
// eligibility, publication and moderation; this panel shows the readback and sends the commands.
export function ServiceReviewPanel({ jobId, enabled, onChanged }: { jobId: string; enabled: boolean; onChanged?: () => void }) {
  const [state, setState] = useState<State>({ mode: "loading" });
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const result = await createClient().rpc("service_review", { _job_id: jobId });
    if (result.error) {
      setState({ mode: "error", message: reviewErrorMessage(result.error, "Your review couldn't be loaded.") });
      return;
    }
    setState({ mode: "ready", data: result.data as unknown as ServiceReview });
  }, [jobId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changed = async (message: string) => {
    setNotice(message);
    await load();
    onChanged?.();
  };
  const headingId = `review-${jobId}`;
  const data = state.mode === "ready" ? state.data : null;
  if (data && !data.review && data.eligibility === "plan") return null;

  return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border border-accent-border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 id={headingId} className="font-semibold">{data?.review ? "Your review" : "How did the service go?"}</h3>
      {state.mode === "error" && <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw />Try again</Button>}
    </div>
    {notice && <p role="status" className="rounded-lg border border-status-success bg-status-success-bg p-3 text-sm text-status-success">{notice}</p>}
    {state.mode === "loading" ? (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading your review…</p>
    ) : state.mode === "error" ? (
      <p role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{state.message}</p>
    ) : state.data.review ? (
      <ExistingReview review={state.data.review} history={state.data.history ?? []} enabled={enabled} onChanged={changed} onStale={load} />
    ) : state.data.eligibility === "eligible" ? (
      enabled ? <NewReview jobId={jobId} onSubmitted={() => changed("Thanks — your review is saved.")} />
        : <p className="text-sm text-muted-foreground">You can review this service once your dashboard is up to date.</p>
    ) : (
      <p className="text-sm text-muted-foreground">{eligibilityLine(state.data.eligibility) ?? "This service can't be reviewed."}</p>
    )}
  </section>;
}

function NewReview({ jobId, onSubmitted }: { jobId: string; onSubmitted: () => Promise<void> }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const tooLong = commentError(comment);

  const submit = async () => {
    if (pending) return;
    if (rating < 1) { setError("Choose a star rating before you submit."); return; }
    if (tooLong) { setError(tooLong); return; }
    setPending(true); setError("");
    const result = await createClient().rpc("submit_job_review", { _job_id: jobId, _rating: rating, _comment: comment.trim() });
    setPending(false);
    if (result.error) { setError(reviewErrorMessage(result.error, "Your review wasn't saved. Please try again.")); return; }
    await onSubmitted();
  };

  return <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p className="text-sm">{MODERATION_RULE} You can appeal a moderation decision.</p>
    {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{error}</p>}
    <StarInput value={rating} onChange={setRating} disabled={pending} legend="Your rating" />
    <ReviewText value={comment} onChange={setComment} disabled={pending} label="Review (optional)" />
    <div className="flex justify-end">
      <Button type="submit" loading={pending} disabled={pending} className="w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active sm:w-auto">
        {!pending && <Star />}Submit review
      </Button>
    </div>
  </form>;
}

function ExistingReview({ review, history, enabled, onChanged, onStale }: {
  review: OwnReview; history: ServiceReview["history"] & object; enabled: boolean;
  onChanged: (message: string) => Promise<void>; onStale: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.rating);
  const [comment, setComment] = useState(review.comment ?? "");
  const tooLong = commentError(comment);
  const unchanged = rating === review.rating && comment.trim() === (review.comment ?? "");

  const run = async (request: () => PromiseLike<{ error: { code?: string; message: string } | null }>, message: string, fallback: string) => {
    const result = await request();
    if (result.error) {
      if (result.error.code === "40001") await onStale();
      throw new Error(reviewErrorMessage(result.error, fallback));
    }
    setEditing(false);
    await onChanged(message);
  };

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <StarDisplay rating={review.rating} />
      <Badge variant="outline" className={review.public ? "border-status-success text-status-success" : "border-status-warning text-status-warning"}>{reviewStateLabel(review.state)}</Badge>
    </div>
    <p className="text-sm">{reviewStateLine(review)}</p>
    {review.comment ? <p className="whitespace-pre-wrap text-sm leading-6">{review.comment}</p> : <p className="text-sm text-muted-foreground">No written review.</p>}
    <p className="text-xs text-muted-foreground">Submitted {formatAppointment(review.created_at)}{review.edited_at ? ` · edited ${formatAppointment(review.edited_at)}` : ""}</p>

    {enabled && review.can_edit && !editing && <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => { setRating(review.rating); setComment(review.comment ?? ""); setEditing(true); }}>Correct review</Button>
      {review.can_appeal && <ConfirmAction requireReason reasonLabel="Why should Mercurius reconsider?" reasonHelp="Mercurius reviews your original review, the decision and your reason."
        triggerLabel="Appeal decision" title="Appeal this moderation decision?" entity="Your service review"
        consequence="Mercurius opens a support ticket for your appeal. Your review stays hidden until the appeal is decided, and the decision stays in history."
        confirmLabel="Submit appeal" confirmationTone="commitment" describeError={describeRefusal}
        onConfirm={reason => run(() => createClient().rpc("appeal_job_review", { _review_id: review.id, _reason: reason }),
          "Appeal submitted. Mercurius will review it.", "Your appeal wasn't submitted. Please try again.")} />}
    </div>}

    {editing && <div className="space-y-3 rounded-lg border bg-card p-3">
      <StarInput value={rating} onChange={setRating} legend="Corrected rating" />
      <ReviewText value={comment} onChange={setComment} label="Corrected review" />
      <p className="text-xs text-muted-foreground">Your original review stays in its history.{review.public ? " The correction shows publicly with an “Edited” mark." : ""}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Keep current review</Button>
        <ConfirmAction requireReason reasonLabel="Reason for the correction" reasonHelp="For example, the provider came back to fix the issue."
          disabled={unchanged || Boolean(tooLong) || rating < 1} triggerLabel="Save correction" title="Save this correction?" entity="Your service review"
          consequence="Your corrected review replaces the current one. The original and your reason stay in its history." confirmLabel="Save correction" confirmationTone="commitment" describeError={describeRefusal}
          onConfirm={reason => run(() => createClient().rpc("revise_job_review", { _review_id: review.id, _rating: rating, _comment: comment.trim(), _reason: reason, _expected_revision: review.revision }),
            "Correction saved.", "Your correction wasn't saved. Please try again.")} />
      </div>
    </div>}

    {history.length > 0 && <details className="text-sm">
      <summary className="cursor-pointer font-medium">Review history ({history.length})</summary>
      <ol aria-label="Review history" className="mt-2 space-y-2">
        {history.map((entry, index) => <li key={`${entry.at}-${index}`} className="border-l-2 border-accent/40 pl-3">
          <p className="font-medium">{historyLabel(entry)}</p>
          <p className="text-muted-foreground">{historyDetail(entry)}</p>
          {entry.reason && <p className="text-muted-foreground">Reason: {entry.reason}</p>}
          {entry.previous && <p className="text-muted-foreground">Before: {entry.previous.rating} star{entry.previous.rating === 1 ? "" : "s"}{entry.previous.comment ? ` — “${entry.previous.comment}”` : ""}</p>}
        </li>)}
      </ol>
    </details>}
  </div>;
}

// run() throws the server refusal already worded by reviewErrorMessage.
const describeRefusal = (error: unknown) => error instanceof Error ? error.message : undefined;

// Native radios: arrow keys move the choice and the group reads as one question.
function StarInput({ value, onChange, disabled = false, legend }: { value: number; onChange: (value: number) => void; disabled?: boolean; legend: string }) {
  const name = useId();
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  return <fieldset className="space-y-1" disabled={disabled}>
    <legend className="text-sm font-medium">{legend} (required)</legend>
    <div className="flex flex-wrap items-center gap-0" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((stars) => <label key={stars} onMouseEnter={() => setHovered(stars)}
        className="relative flex size-11 cursor-pointer items-center justify-center rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring has-[:disabled]:cursor-not-allowed">
        <input type="radio" name={name} value={stars} checked={value === stars} onChange={() => onChange(stars)}
          className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
          aria-label={`${stars} star${stars === 1 ? "" : "s"}, ${RATING_LABELS[stars].toLowerCase()}`} />
        <Star aria-hidden="true" className={cn("pointer-events-none h-8 w-8 transition-colors", stars <= shown ? "fill-status-warning text-status-warning" : "text-muted-foreground")} />
      </label>)}
      <span className="ml-2 text-sm font-medium" aria-hidden="true">{shown ? RATING_LABELS[shown] : ""}</span>
    </div>
  </fieldset>;
}

function ReviewText({ value, onChange, disabled = false, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  const tooLong = commentError(value);
  return <FormField label={label} help={`${value.trim().length.toLocaleString("en-US")} of ${REVIEW_COMMENT_MAX.toLocaleString("en-US")} characters. Don't include phone numbers, addresses or other personal information.`}
    error={tooLong ?? undefined}>{control => <Textarea {...control} rows={4} value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} placeholder="What went well, and what could be better?" />}</FormField>;
}

function StarDisplay({ rating }: { rating: number }) {
  return <span className="flex gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
    {Array.from({ length: 5 }, (_, star) => <Star key={star} aria-hidden="true" className={cn("h-4 w-4", star < rating ? "fill-status-warning text-status-warning" : "text-muted-foreground")} />)}
  </span>;
}
