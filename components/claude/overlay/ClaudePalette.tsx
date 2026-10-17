"use client";

/**
 * Claude Design System — command palette (slot `palette`).
 *
 * The pi palette is the interaction contract and it is kept whole: cmdk drives
 * selection with `shouldFilter={false}` and `loop`, Radix owns focus trapping
 * and `aria-describedby`, every effect (history reload per open, expansion reset
 * on query change, one file-index fetch per project, the abortable session
 * search with title hits first) is the same, and so are the three guards that
 * keep it correct — `closingRef` against a double-select, the `setTimeout(…, 0)`
 * around every close so Radix actually lands on `false`, and aborting the
 * in-flight search on each keystroke.
 *
 * Reused, not rewritten: `buildPaletteCommands` and `PaletteHint` are imported
 * from the pi module, and so are the history and match helpers. This file only
 * replaces the presentation — a CDS dialog card with a pill search band, a
 * segmented scope rail, and rows whose highlight is a clay wash rather than the
 * theme accent block.
 */

import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Eye, File as FileIcon, Folder, MessageSquare, Search, Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { SlotPropsMap } from "@/components/ui-kit/types";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";
import {
  HISTORY_LIMIT,
  loadHistory, saveHistory, upsertHistory,
  type CommandPaletteHistoryEntry, type CommandPaletteScope,
} from "@/lib/command-palette-history";
import {
  commandPaletteShortcutLabel, highlightMatches, resolveQueryScope, scopePrefix, stripScopePrefix,
} from "@/lib/command-palette-match";
import {
  buildPaletteCommands,
  PaletteHint,
  type CommandPaletteCommand,
} from "@/components/CommandPalette";

type ClaudePaletteProps = SlotPropsMap["palette"];

/**
 * Reused, not re-implemented: the command set and the keyboard-hint pill stay
 * the pi module's exports. They are imported here and re-exported so a host
 * binding the Claude palette can take its whole surface — component plus
 * command builder — from one module, and a second copy of the command list can
 * never appear.
 */
export { buildPaletteCommands, PaletteHint };
export type { CommandPaletteCommand };

/** ZCode caps each group at three rows until the user asks for more. */
const SECTION_LIMIT = 3;
const TASK_LIMIT = 80;
const FILE_LIMIT = 80;

interface SessionHit {
  session: SessionInfo;
  entryId?: string;
  snippet?: string;
}

const SCOPES: Array<{ id: CommandPaletteScope; icon: LucideIcon; labelKey: string }> = [
  { id: "all", icon: Search, labelKey: "palette.scope.all" },
  { id: "commands", icon: Sparkles, labelKey: "palette.scope.commands" },
  { id: "sessions", icon: MessageSquare, labelKey: "palette.scope.sessions" },
  { id: "files", icon: FileIcon, labelKey: "palette.scope.files" },
];

const COMMAND_SECTION_ORDER: Array<CommandPaletteCommand["section"]> = [
  "suggested", "navigation", "panels", "configure",
];

