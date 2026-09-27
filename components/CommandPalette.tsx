"use client";

import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive, Check, Eye, File as FileIcon, Folder, LayoutList, List, ListFilter,
  MessageSquare, Moon, PanelLeft, Rocket, Search, Settings, SquarePen, Sun,
  Terminal, type LucideIcon,
} from "lucide-react";
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

/** ZCode caps each group at three rows until the user asks for more. */
const SECTION_LIMIT = 3;
const TASK_LIMIT = 80;
const FILE_LIMIT = 80;

export interface CommandPaletteCommand {
  id: string;
  section: "suggested" | "navigation" | "panels" | "configure";
  title: string;
  icon: LucideIcon;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All sessions; the palette filters titles locally and searches bodies via the API. */
  sessions: readonly SessionInfo[];
  /** Project root used to namespace search history and to scope file search. */
  projectKey: string;
  cwd: string | null;
  commands: readonly CommandPaletteCommand[];
  onOpenSession: (session: SessionInfo) => void;
  /** Open a project file in the right panel. */
  onOpenFile: (path: string) => void;
  /** Jump to the session and scroll to the message that matched. */
  onOpenMessage: (session: SessionInfo, entryId: string | undefined) => void;
}

interface SessionHit {
  session: SessionInfo;
  entryId?: string;
  snippet?: string;
}

const SCOPES: Array<{ id: CommandPaletteScope; icon: LucideIcon; labelKey: string }> = [
  { id: "all", icon: List, labelKey: "palette.scope.all" },
  { id: "commands", icon: Rocket, labelKey: "palette.scope.commands" },
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
          ? <mark key={index} className="palette-mark">{segment.text}</mark>
          : <span key={index}>{segment.text}</span>,
      )}
    </>
  );
}

