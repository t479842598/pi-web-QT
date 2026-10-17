/**
 * Guessing the api dialect of an endpoint the user typed.
 *
 * WHY this is a separate pure module: the guess is only ever a *suggestion*. It
 * must be table-driven and testable on its own, because a wrong silent rewrite
 * of models.json turns a working provider into a 404 loop.
 */

export interface EndpointDraftInput {
  baseUrl: string;
  /** 当前表单里的 api 值 */
  current: string;
  /** true 表示用户手选过 / 预设自带 / 该行已存值 */
  locked: boolean;
}

export interface EndpointDraft {
  api: string;
  autoDetected: boolean;
  /** 非空时 UI 必须显示这一行，禁止静默改写 */
  note?: string;
}

interface HostRule {
  pattern: RegExp;
  api: string;
}

// Host beats path: a vendor host says more than a path fragment does.
const HOST_RULES: readonly HostRule[] = [
  { pattern: /(^|\.)anthropic\.com$/i, api: "anthropic-messages" },
  { pattern: /(^|\.)generativelanguage\.googleapis\.com$/i, api: "google-generative-ai" },
  { pattern: /(^|\.)mistral\.ai$/i, api: "mistral-conversations" },
];

/**
 * Infers the api dialect a base URL most likely speaks, or undefined when the
 * endpoint is indistinguishable (a localhost proxy, a generic /v1 gateway).
 * WHY: undefined is the only safe answer for "I cannot tell" — the caller then
 * keeps whatever api value the form already holds.
 */
export function inferApiStyle(baseUrl: string | undefined): string | undefined {
  if (typeof baseUrl !== "string") return undefined;
  const trimmed = baseUrl.trim();
  if (!trimmed) return undefined;

  let host = "";
  let path = "";
  try {
    const url = new URL(trimmed);
    host = url.hostname.toLocaleLowerCase().replace(/\.$/, "");
    path = url.pathname.toLocaleLowerCase().replace(/\/+$/, "");
  } catch {
    // Not a URL: fall back to treating the whole string as a path-ish fragment.
    path = trimmed.toLocaleLowerCase();
  }

  if (host) {
    for (const rule of HOST_RULES) {
      if (rule.pattern.test(host)) return rule.api;
    }
  }

  if (path.includes("/v1/messages")) return "anthropic-messages";
  if (path.includes("/v1beta")) return "google-generative-ai";
  if (host === "api.openai.com" && path.includes("/v1/responses")) return "openai-responses";
  if (/\/responses$/.test(path)) return "openai-responses";

  return undefined;
}

/**
 * Returns the user-facing name of an api dialect.
 * WHY: the note shown next to the field is English chrome, not translated copy,
 * and must never be assembled from the raw models.json key.
 */
export function apiStyleLabel(api: string): string {
  switch (api) {
    case "openai-completions":
      return "OpenAI Chat Completions";
    case "openai-responses":
      return "OpenAI Responses";
    case "anthropic-messages":
      return "Anthropic Messages";
    case "google-generative-ai":
      return "Google Generative AI";
    case "mistral-conversations":
      return "Mistral Conversations";
    default:
      return api;
  }
}

/**
 * Decides the api value a form row should show after the base URL changed.
 * WHY: a detected change is only allowed to reach models.json together with a
 * visible note, so the promise "never silently rewrite" is structural.
 */
export function resolveEndpointDraft(input: EndpointDraftInput): EndpointDraft {
  if (input.locked) return { api: input.current, autoDetected: false };

  const inferred = inferApiStyle(input.baseUrl);
  if (inferred && inferred !== input.current) {
    return {
      api: inferred,
      autoDetected: true,
      note: `检测到端点格式：${apiStyleLabel(inferred)}`,
    };
  }
  return { api: input.current, autoDetected: false };
}
