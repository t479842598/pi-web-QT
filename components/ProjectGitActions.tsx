"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Archive, CheckCircle, CloudArrowUp, XCircle } from "@phosphor-icons/react";
import { StashDialog } from "./StashDialog";

interface ProjectGitActionsProps {
  cwd: string | null;
}

/** Push + stash actions for the current project directory, shown in the
 *  session info bar. Compact icon buttons with transient result feedback. */
export function ProjectGitActions({ cwd }: ProjectGitActionsProps) {
  const { t } = useI18n();
  const [pushing, setPushing] = useState(false);
  const [pushState, setPushState] = useState<"idle" | "ok" | "error">("idle");
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [stashOpen, setStashOpen] = useState(false);

  const handlePush = useCallback(async () => {
    if (!cwd || pushing) return;
    setPushing(true);
    setPushState("idle");
    try {
      const res = await fetch(`/api/git/push?${new URLSearchParams({ cwd }).toString()}`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await res.json() as { ok?: boolean; error?: string; output?: string };
      if (res.ok && data.ok) {
        setPushState("ok");
        setPushMsg(data.output || t("desktop.pushOk"));
      } else {
        setPushState("error");
        setPushMsg(data.error ?? t("desktop.pushFailed"));
      }
    } catch (e) {
      setPushState("error");
      setPushMsg(e instanceof Error ? e.message : t("desktop.pushFailed"));
    } finally {
      setPushing(false);
      setTimeout(() => { setPushState("idle"); setPushMsg(null); }, 4000);
    }
  }, [cwd, pushing, t]);

  return (
    <>
      <button
        type="button"
        className="session-info-bar-button"
        onClick={() => void handlePush()}
        disabled={!cwd || pushing}
        title={t("desktop.push")}
        aria-label={t("desktop.push")}
        style={{ position: "relative" }}
      >
        {pushState === "ok" ? (
          <CheckCircle size={13} color="#22c55e" weight="fill" aria-hidden="true" />
        ) : pushState === "error" ? (
          <XCircle size={13} color="#ef4444" weight="fill" aria-hidden="true" />
        ) : (
          <CloudArrowUp size={13} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="session-info-bar-button"
        onClick={() => setStashOpen(true)}
        disabled={!cwd}
        title={t("desktop.stash")}
        aria-label={t("desktop.stash")}
      >
        <Archive size={13} aria-hidden="true" />
      </button>

      {pushMsg && (
        <div
          style={{
            position: "fixed", bottom: 60, left: "50%", transform: "translateX(-50%)",
            zIndex: 1200, maxWidth: "60vw",
            padding: "8px 14px", borderRadius: 8,
            background: "var(--bg-panel)", border: `1px solid ${pushState === "ok" ? "#22c55e" : "#ef4444"}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            fontSize: 12, color: pushState === "ok" ? "#22c55e" : "#ef4444",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}
        >
          {pushMsg}
        </div>
      )}

      <StashDialog open={stashOpen} onOpenChange={setStashOpen} cwd={cwd} />
    </>
  );
}
