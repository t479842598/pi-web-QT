"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, Spinner, CheckCircle, Warning, X, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

// ============================================================================
// 类型
// ============================================================================

interface ImportSourceInfo {
  key: string;
  label: string;
  available: boolean;
  status: "available" | "unavailable" | "coming-soon";
}

interface ReasonixProject {
  name: string;
  sessions: number;
  piCwdDir: string;
  matched: boolean;
  existingCount: number;
}

interface DiscoverData {
  sources: ImportSourceInfo[];
  reasonix: {
    available: boolean;
    projects: ReasonixProject[];
    totalSessions: number;
  };
}

// ============================================================================
// 底部 Sheet 组件（移动端）
// ============================================================================

function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1001,
          background: visible ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)",
          transition: "background 0.25s ease",
        }}
      />
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1002,
          maxHeight: "85dvh", borderRadius: "16px 16px 0 0",
          background: "var(--bg)", boxShadow: "0 -4px 24px rgba(0,0,0,0.15)",
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", justifyContent: "center", padding: "10px 0 4px",
          flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            background: "var(--border)",
          }} />
        </div>
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {children}
        </div>
      </div>
    </>
  );
}

// ============================================================================
// 主组件
// ============================================================================

interface Props {
  /** 当会话列表需要刷新时回调（导入完成后） */
  onSessionsChanged?: () => void;
}

