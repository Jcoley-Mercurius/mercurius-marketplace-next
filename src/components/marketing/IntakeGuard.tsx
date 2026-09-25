"use client";

import { useEffect, useRef, type RefObject } from "react";

export type IntakeGuardPayload = { trap: string; elapsedMs: number };

// Honeypot and fill-time signals for the public intake forms (TRACE-088). The fill time is
// measured with the browser's own clock from when the form mounted; the route refuses a
// submission sent in under 3 seconds or with the hidden field filled.
export function useIntakeGuard() {
  const trapRef = useRef<HTMLInputElement>(null);
  const mountedAt = useRef<number | null>(null);

  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  function intakePayload(): IntakeGuardPayload {
    return {
      trap: trapRef.current?.value ?? "",
      elapsedMs:
        mountedAt.current === null ? 0 : Math.round(performance.now() - mountedAt.current),
    };
  }

  return { trapRef, intakePayload };
}

// Hidden from sighted users, screen readers and the tab order. People never fill it;
// form-filling bots often do.
export function IntakeTrapField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  return (
    <div aria-hidden="true" className="sr-only">
      <label htmlFor="intake-company-fax">Leave this field empty</label>
      <input
        ref={inputRef}
        id="intake-company-fax"
        name="company_fax"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
    </div>
  );
}
