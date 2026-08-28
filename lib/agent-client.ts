// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

export class AgentCommandError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly accepted?: boolean,
  ) {
    super(message);
    this.name = "AgentCommandError";
  }
}

export class AgentCommandTimeoutError extends Error {
  constructor(
    message: string,
    public readonly commandType: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = "AgentCommandTimeoutError";
  }
}

export function isPromptRejectedError(error: unknown): error is AgentCommandError {
  return error instanceof AgentCommandError
    && error.code === "prompt_rejected"
    && error.accepted === false;
}

export const AGENT_COMMAND_DEFAULT_TIMEOUT_MS = 30_000;

// Commands that legitimately block for minutes (LLM-driven manual compaction,
// synchronous bash execution): the server keeps working and the user is
// watching a spinner, so aborting client-side would only break the UX without
// stopping the work. 0 = never time out.
const UNBOUNDED_TIMEOUT_COMMANDS = new Set(["compact", "bash"]);

export function resolveAgentCommandTimeoutMs(
  command: Record<string, unknown>,
  options: { timeoutMs?: number },
): number {
  if (options.timeoutMs !== undefined) return options.timeoutMs;
  const type = typeof command.type === "string" ? command.type : "";
  if (UNBOUNDED_TIMEOUT_COMMANDS.has(type)) return 0;
  return AGENT_COMMAND_DEFAULT_TIMEOUT_MS;
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = resolveAgentCommandTimeoutMs(command, options);
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new AgentCommandTimeoutError(
        `Agent command "${String(command.type ?? "unknown")}" timed out after ${timeoutMs}ms`,
        String(command.type ?? "unknown"),
        timeoutMs,
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    code?: string;
    accepted?: boolean;
  };
  if (!res.ok || body.error) {
    throw new AgentCommandError(
      body.error ?? `HTTP ${res.status}`,
      res.status,
      body.code,
      body.accepted,
    );
  }
  return body.data as T;
}
