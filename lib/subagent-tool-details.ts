/**
 * Client-safe subagent shapes and guards.
 *
 * `lib/subagent-extension.ts` builds the actual `Agent` tool and therefore
 * imports the server-only Pi SDK (`@earendil-works/pi-coding-agent`). Anything
 * a client component needs must live here instead, or the whole SDK gets
 * pulled into the browser bundle.
 */

export interface SubagentToolDetails {
  kind: "pi-web-subagent";
  sessionId: string;
  profile: string;
  description: string;
  status: "starting" | "running" | "completed" | "failed" | "aborted" | "interrupted";
  runInBackground: boolean;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export type SubagentRunStatus = SubagentToolDetails["status"];

const SUBAGENT_STATUSES: readonly SubagentRunStatus[] = [
  "starting",
  "running",
  "completed",
  "failed",
  "aborted",
  "interrupted",
];

function isSubagentStatus(value: unknown): value is SubagentRunStatus {
  return typeof value === "string" && (SUBAGENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Narrow an untrusted tool-result `details` payload to subagent details.
 *
 * `status` is validated against the known set (not merely asserted): callers
 * render it as a status colour and label, and an unchecked value silently
 * falls through to "completed" — a failed run would be shown as a green
 * success.
 */
export function isSubagentToolDetails(value: unknown): value is SubagentToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<SubagentToolDetails>;
  return details.kind === "pi-web-subagent"
    && typeof details.sessionId === "string"
    && isSubagentStatus(details.status);
}
