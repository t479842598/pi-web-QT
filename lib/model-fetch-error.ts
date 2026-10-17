/**
 * Turning a failed /models discovery into one stable, displayable error.
 *
 * WHY kinds and not messages: the route reports failures with mixed shapes
 * (thrown fetch errors, thrown timeout errors, HTTP status codes, JSON parse
 * errors), and the UI needs a machine-readable kind to choose its next action.
 * The English `message` is chrome only; translation belongs to the caller.
 */

export type ModelsFetchErrorKind =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "rateLimited"
  | "upstream"
  | "timeout"
  | "network"
  | "invalidResponse"
  | "unknown";

export interface ModelsFetchError {
  kind: ModelsFetchErrorKind;
  message: string;
  httpStatus?: number;
}

const MESSAGES: Record<ModelsFetchErrorKind, string> = {
  unauthorized: "The provider rejected the API key. Check the key and try again.",
  forbidden: "The provider refused access to the model list for this key.",
  notFound: "The endpoint has no model list at this address. Enter models manually.",
  rateLimited: "The provider is rate limiting requests. Wait a moment and retry.",
  upstream: "The provider failed while listing models. Retry, or enter models manually.",
  timeout: "The model list request timed out.",
  network: "Could not reach the endpoint. Check the base URL and the network.",
  invalidResponse: "The endpoint answered with something that is not a model list.",
  unknown: "Listing models failed.",
};

function statusFrom(kind: ModelsFetchErrorKind, httpStatus: number | undefined): ModelsFetchError {
  const error: ModelsFetchError = { kind, message: MESSAGES[kind] };
  if (typeof httpStatus === "number" && Number.isFinite(httpStatus)) error.httpStatus = httpStatus;
  return error;
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError
    || (typeof error === "object" && error !== null && errorName(error) === "SyntaxError");
}

/**
 * Normalizes any failure from the discovery path into a typed error.
 * WHY status wins over the thrown value: a provider that answers 429 with a
 * readable body must be retried, not reported as an opaque network failure.
 */
export function describeModelsFetchError(error: unknown, httpStatus?: number): ModelsFetchError {
  if (typeof httpStatus === "number" && Number.isFinite(httpStatus)) {
    if (httpStatus === 401) return statusFrom("unauthorized", httpStatus);
    if (httpStatus === 403) return statusFrom("forbidden", httpStatus);
    if (httpStatus === 404) return statusFrom("notFound", httpStatus);
    if (httpStatus === 429) return statusFrom("rateLimited", httpStatus);
    if (httpStatus >= 500) return statusFrom("upstream", httpStatus);
  }

  const name = errorName(error);
  if (name === "TimeoutError" || name === "AbortError") return statusFrom("timeout", httpStatus);
  if (isJsonSyntaxError(error)) return statusFrom("invalidResponse", httpStatus);
  if (error instanceof TypeError || name === "TypeError") return statusFrom("network", httpStatus);

  return statusFrom("unknown", httpStatus);
}
