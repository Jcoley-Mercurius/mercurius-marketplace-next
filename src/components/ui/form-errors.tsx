"use client";

import { createContext, useContext, useEffect, useRef } from "react";

export type FormErrors = Record<string, string>;
export const FormErrorsContext = createContext<FormErrors>({});
export function useFieldError(id: string) {
  return useContext(FormErrorsContext)[id];
}

/** Keys are IDs of the fields (or focusable groups) that need attention. */
export function FormErrorSummary({ errors }: { errors: FormErrors }) {
  const summary = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);
  useEffect(() => {
    if (Object.keys(errors).length) summary.current?.focus();
  }, [errors]);
  if (!entries.length) return null;
  return <div ref={summary} tabIndex={-1} role="region" aria-label="Please check your answers" className="mb-6 scroll-mt-24 rounded-xl border border-destructive bg-card p-4 text-foreground">
    <h2 className="font-semibold">Please check your answers</h2>
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {entries.map(([id, message]) => <li key={id}>
        <a href={`#${id}`} className="inline-flex min-h-11 items-center text-sm text-destructive underline underline-offset-4" onClick={event => {
          event.preventDefault();
          document.getElementById(id)?.focus();
        }}>{message}</a>
      </li>)}
    </ul>
  </div>;
}
