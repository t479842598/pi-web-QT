export interface SessionTitleResult {
  title: string;
  usage?: unknown;
}

export class SessionTitleClientError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "SessionTitleClientError";
  }
}

export async function generateSessionTitleRequest(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionTitleResult> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
    method: "POST",
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as {
    title?: string;
    usage?: unknown;
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.title) {
    throw new SessionTitleClientError(body.error || `HTTP ${response.status}`, body.code);
  }
  return { title: body.title, usage: body.usage };
}

export async function cancelSessionTitleRequest(sessionId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
      method: "DELETE",
    });
    const body = (await response.json().catch(() => ({}))) as { cancelled?: boolean };
    return response.ok && body.cancelled === true;
  } catch {
    return false;
  }
}
