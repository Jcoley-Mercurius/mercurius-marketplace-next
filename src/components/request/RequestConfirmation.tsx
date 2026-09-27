"use client";

import { useEffect, useRef } from "react";
import type { DragEvent } from "react";
import Link from "next/link";
import { CreditCard, ImagePlus, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { MAX_REQUEST_PHOTOS } from "@/lib/requestPhotos";
import type { ServiceConfirmation } from "@/lib/requestConfirmation";

export type PhotoRecovery = {
  pending: number;
  /** Files still selected in this tab; lost after a reload. */
  filesAvailable: boolean;
  error: string | null;
  busy: boolean;
  progress: { completed: number; total: number };
};

/**
 * The accepted request, locked (TRACE-098 §5/§7). Shown right after save and after a reload,
 * with recovery for photos, matching and checkout; editing starts an explicitly new request.
 */
export function RequestConfirmation({ services, loading, readbackFailed, photos, checkout, onRetryPhotos, onReselectPhotos, onDiscardPhotos, onRetryMatching, onRefresh, onStartNew }: {
  services: ServiceConfirmation[];
  loading: boolean;
  readbackFailed: boolean;
  photos: PhotoRecovery;
  checkout: { available: boolean; busy: boolean; error: string | null; onContinue: () => void };
  onRetryPhotos: () => void;
  onReselectPhotos: (files: File[]) => void;
  onDiscardPhotos: () => void;
  onRetryMatching: (requestId: string) => void;
  onRefresh: () => void;
  onStartNew: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const count = services.length;
  return (
    <div className="container-narrow py-12 md:py-16">
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold">{count === 1 ? "Your request is saved" : `Your ${count} requests are saved`}</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        {count === 1 ? "It’s saved to your account." : "Each service was saved as its own request."} Here’s where each one stands right now.
      </p>
      <p role="status" className="sr-only">{loading ? "Loading the latest status." : "Latest status loaded."}</p>

      {photos.pending > 0 && (
        <section aria-labelledby="photo-recovery" className="mt-8 rounded-2xl border border-status-warning bg-status-warning-bg p-5 text-foreground">
          <h2 id="photo-recovery" className="flex items-center gap-2 font-semibold"><ImagePlus aria-hidden="true" className="size-5" /> Photos not attached yet</h2>
          <p className="mt-2 text-sm">
            {photos.error ?? `${photos.pending} photo${photos.pending === 1 ? " is" : "s are"} not attached.`} Your request is saved either way.
          </p>
          {photos.busy && <p role="status" className="mt-2 text-sm">Attaching photos {photos.progress.completed} of {photos.progress.total}…</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {photos.filesAvailable
              ? <Button type="button" onClick={onRetryPhotos} loading={photos.busy}><RefreshCw className="size-4" /> Try attaching photos again</Button>
              : <ReselectPhotos onSelect={onReselectPhotos} disabled={photos.busy} />}
            <Button type="button" variant="outline" onClick={onDiscardPhotos} disabled={photos.busy}>Continue without photos</Button>
          </div>
          {!photos.filesAvailable && <p className="mt-3 text-xs">This page was reloaded, so the photos you chose are no longer selected. Choose up to {MAX_REQUEST_PHOTOS} again to attach them.</p>}
        </section>
      )}

      <ol className="mt-8 space-y-4" aria-label="Saved requests">
        {services.map((service) => (
          <li key={service.requestId} className="rounded-2xl border border-border-strong bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{service.serviceName}</h2>
              <Status state={service.status} />
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Status</dt><dd>{service.summary}</dd>
              <dt className="text-muted-foreground">Pricing</dt><dd>{service.mode === "fixed" ? "Fixed price" : service.mode === "deposit_quote" ? "Quote required (deposit offering)" : "Quote required"}</dd>
              <dt className="text-muted-foreground">Provider</dt><dd>{service.provider}</dd>
              <dt className="text-muted-foreground">Payment</dt><dd>{service.payment}</dd>
            </dl>
            {service.canRetryMatching && (
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => onRetryMatching(service.requestId)}><RefreshCw className="size-4" /> Try finding a provider again</Button>
            )}
          </li>
        ))}
      </ol>

      {readbackFailed && (
        <div role="alert" className="mt-6 rounded-xl border border-status-warning bg-status-warning-bg p-4 text-sm text-foreground">
          We couldn’t load the latest status. Your requests are saved.
          <Button type="button" variant="outline" size="sm" className="ml-2 mt-2 sm:mt-0" onClick={onRefresh} loading={loading}>Check again</Button>
        </div>
      )}

      {checkout.available && (
        <section aria-labelledby="checkout-heading" className="mt-8 rounded-2xl border border-accent-border bg-accent-subtle/40 p-5">
          <h2 id="checkout-heading" className="flex items-center gap-2 font-semibold"><CreditCard aria-hidden="true" className="size-5" /> Secure checkout</h2>
          <p className="mt-2 text-sm text-muted-foreground">You’ll review the current terms before paying. Payment isn’t complete until checkout confirms it.</p>
          {checkout.error && <p role="alert" className="mt-2 text-sm text-destructive">{checkout.error}</p>}
          <Button type="button" className="mt-4" onClick={checkout.onContinue} loading={checkout.busy}>Continue to secure checkout</Button>
        </section>
      )}

      <section aria-labelledby="next-heading" className="mt-8">
        <h2 id="next-heading" className="font-semibold">What happens next</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Track each request in your dashboard. Nothing is scheduled until a provider accepts and a time is confirmed with you.</li>
          <li>Your preferred date is a preference, not an appointment.</li>
          <li>Questions? Support replies within one business day, Monday–Friday, 9 a.m.–5 p.m. Eastern Time.</li>
        </ul>
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>View your requests</Link>
        <Button type="button" size="lg" variant="outline" onClick={onStartNew}>Start a new request</Button>
      </div>
      {loading && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading the latest status…</p>}
    </div>
  );
}

function ReselectPhotos({ onSelect, disabled }: { onSelect: (files: File[]) => void; disabled: boolean }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-background px-4 text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-focus-ring"
      onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); if (!disabled) onSelect(Array.from(event.dataTransfer.files)); }}>
      <ImagePlus aria-hidden="true" className="size-4" /> Choose photos again
      <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled}
        onChange={(event) => { onSelect(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </label>
  );
}

/** Interest only: no request, provider, photo upload, booking or payment exists. */
export function InterestConfirmation({ title, services, reason }: { title: string; services: string[]; reason: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className="container-narrow py-12 md:py-16">
      <span aria-hidden="true" className="mb-6 flex size-16 items-center justify-center rounded-full bg-accent-soft"><MapPin className="size-8 text-sage-dark" /></span>
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{reason}</p>
      <dl className="mt-6 grid gap-3 rounded-2xl border border-border-strong bg-card p-5 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Interested in</dt><dd className="font-medium">{services.join(", ")}</dd>
        <dt className="text-muted-foreground">Created</dt><dd>No service request, provider assignment, photo upload, booking or payment.</dd>
      </dl>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/contact" className={buttonVariants({ variant: "outline", size: "lg" })}>Contact Mercurius</Link>
        <Link href="/" className={buttonVariants({ size: "lg" })}>Return home</Link>
      </div>
    </div>
  );
}
