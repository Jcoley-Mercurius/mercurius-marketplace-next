// Phase 7.5G-2 (TRACE-159): state for /admin/sourcing. Every read is bound to the signed-in account
// it was started for (as 7.5E F-1 and 7.5F-2): changing the owner (another account signs in, the
// account signs out, the page unmounts) starts a new epoch, resets the state, and discards every
// answer that arrives for the old epoch. A later read also supersedes an earlier one in flight.
//
// The only call is public.admin_sourcing_queue(): once when an owner is set and once per refresh().
// Nothing here writes, settles an expired offer, runs matching or polls (plan §8.3).

import { type SourcingQueue, parseSourcingQueue, readError } from "@/lib/sourcingQueue";

export const SOURCING_READER = "admin_sourcing_queue";

export type RpcAnswer = { data: unknown; error: unknown };
export type SourcingClient = { rpc: (fn: string) => PromiseLike<RpcAnswer> };

export type SourcingStatus = "loading" | "ready" | "error" | "denied";

export type SourcingPageState = {
  owner: string | null;
  status: SourcingStatus;
  data: SourcingQueue | null;
  message: string | null;
};

export function initialSourcingState(owner: string | null): SourcingPageState {
  return { owner, status: "loading", data: null, message: null };
}

export const UNREADABLE = "The sourcing queue's answer couldn’t be read.";
const NO_ANSWER = "No answer was received";
export const DENIED_MESSAGE = "This account can’t read the sourcing queue.";

export class SourcingQueueController {
  private state: SourcingPageState = initialSourcingState(null);
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private seq = 0;

  constructor(private readonly client: SourcingClient) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;

  private set(next: SourcingPageState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** null signs out: nothing is shown or read until an owner is set again. */
  setOwner(owner: string | null) {
    if (owner === this.state.owner) return;
    this.epoch += 1;
    this.seq += 1;
    this.set(initialSourcingState(owner));
    if (owner) void this.refresh();
  }

  refresh = async () => {
    const owner = this.state.owner;
    if (!owner) return;
    const epoch = this.epoch;
    const seq = ++this.seq;
    this.set({ ...this.state, status: "loading", message: null });
    let answer: RpcAnswer;
    try {
      answer = await this.client.rpc(SOURCING_READER);
    } catch (caught) {
      // A thrown request is a lost answer, never a refusal.
      answer = { data: null, error: { message: caught instanceof Error && caught.message ? caught.message : NO_ANSWER } };
    }
    if (epoch !== this.epoch || seq !== this.seq) return;
    if (answer.error) {
      const { code, message } = readError(answer.error);
      this.set(code === "42501"
        ? { owner, status: "denied", data: null, message: DENIED_MESSAGE }
        : { owner, status: "error", data: null, message: code ? `${message.replace(/[.\s]+$/, "")} (${code})` : message });
      return;
    }
    const data = parseSourcingQueue(answer.data);
    this.set(data ? { owner, status: "ready", data, message: null } : { owner, status: "error", data: null, message: UNREADABLE });
  };
}
