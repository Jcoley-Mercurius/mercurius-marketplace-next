type FunctionErrorContext = {
  body?: unknown;
  json?: () => Promise<unknown>;
  clone?: () => FunctionErrorContext;
};

type FunctionErrorLike = Error & { context?: FunctionErrorContext };

export type PaymentFunctionError = {
  code?: string;
  message: string;
};

/** Extracts the structured response returned by a Supabase Edge Function. */
export async function paymentFunctionError(error: unknown): Promise<PaymentFunctionError> {
  const fallback = error instanceof Error ? error.message : "The secure payment service could not be reached.";
  const context = (error as FunctionErrorLike | null)?.context;

  try {
    if (typeof context?.body === "string") {
      return normalize(JSON.parse(context.body), fallback);
    }
    if (context?.body && typeof context.body === "object") {
      return normalize(context.body, fallback);
    }
    const readable = context?.clone?.() ?? context;
    if (typeof readable?.json === "function") {
      return normalize(await readable.json(), fallback);
    }
  } catch {
    // Fall back to the client error below when the response has no JSON body.
  }

  return { message: fallback };
}

function normalize(value: unknown, fallback: string): PaymentFunctionError {
  if (!value || typeof value !== "object") return { message: fallback };
  const record = value as Record<string, unknown>;
  return {
    code: typeof record.error === "string" ? record.error : undefined,
    message: typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : fallback,
  };
}