export function ImportSessionsConfig({ onSessionsChanged }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  // ── 来源选择 ──
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [sources, setSources] = useState<ImportSourceInfo[]>([]);
  const [reasonixData, setReasonixData] = useState<ReasonixProject[]>([]);

  // ── 项目选择 ──
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

  // ── 导入进度 ──
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ imported: 0, skipped: 0, errors: 0, total: 0, done: false });
  const [importedIds, setImportedIds] = useState<string[]>([]);

  // ── 标题生成 ──
  const [generatingTitles, setGeneratingTitles] = useState(false);
  const [titleProgress, setTitleProgress] = useState({ done: 0, total: 0 });

  // ── 状态 ──
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // ========================================================================
  // 发现阶段
  // ========================================================================

  const loadDiscover = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import/discover");
      const data = (await res.json()) as DiscoverData & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSources(data.sources);
      if (data.reasonix?.available) {
        setReasonixData(data.reasonix.projects);
        setSelectedSource("reasonix");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 发现
  const [discovered, setDiscovered] = useState(false);
  useEffect(() => {
    if (!discovered) {
      setDiscovered(true);
      void loadDiscover();
    }
  }, [discovered, loadDiscover]);

  // ========================================================================
  // 执行导入
  // ========================================================================

  const startImport = useCallback(async () => {
    if (selectedProjects.size === 0 || !selectedSource) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: selectedSource,
          projects: [...selectedProjects],
        }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobId(data.jobId!);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedSource, selectedProjects]);

  // ========================================================================
  // 轮询进度
  // ========================================================================

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/import/status?jobId=${encodeURIComponent(jobId)}`);
        const data = (await res.json()) as {
          done?: boolean; imported?: number; skipped?: number;
          errors?: number; total?: number; sessionIds?: string[];
        };
        if (!active) return;
        setProgress({
          imported: data.imported ?? 0,
          skipped: data.skipped ?? 0,
          errors: data.errors ?? 0,
          total: data.total ?? 0,
          done: data.done ?? false,
        });
        if (data.done && data.sessionIds) {
          setImportedIds(data.sessionIds);
          onSessionsChanged?.();
        }
        if (!data.done) {
          timer = setTimeout(poll, 800);
        }
      } catch {
        if (active) timer = setTimeout(poll, 2000);
      }
    };

    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, onSessionsChanged]);

  // ========================================================================
  // 批量生成标题
  // ========================================================================

  // 并发上限：同时跑太多标题请求会挤占资源、拖慢整体并容易超时。
  // 用并发池并行 + 单条失败跳过，互不牵连（修复"一个在生成其他就 500"）。
  const generateTitles = useCallback(async () => {
    if (importedIds.length === 0) return;
    setGeneratingTitles(true);
    setTitleProgress({ done: 0, total: importedIds.length });

    const CONCURRENCY = 4;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < importedIds.length) {
        const index = nextIndex++;
        const id = importedIds[index];
        if (!id) continue;
        try {
          await fetch(`/api/sessions/${encodeURIComponent(id)}/auto-name`, { method: "POST" });
        } catch { /* skip errors */ }
        setTitleProgress({ done: index + 1, total: importedIds.length });
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, importedIds.length) }, worker);
    await Promise.all(workers);

    setGeneratingTitles(false);
    onSessionsChanged?.();
  }, [importedIds, onSessionsChanged]);

  // ========================================================================
  // 选择/取消
  // ========================================================================

  const toggleProject = (name: string) => {
    setSelectedProjects(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelectedProjects(new Set(reasonixData.map(p => p.name)));
  const deselectAll = () => setSelectedProjects(new Set());

  const reset = () => {
    setJobId(null);
    setProgress({ imported: 0, skipped: 0, errors: 0, total: 0, done: false });
    setImportedIds([]);
    setGeneratingTitles(false);
    setTitleProgress({ done: 0, total: 0 });
  };

  // ========================================================================
  // 渲染：完成态
  // ========================================================================

  if (progress.done && importedIds.length > 0) {
    return (
      <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle size={20} weight="fill" style={{ color: "#4ade80" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            {t("desktop.importDone") ?? "导入完成"}
          </span>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {t("desktop.importedSummary", { imported: progress.imported }) ??
            `成功导入 ${progress.imported} 个会话`}
          {progress.skipped > 0 && (
            <span style={{ marginLeft: 8 }}>
              {t("desktop.importSkippedCount", { skipped: progress.skipped }) ??
                `，${progress.skipped} 个跳过`}
            </span>
          )}
          {progress.errors > 0 && (
            <span style={{ marginLeft: 8, color: "#ef4444" }}>
              {t("desktop.importErrorsCount", { errors: progress.errors }) ??
                `，${progress.errors} 个失败`}
            </span>
          )}
        </div>

        {generatingTitles ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
            <Spinner size={14} style={{ animation: "spin 1s linear infinite" }} />
            {t("desktop.importGeneratingTitles") ?? "正在生成标题…"}
            {" "}({titleProgress.done}/{titleProgress.total})
          </div>
        ) : (
          <button
            type="button"
            onClick={generateTitles}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "8px 14px", background: "var(--accent)", border: "none",
              borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: "pointer", alignSelf: "flex-start",
            }}
          >
            <ArrowCounterClockwise size={15} />
            {t("desktop.importGenerateTitles") ?? "为导入的会话生成标题"}
          </button>
        )}

        <button
          type="button"
          onClick={reset}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "8px 14px", background: "none", border: "1px solid var(--border)",
            borderRadius: 6, color: "var(--text-muted)", fontSize: 12,
            cursor: "pointer", alignSelf: "flex-start",
          }}
        >
          {t("desktop.importAgain") ?? "再次导入"}
        </button>
      </div>
    );
  }

  // ========================================================================
  // 渲染：主界面
  // ========================================================================

  const content = (
    <div style={{ padding: isMobile ? "12px 18px" : "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 错误 */}
      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
          <Warning size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* 来源选择 */}
      {!jobId && (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {t("desktop.importSessionsDesc") ?? "从其他 AI 编码工具导入历史对话记录到 pi-web。目前支持 Reasonix，更多工具陆续支持中。"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sources.map(src => (
              <label
                key={src.key}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", border: "1px solid var(--border)",
                  borderRadius: 8, cursor: src.status === "available" ? "pointer" : "default",
                  background: selectedSource === src.key ? "var(--bg-selected)" : "var(--bg-panel)",
                  opacity: src.status === "unavailable" ? 0.5 : src.status === "coming-soon" ? 0.7 : 1,
                  transition: "background 0.12s",
                }}
              >
                <input
                  type="radio"
                  name="import-source"
                  value={src.key}
                  checked={selectedSource === src.key}
                  disabled={src.status !== "available"}
                  onChange={() => setSelectedSource(src.key)}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {src.label}
                  </div>
                  {src.status === "coming-soon" && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>
                      {t("desktop.comingSoon") ?? "即将支持"}
                    </div>
                  )}
                </div>
                {src.key === "reasonix" && reasonixData.length > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {reasonixData.length} {t("desktop.projects") ?? "个项目"} · {reasonixData.reduce((s, p) => s + p.sessions, 0)} {t("desktop.sessions") ?? "会话"}
                  </span>
                )}
              </label>
            ))}
          </div>

          {/* Reasonix 项目列表 */}
          {selectedSource === "reasonix" && reasonixData.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  {t("desktop.importSelectProjects") ?? "选择要导入的项目"}
                </span>
                <button type="button" onClick={selectAll} style={linkBtnStyle}>
                  {t("desktop.importSelectAll") ?? "全选"}
                </button>
                <button type="button" onClick={deselectAll} style={linkBtnStyle}>
                  {t("desktop.importDeselectAll") ?? "取消全选"}
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {reasonixData.map(proj => (
                  <label
                    key={proj.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", border: "1px solid var(--border)",
                      borderRadius: 6, cursor: "pointer",
                      background: selectedProjects.has(proj.name) ? "var(--bg-selected)" : "transparent",
                      transition: "background 0.12s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjects.has(proj.name)}
                      onChange={() => toggleProject(proj.name)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {proj.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                        {proj.sessions} {t("desktop.sessions") ?? "会话"}
                        {proj.matched && (
                          <span style={{ marginLeft: 8, color: "var(--accent)" }}>
                            → {t("desktop.importMerged") ?? "合并到现有项目"}
                            {proj.existingCount > 0 && ` (${t("desktop.importExistingCount", { count: proj.existingCount }) ?? `${proj.existingCount} 个已有`})`}
                          </span>
                        )}
                        {!proj.matched && (
                          <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                            → {t("desktop.importNewProject") ?? "新建项目"}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={startImport}
                disabled={loading || selectedProjects.size === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "8px 14px", background: "var(--accent)", border: "none",
                  borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600,
                  cursor: selectedProjects.size === 0 ? "not-allowed" : "pointer",
                  alignSelf: "flex-start",
                  opacity: selectedProjects.size === 0 ? 0.5 : 1,
                }}
              >
                {loading ? (
                  <><Spinner size={14} style={{ animation: "spin 1s linear infinite" }} /> {t("desktop.importing") ?? "导入中…"}</>
                ) : (
                  <><DownloadSimple size={15} /> {t("desktop.importStart") ?? "开始导入"}</>
                )}
              </button>
            </>
          )}

          {/* 无数据 */}
          {selectedSource === "reasonix" && reasonixData.length === 0 && !loading && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>
              {t("desktop.importNoData") ?? "未找到 Reasonix 数据。请确认 ~/.reasonix/projects/ 目录存在且包含会话文件。"}
            </div>
          )}
        </>
      )}

      {/* 进度条 */}
      {jobId && !progress.done && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)" }}>
            <Spinner size={14} style={{ animation: "spin 1s linear infinite" }} />
            {t("desktop.importing") ?? "导入中…"}
          </div>
          <div style={{
            height: 6, borderRadius: 3, background: "var(--bg-panel)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%", borderRadius: 3,
              background: "var(--accent)",
              width: `${progress.total > 0 ? (progress.imported + progress.skipped + progress.errors) / progress.total * 100 : 0}%`,
              transition: "width 0.3s ease",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {progress.imported + progress.skipped + progress.errors} / {progress.total}
            {progress.skipped > 0 && ` · ${t("desktop.importSkippedCount", { skipped: progress.skipped }) ?? `${progress.skipped} 跳过`}`}
          </div>
        </div>
      )}
    </div>
  );

  // ========================================================================
  // 移动端：底部 Sheet
  // ========================================================================

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", width: "100%",
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            borderRadius: 8, color: "var(--text)", fontSize: 12, cursor: "pointer",
          }}
        >
          <DownloadSimple size={16} />
          <span style={{ fontWeight: 500 }}>{t("desktop.importSessions") ?? "导入会话"}</span>
        </button>

        <BottomSheet open={mobileSheetOpen} onClose={() => setMobileSheetOpen(false)}>
          <div style={{ padding: "4px 18px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("desktop.importSessions") ?? "导入会话"}
            </span>
            <button onClick={() => setMobileSheetOpen(false)} style={closeBtnStyle}>
              <X size={18} />
            </button>
          </div>
          {content}
        </BottomSheet>
      </>
    );
  }

  // ========================================================================
  // 桌面端：直接嵌入
  // ========================================================================

  return content;
}

const linkBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "var(--accent)",
  fontSize: 11, cursor: "pointer", padding: "2px 4px",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-muted)",
  cursor: "pointer", padding: 4, display: "flex",
};
