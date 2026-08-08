"use client";

import { useCallback, useEffect, useState } from "react";
import { ListBullets, Plus, Trash, PencilSimple, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { SettingCard, SettingRow, SettingRowLast, SettingNote } from "./SettingCard";

/** Broadcast when snippets change so ChatInput refreshes its autocomplete. */
export const SNIPPETS_CHANGED_EVENT = "pi:snippets-changed";

interface SnippetItem {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const inputStyle: React.CSSProperties = {
  padding: "7px 9px", background: "var(--bg-panel)", border: "1px solid var(--border)",
  borderRadius: 6, color: "var(--text)", fontSize: 12, width: "100%",
};

const buttonStyle: React.CSSProperties = {
  padding: "6px 12px", border: "none", borderRadius: 6,
  background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 12,
};

export function SnippetsConfig() {
  const { t } = useI18n();
  const [snippets, setSnippets] = useState<SnippetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SnippetItem | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/snippets");
      if (!res.ok) return;
      const data = await res.json() as { snippets?: SnippetItem[] };
      setSnippets(data.snippets ?? []);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const notifyChanged = useCallback(() => {
    window.dispatchEvent(new Event(SNIPPETS_CHANGED_EVENT));
  }, []);

  const startCreate = () => {
    setEditing(null);
    setName("");
    setContent("");
    setError(null);
  };

  const startEdit = (snippet: SnippetItem) => {
    setEditing(snippet);
    setName(snippet.name);
    setContent(snippet.content);
    setError(null);
  };

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t("desktop.snippetNameRequired")); return; }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const res = await fetch(`/api/snippets/${encodeURIComponent(editing.id)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, content }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const res = await fetch("/api/snippets", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, content }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      await load();
      notifyChanged();
      startCreate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editing, name, content, load, notifyChanged, t]);

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/snippets/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (editing?.id === id) startCreate();
      await load();
      notifyChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [editing, load, notifyChanged]);

  return (
    <SettingCard>
      <SettingRow>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 0" }}>
          <ListBullets size={15} aria-hidden="true" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("desktop.snippets")}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{t("desktop.snippetsDesc")}</div>
          </div>
        </div>
      </SettingRow>

      <SettingRow>
        <div style={{ width: "100%" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button type="button" onClick={startCreate} style={buttonStyle}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Plus size={13} /> {t("desktop.snippetNew")}</span>
            </button>
            {editing && (
              <button type="button" onClick={startCreate} style={{ ...buttonStyle, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                <X size={13} />
              </button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr", gap: 8, alignItems: "start", marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("desktop.snippetName")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="#name" style={inputStyle} />
            </div>
            <div>
              <span style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("desktop.snippetContent")}</span>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 11 }} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <button type="button" onClick={() => void save()} disabled={saving} style={{ ...buttonStyle, cursor: saving ? "wait" : "pointer" }}>
              {t("desktop.snippetSave")}
            </button>
            {error && <span style={{ color: "var(--status-error, #ef4444)", fontSize: 12 }}>{error}</span>}
          </div>

          {loading ? (
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.loadingThemes")}</span>
          ) : snippets.length === 0 ? (
            <SettingNote>{t("desktop.snippetEmpty")}</SettingNote>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {snippets.map((snippet) => (
                <div
                  key={snippet.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                >
                  <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>#</span>
                  <span style={{ fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{snippet.name}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                    {snippet.content.split("\n")[0]}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(snippet)}
                    title={t("desktop.snippetEdit")}
                    style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 2 }}
                  >
                    <PencilSimple size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(snippet.id)}
                    title={t("desktop.snippetDelete")}
                    style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 2 }}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingRow>
      <SettingRowLast>
        <SettingNote>{t("desktop.snippetHint")}</SettingNote>
      </SettingRowLast>
    </SettingCard>
  );
}