/** Render `text` with every query term highlighted. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlightMatches(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit
          ? <mark key={index} className="cds-mark">{segment.text}</mark>
          : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}

export function ClaudePalette({
  open, onOpenChange, sessions, projectKey, cwd, commands,
  onOpenSession, onOpenFile, onOpenMessage,
}: ClaudePaletteProps) {
  const { t } = useI18n();
  const [rawQuery, setRawQuery] = useState("");
  const [scope, setScope] = useState<CommandPaletteScope>("all");
  const [history, setHistory] = useState<CommandPaletteHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [sessionHits, setSessionHits] = useState<SessionHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  // Guards against a double-click running one item twice: the first select
  // flips this, and the palette is reopened (which resets it) below.
  const closingRef = useRef(false);

  const { scope: effectiveScope, query } = resolveQueryScope(rawQuery, scope);

  // Reset per open: a fresh palette must not inherit the previous run's guard
  // or an expanded result list.
  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    setHistory(loadHistory(projectKey));
    setRawQuery("");
    setExpanded(false);
  }, [open, projectKey]);

  // Narrowing or changing the query invalidates "show more": the old expansion
  // was about a different result set.
  useEffect(() => { setExpanded(false); }, [query]);

  // The file index is fetched once per project and filtered locally: the route
  // accepts ?q= but a single listing serves every keystroke without a request.
  useEffect(() => {
    if (!open || !cwd) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null) as { files?: string[] } | null;
        if (!cancelled && Array.isArray(data?.files)) setFiles(data.files);
      } catch {
        // Offline / denied: the files scope simply stays empty.
      }
    })();
    return () => { cancelled = true; };
  }, [open, cwd]);

  // Session matching: titles are filtered in memory; bodies go through
  // /api/sessions/search. Requests are aborted on every keystroke so a slow
  // earlier response can never overwrite a newer one.
  useEffect(() => {
    if (!open) return;
    if (effectiveScope !== "sessions" && effectiveScope !== "all") {
      setSessionHits([]);
      setSearching(false);
      return;
    }
    const term = query.trim();
    const titleHits: SessionHit[] = term
      ? sessions
        .filter((session) => !session.transient)
        .filter((session) => {
          const haystack = `${session.name ?? ""} ${session.firstMessage ?? ""}`.toLowerCase();
          return term.toLowerCase().split(/\s+/).every((part) => haystack.includes(part));
        })
        .slice(0, TASK_LIMIT)
        .map((session) => ({ session }))
      : sessions.filter((session) => !session.transient).slice(0, SECTION_LIMIT).map((session) => ({ session }));

    if (!term) {
      setSessionHits(titleHits);
      setSearching(false);
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSearching(true);
    void (async () => {
      let bodyHits: SessionHit[] = [];
      try {
        const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json().catch(() => null) as {
            results?: Array<{ session: SessionInfo; entryId?: string; before?: string; match?: string; after?: string }>;
          } | null;
          bodyHits = (data?.results ?? []).slice(0, TASK_LIMIT).map((hit) => ({
            session: hit.session,
            entryId: hit.entryId,
            snippet: `${hit.before ?? ""}${hit.match ?? ""}${hit.after ?? ""}`.trim(),
          }));
        }
      } catch {
        // Aborted or offline — keep whatever titles matched.
      }
      if (controller.signal.aborted) return;
      // Titles first (cheap, exact), then body matches the title pass missed.
      const seen = new Set(titleHits.map((hit) => hit.session.id));
      setSessionHits([...titleHits, ...bodyHits.filter((hit) => !seen.has(hit.session.id))]);
      setSearching(false);
    })();
    return () => { controller.abort(); };
  }, [open, effectiveScope, query, sessions]);

  const fileHits = useMemo(() => {
    if (effectiveScope !== "files" && effectiveScope !== "all") return [];
    const term = query.trim().toLowerCase();
    const source = term
      ? files.filter((path) => term.split(/\s+/).every((part) => path.toLowerCase().includes(part)))
      : files.slice(0, SECTION_LIMIT);
    return source.slice(0, FILE_LIMIT);
  }, [files, query, effectiveScope]);

  const commandMatches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = term
      ? commands.filter((command) => {
        const haystack = `${command.title} ${(command.keywords ?? []).join(" ")}`.toLowerCase();
        return term.split(/\s+/).every((part) => haystack.includes(part));
      })
      : commands;
    const grouped = new Map<CommandPaletteCommand["section"], CommandPaletteCommand[]>();
    for (const section of COMMAND_SECTION_ORDER) grouped.set(section, []);
    for (const command of matched) grouped.get(command.section)?.push(command);
    return grouped;
  }, [commands, query]);

  const rememberAndClose = useCallback((entryQuery: string, entryScope: CommandPaletteScope) => {
    // Store the term without its scope prefix: the prefix is re-derived from
    // `scope` on restore, so keeping it here would double it up (`>>theme`).
    const next = upsertHistory(history, stripScopePrefix(entryQuery), entryScope, Date.now());
    setHistory(next);
    saveHistory(projectKey, next);
    // Radix keeps the dialog open when a child's onSelect runs inside its own
    // event; closing on the next tick lets that handler finish first, so the
    // open state actually lands on `false`.
    setTimeout(() => onOpenChange(false), 0);
  }, [history, projectKey, onOpenChange]);

  const runCommand = useCallback((command: CommandPaletteCommand) => {
    if (closingRef.current) return;
    closingRef.current = true;
    rememberAndClose(rawQuery, effectiveScope);
    // Run after the dialog closes so focus never fights the command's target.
    setTimeout(() => command.run(), 0);
  }, [rawQuery, effectiveScope, rememberAndClose]);

  const pickSession = useCallback((hit: SessionHit) => {
    rememberAndClose(rawQuery, effectiveScope);
    setTimeout(() => {
      if (hit.entryId) onOpenMessage(hit.session, hit.entryId);
      else onOpenSession(hit.session);
    }, 0);
  }, [rawQuery, effectiveScope, rememberAndClose, onOpenMessage, onOpenSession]);

  const pickFile = useCallback((path: string) => {
    rememberAndClose(rawQuery, effectiveScope);
    setTimeout(() => onOpenFile(path), 0);
  }, [rawQuery, effectiveScope, rememberAndClose, onOpenFile]);

  const showCommands = effectiveScope === "all" || effectiveScope === "commands";
  const showSessions = effectiveScope === "all" || effectiveScope === "sessions";
  const showFiles = effectiveScope === "all" || effectiveScope === "files";
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  // Each section contributes at most SECTION_LIMIT rows until "show more" is
  // pressed, matching ZCode's collapsed-by-default groups.
  const limit = <T,>(items: readonly T[]): readonly T[] => (expanded ? items : items.slice(0, SECTION_LIMIT));
  const hasOverflow = !expanded && (
    (showSessions && sessionHits.length > SECTION_LIMIT)
    || (showFiles && fileHits.length > SECTION_LIMIT)
    || (showCommands && COMMAND_SECTION_ORDER.some((section) => (commandMatches.get(section)?.length ?? 0) > SECTION_LIMIT))
  );

  const renderSessionRow = (hit: SessionHit, keyPrefix: string) => (
    <Command.Item
      key={`${keyPrefix}-${hit.session.id}-${hit.entryId ?? "session"}`}
      value={`${hit.session.name ?? hit.session.firstMessage ?? hit.session.id} ${hit.snippet ?? ""}`}
      onSelect={() => pickSession(hit)}
      className="cds-palette-item"
    >
      <MessageSquare size={14} aria-hidden="true" className="cds-palette-item-icon" />
      <span className="cds-palette-item-body">
        <span className="cds-palette-item-title">
          <Highlighted text={hit.session.name || hit.session.firstMessage || hit.session.id} query={query} />
        </span>
        {hit.snippet && (
          <span className="cds-palette-item-sub">
            <Highlighted text={hit.snippet} query={query} />
          </span>
        )}
      </span>
      <span className="cds-palette-item-meta">{hit.session.cwd ? hit.session.cwd.split(/[\\/]/).filter(Boolean).pop() : ""}</span>
    </Command.Item>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cds-palette-overlay" />
        <Dialog.Content className="cds-card cds-palette" aria-describedby={undefined}>
          <Dialog.Title className="cds-visually-hidden">{t("palette.placeholder")}</Dialog.Title>
          <Command shouldFilter={false} loop label={t("palette.placeholder")}>
            <div className="cds-palette-search">
              <Search size={15} aria-hidden="true" className="cds-palette-search-icon" />
              <Command.Input
                autoFocus
                value={rawQuery}
                onValueChange={setRawQuery}
                placeholder={t("palette.placeholder")}
                className="cds-palette-input"
                aria-label={t("palette.placeholder")}
              />
              <span className="cds-palette-kbd">{commandPaletteShortcutLabel(isMac)}</span>
            </div>

            <div className="cds-palette-scopes" role="tablist" aria-label={t("palette.placeholder")}>
              {SCOPES.map(({ id, icon: Icon, labelKey }) => {
                const active = effectiveScope === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className="cds-palette-scope"
                    data-active={active ? "true" : undefined}
                    onClick={() => { setScope(id); setRawQuery(stripScopePrefix(rawQuery)); setExpanded(false); }}
                  >
                    <Icon size={12} aria-hidden="true" />
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>

            <Command.List className="cds-palette-list">
              <Command.Empty className="cds-palette-empty">
                <div>{t("palette.empty")}</div>
                <div className="cds-palette-empty-hint">{t("palette.emptyHint")}</div>
              </Command.Empty>

              {/* With no query the pane opens on history, matching ZCode. */}
              {!query && history.length > 0 && (
                <Command.Group heading={t("palette.section.history")} className="cds-palette-group">
                  {history.slice(0, expanded ? HISTORY_LIMIT : SECTION_LIMIT).map((entry) => (
                    <Command.Item
                      key={`${entry.scope}:${entry.query}`}
                      value={`history ${entry.query}`}
                      onSelect={() => { setRawQuery(`${scopePrefix(entry.scope)}${entry.query}`); setScope(entry.scope); setExpanded(false); }}
                      className="cds-palette-item"
                    >
                      <Archive size={14} aria-hidden="true" className="cds-palette-item-icon" />
                      <span className="cds-palette-item-body">
                        <span className="cds-palette-item-title">{entry.query}</span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {showSessions && sessionHits.length > 0 && (
                <Command.Group heading={t("palette.section.sessions")} className="cds-palette-group">
                  {limit(sessionHits).map((hit) => renderSessionRow(hit, "s"))}
                </Command.Group>
              )}

              {showFiles && fileHits.length > 0 && (
                <Command.Group heading={t("palette.section.files")} className="cds-palette-group">
                  {limit(fileHits).map((path) => (
                    <Command.Item
                      key={`f-${path}`}
                      value={`file ${path}`}
                      onSelect={() => pickFile(path)}
                      className="cds-palette-item"
                    >
                      {path.endsWith("/")
                        ? <Folder size={14} aria-hidden="true" className="cds-palette-item-icon" />
                        : <FileIcon size={14} aria-hidden="true" className="cds-palette-item-icon" />}
                      <span className="cds-palette-item-body">
                        <span className="cds-palette-item-title">
                          <Highlighted text={path} query={query} />
                        </span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {showCommands && COMMAND_SECTION_ORDER.map((section) => {
                const items = commandMatches.get(section) ?? [];
                if (items.length === 0) return null;
                return (
                  <Command.Group key={section} heading={t(`palette.section.${section}`)} className="cds-palette-group">
                    {limit(items).map((command) => {
                      const Icon = command.icon;
                      return (
                        <Command.Item
                          key={command.id}
                          value={`${command.title} ${(command.keywords ?? []).join(" ")}`}
                          onSelect={() => runCommand(command)}
                          className="cds-palette-item"
                        >
                          <Icon size={14} aria-hidden="true" className="cds-palette-item-icon" />
                          <span className="cds-palette-item-body">
                            <span className="cds-palette-item-title">
                              <Highlighted text={command.title} query={query} />
                            </span>
                          </span>
                          {command.shortcut && <span className="cds-palette-kbd">{command.shortcut}</span>}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                );
              })}

              {searching && <div className="cds-palette-status">{t("palette.searching")}</div>}

              {hasOverflow && (
                <Command.Item
                  value="__show_more__"
                  onSelect={() => setExpanded(true)}
                  className="cds-palette-item cds-palette-item-more"
                >
                  <Eye size={14} aria-hidden="true" className="cds-palette-item-icon" />
                  <span className="cds-palette-item-body">
                    <span className="cds-palette-item-title">{t("palette.showMore")}</span>
                  </span>
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
