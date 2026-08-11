"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  serviceRequestStatusLabel,
  serviceRequestStatusStyle,
} from "@/lib/serviceRequestStatus";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type JobSummary = {
  id: string;
  service_type: string;
  status: string;
  address: string;
  city: string;
  state: string;
  preferred_date: string | null;
  preferred_time: string | null;
  contractor_id: string;
  updated_at: string;
};

type Message = {
  id: string;
  service_request_id: string;
  sender_id: string;
  sender_role: "homeowner" | "vendor" | "admin";
  content: string;
  created_at: string;
};

type Thread = {
  id: string;
  serviceType: string;
  status: string;
  providerName: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  updatedAt: string;
  job: JobSummary;
};

type Mode = "loading" | "ready" | "error";

export function HomeownerMessagesExperience({
  requestedRequestId = null,
}: {
  requestedRequestId?: string | null;
}) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [requestedThreadMissing, setRequestedThreadMissing] = useState(false);
  const [realtimeWarning, setRealtimeWarning] = useState("");
  const appliedRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading || user) return;
    const timer = window.setTimeout(() => {
      router.replace("/login?redirect=%2Fmessages");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, router, user]);

  const loadThreads = useCallback(
    async (showLoading = false) => {
      if (!user) return;
      if (showLoading) setMode("loading");
      setError("");

      try {
        const supabase = createClient();
        const requestResult = await supabase
          .from("service_requests")
          .select(
            "id, service_type, status, address, city, state, preferred_date, preferred_time, contractor_id, updated_at",
          )
          .eq("customer_id", user.id)
          .not("contractor_id", "is", null)
          .order("updated_at", { ascending: false });
        if (requestResult.error) throw requestResult.error;

        const jobs = (requestResult.data ?? []) as JobSummary[];
        const requestIds = jobs.map((job) => job.id);
        const contractorIds = [
          ...new Set(jobs.map((job) => job.contractor_id).filter(Boolean)),
        ];
        const [contractorResult, messageResult] = await Promise.all([
          contractorIds.length
            ? supabase
                .from("contractors")
                .select("id, name")
                .in("id", contractorIds)
            : Promise.resolve({ data: [], error: null }),
          requestIds.length
            ? supabase
                .from("messages")
                .select(
                  "id, service_request_id, sender_id, sender_role, content, created_at",
                )
                .in("service_request_id", requestIds)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (contractorResult.error) throw contractorResult.error;
        if (messageResult.error) throw messageResult.error;

        const providerNames = new Map(
          ((contractorResult.data ?? []) as { id: string; name: string | null }[])
            .map((contractor) => [contractor.id, contractor.name]),
        );
        const lastByRequest = new Map<string, Message>();
        for (const message of (messageResult.data ?? []) as Message[]) {
          if (!lastByRequest.has(message.service_request_id)) {
            lastByRequest.set(message.service_request_id, message);
          }
        }

        const nextThreads = jobs
          .map((job) => {
            const lastMessage = lastByRequest.get(job.id);
            return {
              id: job.id,
              serviceType: job.service_type,
              status: job.status,
              providerName: providerNames.get(job.contractor_id) ?? null,
              lastMessage: lastMessage?.content ?? null,
              lastMessageTime: lastMessage?.created_at ?? null,
              updatedAt: job.updated_at,
              job,
            } satisfies Thread;
          })
          .sort(
            (left, right) =>
              Date.parse(right.lastMessageTime ?? right.updatedAt) -
              Date.parse(left.lastMessageTime ?? left.updatedAt),
          );

        setThreads(nextThreads);
        if (!requestedRequestId) {
          appliedRequestRef.current = null;
          setRequestedThreadMissing(false);
        }

        const hasPendingDeepLink = Boolean(
          requestedRequestId &&
            appliedRequestRef.current !== requestedRequestId,
        );
        if (hasPendingDeepLink && requestedRequestId) {
          appliedRequestRef.current = requestedRequestId;
          const matchingThread = nextThreads.some(
            (thread) => thread.id === requestedRequestId,
          );
          setRequestedThreadMissing(!matchingThread);
          setSelectedId(matchingThread ? requestedRequestId : null);
        } else {
          setSelectedId((current) =>
            current && nextThreads.some((thread) => thread.id === current)
              ? current
              : null,
          );
        }
        setMode("ready");
      } catch (reason) {
        console.error("Unable to load homeowner messages", reason);
        setThreads([]);
        setSelectedId(null);
        setError(
          reason instanceof Error
            ? reason.message
            : "Messages could not be loaded.",
        );
        setMode("error");
      }
    },
    [requestedRequestId, user],
  );

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      void loadThreads(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads, user]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`homeowner-message-inbox:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          void loadThreads(false);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "service_requests",
          filter: `customer_id=eq.${user.id}`,
        },
        () => {
          void loadThreads(false);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeWarning("");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeWarning(
            "Live inbox updates are temporarily unavailable. Refresh to check for new conversations.",
          );
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadThreads, user]);

  const selected =
    threads.find((thread) => thread.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter(
      (thread) =>
        thread.serviceType.toLowerCase().includes(query) ||
        (thread.providerName ?? "").toLowerCase().includes(query),
    );
  }, [searchQuery, threads]);

  if (authLoading || !user) return <FullPageLoading />;

  if (mode === "error") {
    return (
      <PageFrame>
        <PageState
          icon={AlertCircle}
          title="Messages couldn’t be loaded"
          copy={error}
          action={
            <Button variant="outline" onClick={() => void loadThreads(true)}>
              <RefreshCw />
              Try again
            </Button>
          }
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="flex h-[calc(100dvh-4rem)] min-h-[560px] overflow-hidden bg-background">
        <aside
          className={cn(
            "flex w-full flex-col border-r border-border bg-card md:w-80 lg:w-96",
            selected && "hidden md:flex",
          )}
        >
          <div className="border-b border-border p-4">
            <Link
              href="/dashboard"
              className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <h1 className="mb-4 text-xl font-semibold">Messages</h1>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search conversations"
                placeholder="Search service or provider..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 pl-9"
              />
            </div>
            {requestedThreadMissing && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100"
              >
                <p className="font-semibold">Conversation not found</p>
                <p className="mt-0.5">
                  This request is not available in your current message inbox.
                </p>
                <Link
                  href="/messages"
                  className="mt-1 inline-flex font-semibold underline underline-offset-2"
                >
                  View all conversations
                </Link>
              </div>
            )}
            {realtimeWarning && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100"
              >
                {realtimeWarning}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {mode === "loading" ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <span className="sr-only">Loading conversations</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="mb-1 font-medium">
                  {searchQuery ? "No matching conversations" : "No conversations yet"}
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {searchQuery
                    ? "Try a different service or provider name."
                    : "Messages become available after Mercurius assigns a provider to your request."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(thread.id);
                      setRequestedThreadMissing(false);
                    }}
                    className={cn(
                      "w-full p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
                      selectedId === thread.id && "bg-muted",
                    )}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {thread.serviceType}
                      </p>
                      {thread.lastMessageTime && (
                        <span
                          suppressHydrationWarning
                          className="shrink-0 text-[11px] text-muted-foreground"
                        >
                          {relativeTime(thread.lastMessageTime)}
                        </span>
                      )}
                    </div>
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      {thread.providerName ?? "Assigned provider"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {thread.lastMessage ?? "Start the conversation…"}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "mt-2 border text-xs",
                        serviceRequestStatusStyle(thread.status),
                      )}
                    >
                      {serviceRequestStatusLabel(thread.status)}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {selected ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Back to conversations"
                onClick={() => setSelectedId(null)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{selected.serviceType}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {selected.providerName ?? "Assigned provider"}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "hidden border sm:inline-flex",
                  serviceRequestStatusStyle(selected.status),
                )}
              >
                {serviceRequestStatusLabel(selected.status)}
              </Badge>
              <Link
                href={`/dashboard?job=${encodeURIComponent(selected.id)}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View request
              </Link>
            </div>

            <HomeownerMessageThread
              serviceRequestId={selected.id}
              providerName={selected.providerName ?? "Your provider"}
              onSent={() => void loadThreads(false)}
            />
          </section>
        ) : (
          <section className="hidden min-w-0 flex-1 items-center justify-center bg-muted/40 md:flex">
            <div className="px-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-card shadow-sm">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold">Your messages</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                {requestedThreadMissing
                  ? "That request is not assigned to this homeowner account, is no longer available, or the link is outdated."
                  : "Select a service conversation to message your assigned provider or Mercurius support."}
              </p>
            </div>
          </section>
        )}
      </div>
    </PageFrame>
  );
}

