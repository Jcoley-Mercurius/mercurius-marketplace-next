"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { deviceTimeNote, resolveEasternTime, type EasternResolution } from "@/lib/appointments";

export type EasternDateTimeValue = { date: string; time: string; choice: "EDT" | "EST" | "" };

/** The instant the entry resolves to, once it is unambiguous. */
export function easternInstant(value: EasternDateTimeValue): Date | null {
  const resolution = resolveEasternTime(value.date, value.time);
  if (resolution.kind === "ok") return resolution.instant;
  if (resolution.kind === "ambiguous") return resolution.choices.find(choice => choice.abbreviation === value.choice)?.instant ?? null;
  return null;
}

/**
 * MDS DateTime: timezone stated on the control, typed or picked date and time, and the
 * daylight-saving cases explained instead of silently resolved. Times are Eastern wall time.
 */
export function EasternDateTimeField({ legend, value, onChange, disabled = false }: {
  legend: string; value: EasternDateTimeValue; onChange: (value: EasternDateTimeValue) => void; disabled?: boolean;
}) {
  const id = useId();
  const resolution: EasternResolution = resolveEasternTime(value.date, value.time);
  const instant = easternInstant(value);
  const problem = resolution.kind === "invalid" || resolution.kind === "nonexistent" ? resolution.message : null;
  const describedBy = [`${id}-help`, problem && `${id}-error`].filter(Boolean).join(" ");
  const note = instant ? deviceTimeNote(instant) : null;
  const selected = resolution.kind === "ok" ? resolution.label
    : resolution.kind === "ambiguous" ? resolution.choices.find(choice => choice.abbreviation === value.choice)?.label : null;
  return <fieldset className="min-w-0 space-y-3" disabled={disabled}>
    <legend className="text-sm font-medium">{legend} <span className="font-normal text-muted-foreground">(Eastern Time)</span></legend>
    <p id={`${id}-help`} className="text-sm text-muted-foreground">Enter the time in Eastern Time (America/New_York), whatever timezone this device uses.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor={`${id}-date`} className="block text-sm font-medium">Date (Eastern Time)</label>
        <Input id={`${id}-date`} type="date" required value={value.date} aria-describedby={describedBy} aria-invalid={problem ? true : undefined}
          onChange={event => onChange({ ...value, date: event.target.value, choice: "" })} />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-time`} className="block text-sm font-medium">Time (Eastern Time)</label>
        <Input id={`${id}-time`} type="time" step={60} required value={value.time} aria-describedby={describedBy} aria-invalid={problem ? true : undefined}
          onChange={event => onChange({ ...value, time: event.target.value, choice: "" })} />
      </div>
    </div>
    {problem && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{problem}</p>}
    {resolution.kind === "ambiguous" && <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{resolution.message}</legend>
      {resolution.choices.map(choice => <label key={choice.abbreviation} className="flex min-h-11 items-center gap-3 text-sm">
        <input type="radio" name={`${id}-offset`} className="h-5 w-5" checked={value.choice === choice.abbreviation} onChange={() => onChange({ ...value, choice: choice.abbreviation })} />
        {choice.label}{choice.abbreviation === "EDT" ? " (first, before clocks fall back)" : " (second, after clocks fall back)"}
      </label>)}
    </fieldset>}
    {selected && <p className="text-sm" aria-live="polite"><span className="font-medium">Selected:</span> {selected}{note && <span className="block text-muted-foreground">{note}</span>}</p>}
  </fieldset>;
}
