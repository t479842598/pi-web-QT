"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BookmarkSimple, Trash, X } from "@phosphor-icons/react";
import { listTaskTemplates, saveTaskTemplate, deleteTaskTemplate } from "@/lib/task-api";
import type { WorkTask, WorkTaskTemplate } from "@/lib/task-types";

interface TaskEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing task to edit, or null for a blank create. */
  task: WorkTask | null;
  /** Preselected project for a create (the board's folder filter). */
  defaultProject: string | null;
  /** Prefill for a create from a message (title + prompt seed). */
  prefillTitle?: string;
  prefillPrompt?: string;
  /** Selectable projects (board's allProjects list). */
  projects: string[];
  onSubmit: (projectRoot: string, title: string, config: { prompt: string; agentType?: string | null; modelId?: string | null; thinkingLevel?: string | null }) => Promise<void>;
}

export function TaskEditorDialog({
  open,
  onOpenChange,
  task,
  defaultProject,
  projects,
  prefillTitle,
  prefillPrompt,
  onSubmit,
}: TaskEditorDialogProps) {
  const { t } = useI18n();

  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [templates, setTemplates] = useState<WorkTaskTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);

  // Initialize the form only once per open. The board's provider refetches the
  // task/project list on a 60s timer, SSE nudges, and visibility/online events;
  // every refetch mints a new `projects` array, which re-ran this effect while
  // the user was typing and wiped a fresh task's title/prompt (task === null →
  // fields reset to ""). The ref guard makes re-runs while open a no-op.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setProject(task?.projectRoot ?? defaultProject ?? projects[0] ?? "");
    setTitle(task?.title ?? prefillTitle ?? "");
    setPrompt(task?.config?.prompt ?? prefillPrompt ?? "");
    void listTaskTemplates().then(setTemplates).catch(() => undefined);
  }, [open, task, defaultProject, projects, prefillTitle, prefillPrompt]);

  if (!open) return null;

  const submit = async () => {
    if (!project || !title.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(project, title.trim(), {
        prompt: prompt.trim(),
        agentType: task?.config?.agentType ?? null,
        modelId: task?.config?.modelId ?? null,
        thinkingLevel: task?.config?.thinkingLevel ?? null,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("submit task failed", error);
    } finally {
      setBusy(false);
    }
  };

  const saveAsTemplate = async () => {
    if (!templateName.trim() || !title.trim()) return;
    try {
      await saveTaskTemplate({
        name: templateName.trim(),
        title: title.trim(),
        config: { prompt: prompt.trim() },
      });
      setTemplateName("");
      void listTaskTemplates().then(setTemplates).catch(() => undefined);
    } catch (error) {
      console.error("save template failed", error);
    }
  };

  const applyTemplate = (template: WorkTaskTemplate) => {
    setTitle(template.title);
    setPrompt(template.config?.prompt ?? "");
  };

  const removeTemplate = async (id: number) => {
    try {
      await deleteTaskTemplate(id);
      void listTaskTemplates().then(setTemplates).catch(() => undefined);
    } catch (error) {
      console.error("delete template failed", error);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 900,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div style={{
        width: "min(520px, calc(100vw - 48px))",
        maxHeight: "80vh", overflowY: "auto",
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {task ? t("tasks.editTitle") : t("tasks.newTitle")}
          </h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("i18n.close")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px 16px" }}>
          {/* Templates */}
          {templates.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("tasks.templates")}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {templates.map((template) => (
                  <span key={template.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, background: "var(--bg-hover)", padding: "3px 8px", fontSize: 11 }}>
                    <button type="button" onClick={() => applyTemplate(template)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text)", fontSize: 11, padding: 0 }}>
                      {template.name}
                    </button>
                    <button type="button" onClick={() => void removeTemplate(template.id)} aria-label={t("tasks.deleteTemplate")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", padding: 0, display: "flex" }}>
                      <Trash size={10} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{t("tasks.fieldProject")}</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} style={inputStyle}>
              {projects.map((p) => (
                <option key={p} value={p}>{p.split("/").filter(Boolean).pop() ?? p}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{t("tasks.fieldTitle")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("tasks.fieldTitlePlaceholder")}
              style={inputStyle}
              autoFocus
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{t("tasks.fieldPrompt")}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("tasks.fieldPromptPlaceholder")}
              rows={6}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            />
          </label>

          {/* Save as template */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={t("tasks.templateNamePlaceholder")}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => void saveAsTemplate()}
              disabled={!templateName.trim() || !title.trim()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "8px 12px", borderRadius: 8,
                background: "var(--bg-hover)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 12, cursor: "pointer",
              }}
            >
              <BookmarkSimple size={13} aria-hidden="true" />
              {t("tasks.saveAsTemplate")}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{ padding: "8px 14px", borderRadius: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}
            >
              {t("i18n.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!project || !title.trim() || busy}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t("tasks.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
