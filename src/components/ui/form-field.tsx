"use client";

import { useId, type ReactNode } from "react";
import { useFieldError } from "./form-errors";

type FieldControl = {
  id: string;
  required: boolean;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
};

/** Spread control props onto one Input, Select, or Textarea. */
export function FormField({ id, label, help, error, required = false, children }: {
  id?: string;
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: (control: FieldControl) => ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const contextError = useFieldError(controlId);
  error = error ?? contextError;
  const descriptions = [help && `${controlId}-help`, error && `${controlId}-error`].filter(Boolean).join(" ");
  return <div className="min-w-0 space-y-2">
    <label htmlFor={controlId} className="block text-sm font-medium">{label}{required && <span> (required)</span>}</label>
    {children({ id: controlId, required, "aria-describedby": descriptions || undefined, "aria-invalid": error ? true : undefined })}
    {help && <p id={`${controlId}-help`} className="text-sm text-muted-foreground">{help}</p>}
    {error && <p id={`${controlId}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
