import type { Metadata } from "next";

// The URL carries the invitation's open key (DEC-2026-029 follow-up): never send it on as a
// referrer, and keep the page out of search indexes.
export const metadata: Metadata = {
  title: "Set up your Mercurius provider account",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function InvitationOpenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
