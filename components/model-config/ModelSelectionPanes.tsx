"use client";

/**
 * Side-by-side model picker: what the endpoint offers on the left, what the
 * provider entry will contain on the right.
 *
 * WHY the order on the right is editable rather than "sorted on save": the
 * first model of a models.json provider is the one pi treats as its default, so
 * order is a real setting, not presentation. Drag, arrow buttons and keyboard
 * all feed the same `onModelsChange`, and the parent owns the slot bookkeeping.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useListReorder } from "@/hooks/useListReorder";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "@phosphor-icons/react";
import { containsModelId, mergeDiscoveredModels } from "./model-config-utils";

export interface ModelSelectionPanesProps {
  discovered: { id: string; name?: string }[];
  models: { id: string; name?: string }[];
  onModelsChange: (next: { id: string; name?: string }[]) => void;
  defaultModelId?: string;
  busy?: boolean;
  onRevealAdvanced?: (index: number) => void;
  /** Probe phase, so the left pane can say "loading" instead of "idle". */
  discoveryStatus?: "idle" | "loading" | "ready" | "error";
}

const paneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
  minHeight: 0,
  padding: 10,
  border: "1px solid var(--ds-border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--ds-bg-secondary)",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 120,
  maxHeight: 260,
  overflowY: "auto",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--ds-bg-primary)",
};

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--ds-bg-primary)",
  color: "var(--ds-text-primary)",
  fontSize: "var(--text-ui-xs)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-xs)",
  background: "var(--ds-bg-secondary)",
  color: "var(--ds-text-secondary)",
  cursor: "pointer",
  flexShrink: 0,
};

const paneTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-ui-xs)",
  fontWeight: 600,
  color: "var(--ds-text-secondary)",
};

/** Moves one row to a final index, whichever direction it travels. */
function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const moved = [...list];
  if (from === to || from < 0 || to < 0 || from >= moved.length || to >= moved.length) return moved;
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return moved;
}

