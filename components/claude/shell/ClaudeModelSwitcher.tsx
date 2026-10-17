"use client";

/**
 * Claude shell — model switcher.
 *
 * Same prop contract as ModelSelector and the same behaviour: a trigger that
 * records its own bounding rect, a fixed-position listbox rendered outside the
 * trigger so a scrolling composer cannot clip it, filter input above 8 models,
 * provider grouping, Escape to close, outside mousedown to dismiss.
 *
 * The differences are presentational: the trigger is a 28px CDS control with
 * the hairline ring and the secondary fill, the panel carries the popover
 * shadow token, and the selected option is marked with a clay check plus the
 * secondary fill instead of an accent background.
 *
 * The panel is portalled through position: fixed exactly like the pi one, so
 * no portal root or DOM move is needed.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ComponentProps } from "react";

import type { ModelSelector } from "@/components/ModelSelector";
import { filterModelOptions } from "@/components/ModelSelector";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

type ClaudeModelSwitcherProps = ComponentProps<typeof ModelSelector>;

const FILTER_THRESHOLD = 8;
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: ClaudeModelSwitcherProps["options"][number], b: ClaudeModelSwitcherProps["options"][number]): number {
  return COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || COLLATOR.compare(a.provider, b.provider)
    || COLLATOR.compare(a.modelId, b.modelId);
}

function ModelMark({ active }: { active: boolean }) {
  if (!active) return <span className="claude-model-mark" aria-hidden="true" />;
  return (
    <span className="claude-model-mark is-active" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1.5 5 4 7.5 8.5 2.5" />
      </svg>
    </span>
  );
}

export function ClaudeModelSwitcher({
  options,
  value,
  onChange,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  placement = "up",
}: ClaudeModelSwitcherProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const locked = disabled || busy;

  const sortedOptions = useMemo(() => [...options].sort(compare), [options]);
  const filteredOptions = filterModelOptions(sortedOptions, filter);
  const showFilter = sortedOptions.length > FILTER_THRESHOLD;

  const groups: { provider: string; options: ClaudeModelSwitcherProps["options"] }[] = [];
  for (const option of filteredOptions) {
    const group = groups.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else groups.push({ provider: option.provider, options: [option] });
  }

  const currentName = selectedLabel ?? (value
    ? sortedOptions.find((option) => option.modelId === value.modelId && option.provider === value.provider)?.name ?? value.modelId
    : emptyLabel ?? (sortedOptions.length > 0 ? "Select model" : "No models"));

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (
        rootRef.current && !rootRef.current.contains(event.target as Node)
        && panelRef.current && !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    if (!locked) return;
    setOpen(false);
    setFilter("");
  }, [locked]);

  const choose = (provider: string, modelId: string) => {
    const active = modelId === value?.modelId && provider === value?.provider;
    setOpen(false);
    setFilter("");
    if (!active || isAutoSelection) onChange(provider, modelId);
  };

  const triggerTitle = busy
    ? "Switching model"
    : locked
      ? currentName
      : sortedOptions.length > 0 || onClear ? "Change model" : "No available models";

  return (
    <div
      ref={rootRef}
      className={["claude-model-switcher", "is-" + variant, locked ? "is-disabled" : ""].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setFilter("");
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="claude-model-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={locked}
        title={triggerTitle}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchorRect({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
          setOpen((current) => {
            if (current) setFilter("");
            return !current;
          });
        }}
      >
        <span className="claude-model-glyph" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
        </span>
        <span className="claude-model-name">{currentName}</span>
        {variant === "field" && (
          <span className="claude-model-caret" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        )}
      </button>

      {open && anchorRect && (() => {
        const vh = window.visualViewport?.height ?? window.innerHeight;
        const vw = window.visualViewport?.width ?? window.innerWidth;
        const spaceAbove = anchorRect.top - 8;
        const spaceBelow = vh - anchorRect.bottom - 8;
        const openAbove = placement === "up" || spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, vh * 0.6));
        const vertical: CSSProperties = openAbove
          ? { bottom: vh - anchorRect.top + 6 }
          : { top: anchorRect.bottom + 6 };
        const horizontal: CSSProperties = isMobile
          ? { left: 8, right: 8 }
          : { left: anchorRect.left, minWidth: anchorRect.width, width: "max-content", maxWidth: Math.max(anchorRect.width, vw - anchorRect.left - 8) };

        return (
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className="claude-model-panel"
            style={{ ...vertical, ...horizontal, maxHeight }}
          >
            {showFilter && (
              <div className="claude-model-filter">
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
            <div className="claude-model-list">
              {onClear && !filter.trim() && (
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className="claude-model-option"
                  onClick={() => { setOpen(false); setFilter(""); onClear(); }}
                >
                  <ModelMark active={!value} />
                  <span>{emptyLabel ?? "Default"}</span>
                </button>
              )}
              {groups.length === 0 ? (
                <div className="claude-model-empty">
                  {filter.trim() ? t("chat.noMatchingModels") : "No available models"}
                </div>
              ) : groups.map((group) => (
                <div key={group.provider} className="claude-model-group">
                  {groups.length > 1 && <div className="claude-model-provider">{group.provider}</div>}
                  {group.options.map((option) => {
                    const active = option.modelId === value?.modelId && option.provider === value?.provider;
                    return (
                      <button
                        key={option.provider + ":" + option.modelId}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className="claude-model-option"
                        onClick={() => choose(option.provider, option.modelId)}
                      >
                        <ModelMark active={active} />
                        <span title={option.name}>{option.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
