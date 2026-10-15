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

// The honeypot's name and id must not resemble a field that browser or password-manager
// autofill recognizes (company, name, email, phone, fax, address, website, ...). The former
// name, company_fax, was filled with saved company names and refused real applicants.
export const INTAKE_TRAP_FIELD_NAME = "intake_signal";

// Hidden from sighted users, screen readers and the tab order. People never fill it;
// form-filling bots often do. The data-* attributes ask password managers (1Password,
// LastPass, Bitwarden, Dashlane) to skip it, since they do not honor autocomplete="off".
export function IntakeTrapField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  return (
    <div aria-hidden="true" className="sr-only">
      <label htmlFor="intake-signal-check">Leave this field empty</label>
      <input
        ref={inputRef}
        id="intake-signal-check"
        name={INTAKE_TRAP_FIELD_NAME}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        defaultValue=""
      />
    </div>
  );
}