export function ModelSelectionPanes({
  discovered,
  models,
  onModelsChange,
  defaultModelId,
  busy = false,
  onRevealAdvanced,
  discoveryStatus = "idle",
}: ModelSelectionPanesProps) {
  const { t } = useI18n();
  const [discoverFilter, setDiscoverFilter] = useState("");
  const [chosenFilter, setChosenFilter] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const reorder = useListReorder({
    length: models.length,
    busy,
    onMove: (from, to) => {
      onModelsChange(moveTo(models, from, to));
    },
  });

  const discoverNeedle = discoverFilter.trim().toLocaleLowerCase();
  const visibleDiscovered = useMemo(() => discovered
    .filter((model) => !discoverNeedle
      || model.id.toLocaleLowerCase().includes(discoverNeedle)
      || model.name?.toLocaleLowerCase().includes(discoverNeedle))
    .slice(0, 300), [discovered, discoverNeedle]);

  // "All shown" counts every visible row, selected or not: a box that reads
  // unchecked while every row under it is ticked is a lie, and the one-click
  // remedy has to be "unselect all" rather than a no-op add.
  const allVisibleSelected = visibleDiscovered.length > 0
    && visibleDiscovered.every((model) => containsModelId(models, model.id));
  const someVisibleSelected = !allVisibleSelected
    && visibleDiscovered.some((model) => containsModelId(models, model.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const chosenNeedle = chosenFilter.trim().toLocaleLowerCase();
  const visibleChosen = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => !chosenNeedle
      || model.id.toLocaleLowerCase().includes(chosenNeedle)
      || model.name?.toLocaleLowerCase().includes(chosenNeedle));

  const addModel = (model: { id: string; name?: string }) => {
    const merged = mergeDiscoveredModels(models, [model]);
    if (merged.added === 0) return;
    onModelsChange(merged.models);
  };

  const removeAt = (index: number) => {
    onModelsChange(models.filter((_, position) => position !== index));
    setExpandedIndex((current) => (current === null ? null : current > index ? current - 1 : current === index ? null : current));
  };

  const toggleSelected = (model: { id: string; name?: string }) => {
    const existing = models.findIndex((entry) => entry.id.trim().toLocaleLowerCase() === model.id.trim().toLocaleLowerCase());
    if (existing === -1) addModel(model);
    else removeAt(existing);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const drop = new Set(visibleDiscovered.map((model) => model.id.trim().toLocaleLowerCase()));
      onModelsChange(models.filter((model) => !drop.has(model.id.trim().toLocaleLowerCase())));
      return;
    }
    const merged = mergeDiscoveredModels(models, visibleDiscovered);
    if (merged.added === 0) return;
    onModelsChange(merged.models);
  };

  const submitCustom = () => {
    const id = customDraft.trim();
    if (!id) return;
    const merged = mergeDiscoveredModels(models, [{ id }]);
    if (merged.added === 0) return;
    onModelsChange(merged.models);
    setCustomDraft("");
  };

  const emptyDiscoveryText = discoveryStatus === "loading" ? t("desktop.modelsProbeLoading") : t("desktop.modelsProbeIdle");

  return (
    <div
      style={{
        display: "grid",
        // Two columns on a wide sheet, stacked on a narrow one — a container
        // query expressed as an auto-fit track, so no breakpoint hook is needed.
        gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
        gap: 10,
        minWidth: 0,
      }}
    >
      <section style={paneStyle} aria-label={t("desktop.modelsDiscoverTitle")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={paneTitleStyle}>{t("desktop.modelsDiscoverTitle")}</span>
          <span style={{ fontSize: "var(--text-ui-xs)", color: "var(--ds-text-muted)" }}>{discovered.length}</span>
        </div>
        <input
          value={discoverFilter}
          onChange={(event) => setDiscoverFilter(event.target.value)}
          placeholder={t("desktop.modelsDiscoveryFilter")}
          aria-label={t("desktop.modelsDiscoveryFilter")}
          style={inputStyle}
        />
        <div style={listStyle}>
          {visibleDiscovered.length === 0 ? (
            <div style={{ padding: 10, color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)", lineHeight: 1.5 }}>
              {emptyDiscoveryText}
            </div>
          ) : (
            <>
              <label style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: "var(--ds-tile-hover)", borderBottom: "1px solid var(--border)", color: "var(--ds-text-secondary)", fontSize: "var(--text-ui-xs)", fontWeight: 600, cursor: "pointer" }}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={visibleDiscovered.length === 0}
                  onChange={toggleAllVisible}
                  style={{ width: 13, height: 13, accentColor: "var(--ds-accent)", flexShrink: 0 }}
                />
                {t("desktop.modelsDiscoverySelectShown")}
              </label>
              {visibleDiscovered.map((model) => {
                const selected = containsModelId(models, model.id);
                return (
                  <label
                    key={model.id}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderBottom: "1px solid var(--border)", cursor: "pointer", minWidth: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(model)}
                      style={{ width: 13, height: 13, accentColor: "var(--ds-accent)", flexShrink: 0 }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ds-text-primary)", fontSize: "var(--text-ui-xs)" }}>
                        {model.name ?? model.id}
                      </span>
                      {model.name && (
                        <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)", fontFamily: "var(--font-mono)" }}>
                          {model.id}
                        </code>
                      )}
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      </section>

      <section style={paneStyle} aria-label={t("desktop.modelsChosenTitle")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={paneTitleStyle}>{t("desktop.modelsChosenTitle")}</span>
          <span style={{ fontSize: "var(--text-ui-xs)", color: "var(--ds-text-muted)" }}>{models.length}</span>
        </div>
        <input
          value={chosenFilter}
          onChange={(event) => setChosenFilter(event.target.value)}
          placeholder={t("desktop.modelsChosenFilter")}
          aria-label={t("desktop.modelsChosenFilter")}
          style={inputStyle}
        />
        <div style={listStyle}>
          {models.length === 0 ? (
            <div style={{ padding: 10, color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)", lineHeight: 1.5 }}>
              {t("desktop.modelsChosenEmpty")}
            </div>
          ) : visibleChosen.length === 0 ? (
            <div style={{ padding: 10, color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)" }}>
              {t("desktop.modelsDiscoveryNoMatches")}
            </div>
          ) : visibleChosen.map(({ model, index }) => {
            const isDefault = Boolean(defaultModelId) && model.id === defaultModelId;
            const handleProps = reorder.itemProps(index);
            const keyProps = reorder.keyboardProps(index);
            return (
              <div
                key={`${model.id}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 7px",
                  borderBottom: "1px solid var(--border)",
                  minWidth: 0,
                  background: reorder.overIndex === index ? "var(--ds-tile-hover)" : "transparent",
                  opacity: reorder.draggingIndex === index ? 0.6 : 1,
                }}
              >
                <span
                  title={t("desktop.modelsMoveUp")}
                  aria-hidden="true"
                  draggable={handleProps.draggable}
                  onDragStart={handleProps.onDragStart}
                  onDragOver={handleProps.onDragOver}
                  onDrop={handleProps.onDrop}
                  onDragEnd={handleProps.onDragEnd}
                  onDragLeave={handleProps.onDragLeave}
                  style={{ cursor: busy ? "default" : "grab", color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)", flexShrink: 0, padding: "0 2px", userSelect: "none" }}
                >
                  ⋮⋮
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ds-text-primary)", fontSize: "var(--text-ui-xs)", fontFamily: "var(--font-mono)" }}>
                    {model.id}
                  </code>
                  {model.name && (
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ds-text-muted)", fontSize: "var(--text-ui-xs)" }}>
                      {model.name}
                    </span>
                  )}
                </span>
                {isDefault && (
                  <span style={{ flexShrink: 0, padding: "1px 5px", borderRadius: "var(--radius-xs)", background: "var(--ds-bg-hover)", color: "var(--ds-text-secondary)", fontSize: "var(--text-ui-xs)" }}>
                    {t("desktop.modelsDefaultBadge")}
                  </span>
                )}
                <button
                  type="button"
                  {...keyProps}
                  aria-label={`${t("desktop.modelsMoveUp")}: ${model.id}`}
                  title={t("desktop.modelsMoveUp")}
                  disabled={busy || index === 0}
                  onClick={() => reorder.moveBy(index, -1)}
                  style={{ ...iconButtonStyle, cursor: busy || index === 0 ? "not-allowed" : "pointer", opacity: index === 0 ? 0.5 : 1 }}
                >
                  <ArrowUpIcon size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`${t("desktop.modelsMoveDown")}: ${model.id}`}
                  title={t("desktop.modelsMoveDown")}
                  disabled={busy || index === models.length - 1}
                  onClick={() => reorder.moveBy(index, 1)}
                  style={{ ...iconButtonStyle, cursor: busy || index === models.length - 1 ? "not-allowed" : "pointer", opacity: index === models.length - 1 ? 0.5 : 1 }}
                >
                  <ArrowDownIcon size={11} />
                </button>
                {onRevealAdvanced && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = expandedIndex === index ? null : index;
                      setExpandedIndex(next);
                      if (next !== null) onRevealAdvanced(index);
                    }}
                    style={{ ...iconButtonStyle, width: "auto", padding: "0 6px", fontSize: "var(--text-ui-xs)" }}
                  >
                    {expandedIndex === index ? t("desktop.modelsHideAdvanced") : t("desktop.modelsRevealAdvanced")}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`${t("desktop.modelsRemove")}: ${model.id}`}
                  title={t("desktop.modelsRemove")}
                  disabled={busy}
                  onClick={() => removeAt(index)}
                  style={{ ...iconButtonStyle, cursor: busy ? "not-allowed" : "pointer" }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitCustom();
            }}
            placeholder={t("desktop.modelsNewModel")}
            aria-label={t("desktop.modelsAddModelManual")}
            style={{ ...inputStyle, flex: 1, width: "auto" }}
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!customDraft.trim() || busy}
            style={{ ...iconButtonStyle, cursor: !customDraft.trim() || busy ? "not-allowed" : "pointer" }}
            aria-label={t("desktop.modelsAddModelManual")}
          >
            <PlusIcon size={11} />
          </button>
        </div>
      </section>
    </div>
  );
}
