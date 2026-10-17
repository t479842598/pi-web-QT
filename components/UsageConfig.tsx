"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sessionDisplayTitle } from "@/lib/session-display-title";
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
    <div className="settings-content-panel settings-content-stack" style={{ flex: 1, overflow: "auto", minWidth: 0, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 className="settings-content-title" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ds-text-primary)" }}>{t("desktop.usage")}</h3>

      {/* Current session — always visible, no tab switching. */}
      <div className="settings-content-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="settings-content-section-title" style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 600, color: "var(--ds-text-secondary)" }}>{t("desktop.usageSession")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sessionId ? (
            <div className="settings-content-card" style={{ display: "flex", flexDirection: "column", gap: 12, borderRadius: 'var(--radius-lg-plus)', border: "var(--settings-content-card-border, 1px solid var(--border))", padding: 16 }}>
              {sessionUsage ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    {/* Progress ring */}
                    <svg width={72} height={72} viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
                      <circle cx={36} cy={36} r={30} fill="none" stroke="var(--ds-border-default)" strokeWidth={7} />
                      <circle
                        cx={36} cy={36} r={30} fill="none"
                        stroke="var(--ds-accent)"
                        strokeWidth={7}
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 30}
                        strokeDashoffset={2 * Math.PI * 30 * (1 - Math.min(1, (sessionUsage.percent ?? 0) / 100))}
                        transform="rotate(-90 36 36)"
                        style={{ transition: "stroke-dashoffset 0.4s ease" }}
                      />
                      <text x={36} y={41} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--ds-text-primary)">
                        {sessionUsage.percent != null ? `${sessionUsage.percent.toFixed(0)}%` : "?"}
                      </text>
                    </svg>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 'var(--text-ui-base)', color: "var(--ds-text-primary)" }}>
                        {t("desktop.usageContext", {
                          used: formatToken(sessionUsage.tokens),
                          window: formatToken(sessionUsage.contextWindow),
                        })}
                      </span>
                      <span style={{ fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>
                        {t("desktop.usageContextHint")}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <span style={{ fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>
                  {t("desktop.usageNoSessionData")}
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>
              {t("desktop.usageNoSession")}
            </span>
          )}
          {cwd && (
            <span style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cwd}
            </span>
          )}
        </div>
      </div>

      {/* Global — always visible below the session card. */}
      <div className="settings-content-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="settings-content-section-title" style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 600, color: "var(--ds-text-secondary)" }}>{t("desktop.usageGlobal")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {[
              { label: t("desktop.usageTotal"), value: formatToken(report?.totalTokens), sub: report ? `${report.totalSessions} ${t("desktop.usageSessions")}` : "…" },
              { label: t("desktop.usageMessages"), value: report ? String(report.messageCount) : "…", sub: t("desktop.usageMessagesHint") },
            ].map((card) => (
              <div key={card.label} className="settings-content-card" style={{ borderRadius: 'var(--radius-lg-plus)', border: "var(--settings-content-card-border, 1px solid var(--border))", padding: "12px 14px", background: "var(--settings-content-card-bg, var(--bg-panel))" }}>
                <div style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ds-text-primary)" }}>{card.value}</div>
                <div style={{ fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-muted)", marginTop: 2 }}>{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Daily bars */}
          <div className="settings-content-card" style={{ borderRadius: 'var(--radius-lg-plus)', border: "var(--settings-content-card-border, 1px solid var(--border))", padding: "14px 16px" }}>
            <div style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 600, color: "var(--ds-text-primary)", marginBottom: 10 }}>
              {t("desktop.usageDaily")}
            </div>
            {daily.length === 0 ? (
              <div style={{ fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>{loading ? t("desktop.featuresLoading") : t("desktop.usageNoData")}</div>
            ) : (
              /* A bar strip is intrinsically wider than a phone column. It gets
                 its own horizontal scroll and a shrinkable width, so the card
                 stays inside the page instead of growing to fit every day. */
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96, minWidth: 0, maxWidth: "100%", overflowX: "auto", overflowY: "hidden" }}>
                {daily.map((d) => {
                  const h = maxDay > 0 ? Math.max(4, Math.round((d.tokens / maxDay) * 72)) : 4;
                  return (
                    <div key={d.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <div style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)" }}>{d.tokens > 0 ? formatToken(d.tokens) : ""}</div>
                      <div style={{ width: BAR_MAX_WIDTH, height: h, borderRadius: 'var(--radius-xs)', background: d.tokens > 0 ? "var(--ds-accent)" : "var(--ds-bg-hover)", opacity: d.tokens > 0 ? 0.85 : 1 }} title={`${d.day}: ${formatToken(d.tokens)}`} />
                      <div style={{ fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-muted)" }}>{d.day.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Session list */}
          <div className="settings-content-card" style={{ borderRadius: 'var(--radius-lg-plus)', border: "var(--settings-content-card-border, 1px solid var(--border))", overflow: "hidden" }}>
            <div className="settings-content-section-title" style={{ fontSize: 'var(--text-ui-sm)', fontWeight: 500, color: "var(--ds-text-primary)", padding: "10px 14px", borderBottom: "none", background: "var(--ds-tile)" }}>
              {t("desktop.usageTopSessions")}
            </div>
            {report && report.sessions.length === 0 ? (
              <div style={{ padding: "14px", fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-secondary)" }}>{t("desktop.usageNoData")}</div>
            ) : (
              (report?.sessions ?? []).slice(0, 12).map((s) => (
                <div key={s.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "none" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-ui-sm)', color: "var(--ds-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sessionDisplayTitle({ name: s.name, firstMessage: s.firstMessage, id: s.id })}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 'var(--text-ui-xs)', color: "var(--ds-text-secondary)", fontFamily: "var(--font-mono)" }}>
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
