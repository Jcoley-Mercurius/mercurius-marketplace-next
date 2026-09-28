import { AlertTriangle, Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkflowStepState = "complete" | "current" | "upcoming" | "blocked" | "error";

export type WorkflowStep = { id: string; label: string; state: WorkflowStepState };

const stateText: Record<WorkflowStepState, string> = {
  complete: "complete",
  current: "current step",
  upcoming: "not started",
  blocked: "blocked",
  error: "needs attention",
};

/**
 * MDS §5 WorkflowStepper. Each step carries a text state (never color alone); the live region
 * announces the current step when it changes.
 */
export function WorkflowStepper({ steps, label = "Progress" }: { steps: WorkflowStep[]; label?: string }) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.state === "current" || step.state === "error"));
  const current = steps[currentIndex];
  return (
    <nav aria-label={label}>
      <p role="status" className="mb-3 text-sm font-medium text-foreground">
        Step {currentIndex + 1} of {steps.length}: {current?.label}
        {current?.state === "error" ? " (needs attention)" : ""}
      </p>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {steps.map((step, index) => (
          <li key={step.id} aria-current={step.state === "current" || step.state === "error" ? "step" : undefined} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                step.state === "complete" && "border-accent bg-accent text-accent-foreground",
                step.state === "current" && "border-accent bg-background text-foreground ring-2 ring-accent",
                step.state === "upcoming" && "border-border-strong bg-muted text-muted-foreground",
                step.state === "blocked" && "border-border-strong bg-muted text-muted-foreground",
                step.state === "error" && "border-destructive bg-background text-destructive ring-2 ring-destructive",
              )}
            >
              {step.state === "complete" ? <Check className="size-4" /> : step.state === "blocked" ? <Lock className="size-4" /> : step.state === "error" ? <AlertTriangle className="size-4" /> : index + 1}
            </span>
            <span className={cn("text-sm", step.state === "current" || step.state === "error" ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {step.label}
              <span className="sr-only">, {stateText[step.state]}</span>
            </span>
            {index < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-border-strong sm:w-10" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}
