export type OcrFailureKind =
  | "not_configured"
  | "configuration"
  | "authentication"
  | "quota"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "network"
  | "bad_request"
  | "invalid_response"
  | "document_limit"
  | "conversion"
  | "refused";

// Only allowlisted diagnostics cross the adapter boundary. Never retain provider
// messages, request bodies, API keys, response text, or document data in errors/logs.
export class OcrFailure extends Error {
  kind: OcrFailureKind;
  httpStatus?: number;
  retryAfterMs?: number;
  constructor(
    kind: OcrFailureKind,
    httpStatus?: number,
    retryAfterMs?: number,
  ) {
    super(kind);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
  get retryable() {
    return ["rate_limit", "unavailable", "timeout", "network"].includes(
      this.kind,
    );
  }
  get fallbackAllowed() {
    return this.kind !== "refused" && this.kind !== "bad_request";
  }
}

export function providerConfig(key: string | undefined, model: string) {
  if (!key?.trim()) throw new OcrFailure("not_configured");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model))
    throw new OcrFailure("configuration");
  return { key: key.trim(), model };
}

export async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error" });
  } catch {
    throw new OcrFailure(init.signal?.aborted ? "timeout" : "network");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (init.signal?.aborted) throw new OcrFailure("timeout");
    if (response.ok) throw new OcrFailure("invalid_response", response.status);
  }
  if (!response.ok) {
    const error = (
      body as { error?: { code?: unknown; type?: unknown } } | undefined
    )?.error;
    const code = error?.code ?? error?.type;
    const status = response.status;
    const kind: OcrFailureKind =
      code === "insufficient_quota" ||
      code === "billing_hard_limit_reached" ||
      status === 402
        ? "quota"
        : status === 401 || status === 403
          ? "authentication"
          : status === 404
            ? "configuration"
            : status === 429
              ? "rate_limit"
              : status === 408 || status === 504
                ? "timeout"
                : status >= 500
                  ? "unavailable"
                  : "bad_request";
    const header = response.headers.get("retry-after");
    let retryAfterMs: number | undefined;
    if (header) {
      const seconds = Number(header);
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(header) - Date.now();
      if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
    }
    throw new OcrFailure(kind, status, retryAfterMs);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new OcrFailure("invalid_response");
  return body as Record<string, unknown>;
}
