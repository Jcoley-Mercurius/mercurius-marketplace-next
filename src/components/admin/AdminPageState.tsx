"use client";

import type { ComponentType } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AdminLoading({ label = "Loading..." }: { label?: string }) {
  return <div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">{label}</span></div>;
}

export function AdminError({ title = "Data could not be loaded", message, retry }: { title?: string; message: string; retry: () => void }) {
  return <div className="flex min-h-[55vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>;
}

export function AdminEmpty({ icon: Icon, title, description = "Live records will appear here when available." }: { icon: ComponentType<{ className?: string }>; title: string; description?: string }) {
  return <div className="py-16 text-center"><Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>;
}

export function AdminToggle({ checked, onChange, disabled = false, label, loading = false }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string; loading?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange} className={cn("relative inline-flex h-6 w-11 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-muted-foreground/30")}>{loading ? <Loader2 className="absolute left-3.5 top-1 h-4 w-4 animate-spin text-white" /> : <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-5" : "left-0.5")} />}</button>;
}