function HomeownerMessageThread({
  serviceRequestId,
  providerName,
  onSent,
}: {
  serviceRequestId: string;
  providerName: string;
  onSent: () => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [realtimeWarning, setRealtimeWarning] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await createClient()
      .from("messages")
      .select(
        "id, service_request_id, sender_id, sender_role, content, created_at",
      )
      .eq("service_request_id", serviceRequestId)
      .order("created_at", { ascending: true });

    if (result.error) {
      setMessages([]);
      setError(result.error.message);
    } else {
      setMessages((result.data ?? []) as Message[]);
    }
    setLoading(false);
  }, [serviceRequestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMessages();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`homeowner-messages:${serviceRequestId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `service_request_id=eq.${serviceRequestId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((current) =>
            current.some((message) => message.id === incoming.id)
              ? current
              : [...current, incoming],
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeWarning("");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeWarning(
            "Live message updates are temporarily unavailable. Reopen the conversation to refresh.",
          );
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [serviceRequestId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send() {
    const content = text.trim();
    if (!content || !user || sending) return;
    if (content.length > 2000) {
      toast.error("Message is too long", {
        description: "Keep messages under 2,000 characters.",
      });
      return;
    }

    setSending(true);
    const result = await createClient()
      .from("messages")
      .insert({
        service_request_id: serviceRequestId,
        sender_id: user.id,
        sender_role: "homeowner",
        content,
      })
      .select(
        "id, service_request_id, sender_id, sender_role, content, created_at",
      )
      .single();
    setSending(false);

    if (result.error || !result.data) {
      toast.error("Message could not be sent", {
        description: result.error?.message ?? "Please try again.",
      });
      return;
    }

    const sent = result.data as Message;
    setMessages((current) =>
      current.some((message) => message.id === sent.id)
        ? current
        : [...current, sent],
    );
    setText("");
    onSent();
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <span className="sr-only">Loading messages</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div>
          <AlertCircle className="mx-auto mb-3 h-9 w-9 text-destructive" />
          <p className="font-medium">This conversation couldn’t be loaded</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void loadMessages()}
          >
            <RefreshCw />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {realtimeWarning && (
        <div
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
        >
          {realtimeWarning}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="py-12 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No messages yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Send a message about this service when you’re ready.
              </p>
            </div>
          )}
          {messages.map((message) => {
            const mine = message.sender_id === user?.id;
            const admin = message.sender_role === "admin";
            return (
              <div
                key={message.id}
                className={cn(
                  "flex max-w-[88%] gap-3 sm:max-w-[80%]",
                  mine && "ml-auto flex-row-reverse",
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    mine
                      ? "bg-accent text-accent-foreground"
                      : admin
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground",
                  )}
                >
                  <User className="h-4 w-4" />
                </div>
                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm",
                    mine
                      ? "ml-auto rounded-br-md bg-accent text-accent-foreground"
                      : admin
                        ? "rounded-bl-md bg-primary text-primary-foreground"
                        : "rounded-bl-md bg-muted text-foreground",
                  )}
                >
                  <p className="mb-1 text-xs font-medium opacity-70">
                    {mine
                      ? "You"
                      : admin
                        ? "Mercurius Support"
                        : providerName}
                  </p>
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {message.content}
                  </p>
                  <p className="mt-1 text-right text-[11px] opacity-50">
                    {messageTime(message.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background p-3 sm:p-4">
        <div className="mx-auto flex max-w-2xl gap-2 sm:gap-3">
          <Input
            aria-label="Message"
            placeholder="Type a message..."
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            className="h-12"
            disabled={sending}
          />
          <Button
            size="lg"
            className="h-12 shrink-0 bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
            aria-label="Send message"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>{children}</main>
    </div>
  );
}

function PageState({
  icon: Icon,
  title,
  copy,
  action,
}: {
  icon: typeof AlertCircle;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center p-8 text-center">
      <div>
        <Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {copy}
        </p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />
      <span className="text-muted-foreground">Loading messages...</span>
    </div>
  );
}

function messageTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function relativeTime(value: string) {
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
