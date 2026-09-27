/**
 * Tool-selection resource policy (pure logic, no I/O).
 *
 * A session's tool selection has three distinct states, and only one of them
 * means "Chat only" (no tools at all):
 *
 *   1. a subagent profile's fixed list - possibly empty.
 *   2. an explicit selection            - `["read", ...]`, or `[]` for the
 *      "none" preset (every tool off).
 *   3. no selection at all              - the user never overrode the loadout
 *      ("configured": let pi resolve settings.json defaultTools).
 *
 * State 3 must NOT collapse into state 2. A `?? []` fallback does exactly that,
 * which turns every unpinned session into a Chat-only session; the Chat-only
 * resource loader sets `noExtensions/noSkills/noPromptTemplates/noThemes`, so
 * extensions are never loaded, never receive `session_start`, and never
 * register statuses/commands/tools. Installed plugins then silently vanish
 * from new conversations (#782). These helpers are the single place that
 * decides which of the three states a start request is in.
 */

export interface ToolSelectionInput {
  /** Tools fixed by a subagent profile snapshot; `undefined` for normal sessions. */
  subagentTools: readonly string[] | undefined;
  /** Tools persisted in the session log (`pi-web:tool-selection`); `undefined` = none. */
  persistedTools: readonly string[] | undefined;
  /** Tools requested by this start call; `undefined` = the client sent no override. */
  requestedTools: readonly string[] | undefined;
}

/**
 * The tool list a session should start with, or `undefined` for "no override".
 * Precedence: a subagent profile is authoritative, then the session's own
 * persisted pin, then whatever this particular start call asked for.
 */
export function resolveStartupToolSelection(input: ToolSelectionInput): string[] | undefined {
  const selection = input.subagentTools ?? input.persistedTools ?? input.requestedTools;
  return selection === undefined ? undefined : [...selection];
}

/**
 * "Chat only" means an explicit empty selection and nothing else: every tool
 * turned off, on a session that does not load resources of its own. An absent
 * selection is not chat-only - that is the whole point of this function.
 */
export function isChatOnlySession(input: {
  toolSelection: readonly string[] | undefined;
  subagentLoadsResources: boolean;
}): boolean {
  return input.toolSelection !== undefined
    && input.toolSelection.length === 0
    && !input.subagentLoadsResources;
}

/**
 * Whether switching a live session to `nextTools` crosses the Chat-only
 * boundary. Only an explicit empty selection is chat-only, so un-pinning a
 * session (back to the configured defaults) never crosses it by itself.
 */
export function crossesChatOnlyBoundary(input: {
  currentChatOnly: boolean;
  nextTools: readonly string[] | undefined;
}): boolean {
  const nextChatOnly = input.nextTools !== undefined && input.nextTools.length === 0;
  return input.currentChatOnly !== nextChatOnly;
}
