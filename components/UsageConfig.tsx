"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatTokenCount } from "@/lib/token-format";
import type { UsageReport } from "@/app/api/usage/route";

interface UsageConfigProps {
  /** Current session id — drives the "current session" view. */
  sessionId: string | null;
  cwd: string | null;
}

interface SessionUsageState {
  percent: number | null;
  contextWindow: number | null;
  tokens: number | null;
}

const BAR_MAX_WIDTH = 8;
const DAYS_SHOWN = 14;

function formatToken(n: number | null | undefined): string {
  return n == null ? "—" : formatTokenCount(n);
}

/** Settings tab showing token usage. Both scopes render together: the current
 *  session's live context usage on top, and a global estimate across all
 *  sessions below — no tab switching. */
export function UsageConfig({ sessionId, cwd }: UsageConfigProps) {
  const { t } = useI18n();
  const [sessionUsage, setSessionUsage] = useState<SessionUsageState | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(false);

  // Current session: live context usage from the agent state endpoint.
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setSessionUsage(null);
      return;
    }
    fetch(`/api/agent/${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const usage = data?.state?.contextUsage;
        setSessionUsage(usage ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Global: scan all sessions (server-side estimate).
  const loadGlobal = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setReport(await res.json() as UsageReport);
    } catch {
      // Keep previous report.
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadGlobal();
  }, [loadGlobal]);

  const daily = useMemo(() => report?.daily.slice(-DAYS_SHOWN) ?? [], [report]);
  const maxDay = useMemo(
    () => daily.reduce((m, d) => Math.max(m, d.tokens), 0),
    [daily],
  );

  return (
    <div style={{ flex: 1, overflow: "auto", minWidth: 0, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("desktop.usage")}</h3>

      {/* Current session — always visible, no tab switching. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{t("desktop.usageSession")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sessionId ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, borderRadius: 12, border: "1px solid var(--border)", padding: 16 }}>
              {sessionUsage ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    {/* Progress ring */}
                    <svg width={72} height={72} viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
                      <circle cx={36} cy={36} r={30} fill="none" stroke="var(--border)" strokeWidth={7} />
                      <circle
                        cx={36} cy={36} r={30} fill="none"
                        stroke="var(--accent)"
                        strokeWidth={7}
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 30}
                        strokeDashoffset={2 * Math.PI * 30 * (1 - Math.min(1, (sessionUsage.percent ?? 0) / 100))}
                        transform="rotate(-90 36 36)"
                        style={{ transition: "stroke-dashoffset 0.4s ease" }}
                      />
                      <text x={36} y={41} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--text)">
                        {sessionUsage.percent != null ? `${sessionUsage.percent.toFixed(0)}%` : "?"}
                      </text>
                    </svg>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 13, color: "var(--text)" }}>
                        {t("desktop.usageContext", {
                          used: formatToken(sessionUsage.tokens),
                          window: formatToken(sessionUsage.contextWindow),
                        })}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {t("desktop.usageContextHint")}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("desktop.usageNoSessionData")}
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("desktop.usageNoSession")}
            </span>
          )}
          {cwd && (
            <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cwd}
            </span>
          )}
        </div>
      </div>

      {/* Global — always visible below the session card. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{t("desktop.usageGlobal")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {[
              { label: t("desktop.usageTotal"), value: formatToken(report?.totalTokens), sub: report ? `${report.totalSessions} ${t("desktop.usageSessions")}` : "…" },
              { label: t("desktop.usageMessages"), value: report ? String(report.messageCount) : "…", sub: t("desktop.usageMessagesHint") },
            ].map((card) => (
              <div key={card.label} style={{ borderRadius: 12, border: "1px solid var(--border)", padding: "12px 14px", background: "var(--bg-panel)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{card.value}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Daily bars */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
              {t("desktop.usageDaily")}
            </div>
            {daily.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{loading ? t("desktop.featuresLoading") : t("desktop.usageNoData")}</div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96, overflowX: "auto" }}>
                {daily.map((d) => {
                  const h = maxDay > 0 ? Math.max(4, Math.round((d.tokens / maxDay) * 72)) : 4;
                  return (
                    <div key={d.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{d.tokens > 0 ? formatToken(d.tokens) : ""}</div>
                      <div style={{ width: BAR_MAX_WIDTH, height: h, borderRadius: 4, background: d.tokens > 0 ? "var(--accent)" : "var(--bg-hover)", opacity: d.tokens > 0 ? 0.85 : 1 }} title={`${d.day}: ${formatToken(d.tokens)}`} />
                      <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{d.day.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Session list */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              {t("desktop.usageTopSessions")}
            </div>
            {report && report.sessions.length === 0 ? (
              <div style={{ padding: "14px", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.usageNoData")}</div>
            ) : (
              (report?.sessions ?? []).slice(0, 12).map((s) => (
                <div key={s.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name ?? s.firstMessage ?? s.id}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {formatToken(s.tokens)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