export function CommandPalette({
  open, onOpenChange, sessions, projectKey, cwd, commands,
  onOpenSession, onOpenFile, onOpenMessage,
}: Props) {
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
      className="palette-item"
    >
      <MessageSquare size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />
      <span className="palette-item-body">
        <span className="palette-item-title">
          <Highlighted text={hit.session.name || hit.session.firstMessage || hit.session.id} query={query} />
        </span>
        {hit.snippet && (
          <span className="palette-item-sub">
            <Highlighted text={hit.snippet} query={query} />
          </span>
        )}
      </span>
      <span className="palette-item-meta">{hit.session.cwd ? hit.session.cwd.split(/[\\/]/).filter(Boolean).pop() : ""}</span>
    </Command.Item>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content className="palette-content" aria-describedby={undefined}>
          <Dialog.Title className="palette-sr-title">{t("palette.placeholder")}</Dialog.Title>
          <Command shouldFilter={false} loop label={t("palette.placeholder")}>
            <div className="palette-search">
              <Search size={15} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />
              <Command.Input
                autoFocus
                value={rawQuery}
                onValueChange={setRawQuery}
                placeholder={t("palette.placeholder")}
                className="palette-input"
                aria-label={t("palette.placeholder")}
              />
              <span className="palette-kbd">{commandPaletteShortcutLabel(isMac)}</span>
            </div>

            <div className="palette-scopes" role="tablist" aria-label={t("palette.placeholder")}>
              {SCOPES.map(({ id, icon: Icon, labelKey }) => {
                const active = effectiveScope === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`palette-scope${active ? " is-active" : ""}`}
                    onClick={() => { setScope(id); setRawQuery(stripScopePrefix(rawQuery)); setExpanded(false); }}
                  >
                    <Icon size={12} aria-hidden="true" />
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>

            <Command.List className="palette-list">
              <Command.Empty className="palette-empty">
                <div>{t("palette.empty")}</div>
                <div className="palette-empty-hint">{t("palette.emptyHint")}</div>
              </Command.Empty>

              {/* With no query the pane opens on history, matching ZCode. */}
              {!query && history.length > 0 && (
                <Command.Group heading={t("palette.section.history")} className="palette-group">
                  {history.slice(0, expanded ? HISTORY_LIMIT : SECTION_LIMIT).map((entry) => (
                    <Command.Item
                      key={`${entry.scope}:${entry.query}`}
                      value={`history ${entry.query}`}
                      onSelect={() => { setRawQuery(`${scopePrefix(entry.scope)}${entry.query}`); setScope(entry.scope); setExpanded(false); }}
                      className="palette-item"
                    >
                      <Archive size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />
                      <span className="palette-item-body">
                        <span className="palette-item-title">{entry.query}</span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {showSessions && sessionHits.length > 0 && (
                <Command.Group heading={t("palette.section.sessions")} className="palette-group">
                  {limit(sessionHits).map((hit) => renderSessionRow(hit as SessionHit, "s"))}
                </Command.Group>
              )}

              {showFiles && fileHits.length > 0 && (
                <Command.Group heading={t("palette.section.files")} className="palette-group">
                  {limit(fileHits).map((path) => (
                    <Command.Item
                      key={`f-${path}`}
                      value={`file ${path}`}
                      onSelect={() => pickFile(path)}
                      className="palette-item"
                    >
                      {path.endsWith("/")
                        ? <Folder size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />
                        : <FileIcon size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />}
                      <span className="palette-item-body">
                        <span className="palette-item-title">
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
                  <Command.Group key={section} heading={t(`palette.section.${section}`)} className="palette-group">
                    {limit(items).map((command) => {
                      const Icon = command.icon;
                      return (
                        <Command.Item
                          key={command.id}
                          value={`${command.title} ${(command.keywords ?? []).join(" ")}`}
                          onSelect={() => runCommand(command)}
                          className="palette-item"
                        >
                          <Icon size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />
                          <span className="palette-item-body">
                            <span className="palette-item-title">
                              <Highlighted text={command.title} query={query} />
                            </span>
                          </span>
                          {command.shortcut && <span className="palette-kbd">{command.shortcut}</span>}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                );
              })}

              {searching && <div className="palette-status">{t("palette.searching")}</div>}

              {hasOverflow && (
                <Command.Item
                  value="__show_more__"
                  onSelect={() => setExpanded(true)}
                  className="palette-item palette-item-more"
                >
                  <Eye size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }} />
                  <span className="palette-item-body">
                    <span className="palette-item-title">{t("palette.showMore")}</span>
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

/** Standard command set; the host supplies callbacks so this stays pure data. */
export function buildPaletteCommands(options: {
  onNewSession: () => void;
  onCycleSidebarForm: () => void;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onToggleTasks: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  isDark: boolean;
  t: (key: string) => string;
}): CommandPaletteCommand[] {
  const { t } = options;
  return [
    {
      id: "new-session", section: "suggested", title: t("palette.cmd.newSession"),
      icon: SquarePen, keywords: ["new", "task", "session", "新建"], run: options.onNewSession,
    },
    {
      id: "toggle-sidebar", section: "panels", title: t("palette.cmd.toggleSidebar"),
      icon: PanelLeft, keywords: ["sidebar", "侧边栏"], run: options.onToggleSidebar,
    },
    {
      id: "cycle-sidebar-form", section: "panels", title: t("palette.cmd.sidebarForm"),
      icon: LayoutList, keywords: ["sidebar", "form", "形态", "列表", "面板"], run: options.onCycleSidebarForm,
    },
    {
      id: "toggle-right-panel", section: "panels", title: t("palette.cmd.toggleRightPanel"),
      icon: Terminal, keywords: ["panel", "right", "面板"], run: options.onToggleRightPanel,
    },
    {
      id: "toggle-task-board", section: "panels", title: t("palette.cmd.toggleTasks"),
      icon: ListFilter, keywords: ["tasks", "board", "任务", "看板"], run: options.onToggleTasks,
    },
    {
      id: "toggle-theme", section: "configure", title: t("palette.cmd.toggleTheme"),
      icon: options.isDark ? Sun : Moon, keywords: ["theme", "dark", "light", "主题"], run: options.onToggleTheme,
    },
    {
      id: "open-settings", section: "configure", title: t("palette.cmd.openSettings"),
      icon: Settings, keywords: ["settings", "设置"], run: options.onOpenSettings,
    },
  ];
}

/** Rendered inside the palette's search row; kept here so the styles stay together. */
export function PaletteHint({ children }: { children: ReactNode }) {
  return <span className="palette-kbd">{children}</span>;
}

export { Check, ListFilter };
