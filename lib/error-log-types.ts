export type ErrorLogLevel = "error" | "warning" | "info";

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  level: ErrorLogLevel;
  statusCode?: number;
  source: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  message: string;
  details?: string;
}