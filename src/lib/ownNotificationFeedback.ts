// What the vendor (TRACE-153) and admin (TRACE-159) notification pages say, or do, after a mark-read
// action. Only an established state is reported as fact: "read" and "unread" come from the write's
// confirmed rows or a successful readback; "unknown" says the save may have gone through and that the
// list may be out of date. A "stale" outcome belongs to an account that is no longer signed in here,
// so nothing is shown and nothing navigates.

import type { MarkOutcome } from "@/lib/ownNotificationsController";

export type NoticeFeedback =
  | { tone: "status"; text: string }
  | { tone: "error"; title: string; text: string; href?: string; label?: string; refresh?: boolean };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function openNoticeOutcome(
  outcome: MarkOutcome,
  destination: string,
  destinationLabel: string,
): { navigate: string } | { feedback: NoticeFeedback } | null {
  const go = { href: destination, label: `Go to ${destinationLabel}` };
  switch (outcome.kind) {
    case "stale":
      return null;
    case "read":
      return { navigate: destination };
    case "unread":
      return {
        feedback: {
          tone: "error",
          title: "This notice wasn’t marked as read",
          text: "It still shows as unread. Nothing else changed. Try opening it again, or go straight to the page.",
          ...go,
        },
      };
    case "unknown":
      return {
        feedback: {
          tone: "error",
          title: "We couldn’t confirm whether this notice was marked as read",
          text: "The change may have been saved, but its current state couldn’t be read back, so this list may be out of date. Refresh to check, or go straight to the page.",
          ...go,
          refresh: true,
        },
      };
  }
}

export function markVisibleFeedback(outcome: MarkOutcome, shown: number): NoticeFeedback | null {
  switch (outcome.kind) {
    case "stale":
      return null;
    case "read":
      return { tone: "status", text: `${plural(shown, "visible notice")} marked as read. Notices you haven’t loaded are unchanged.` };
    case "unread":
      return {
        tone: "error",
        title: "Notices weren’t all marked as read",
        text: `The list now shows what was saved: ${plural(outcome.remaining, "visible notice")} still unread. Notices you haven’t loaded are unchanged. Try again.`,
      };
    case "unknown":
      return {
        tone: "error",
        title: "We couldn’t confirm which notices were marked as read",
        text: "Some or all of the changes may have been saved, but their current state couldn’t be read back, so this list may be out of date. Notices you haven’t loaded are unchanged. Refresh to check.",
        refresh: true,
      };
  }
}
