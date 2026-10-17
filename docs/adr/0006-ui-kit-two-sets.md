# ADR 0006 — Two UI kits behind one switch (pi / Claude CDS)

- Status: accepted
- Date: 2026-10-17
- Supersedes: the comment in `app/globals.css` that pointed at a non-existent
  "ADR 0009" for the CDS mapping layer.

## Context

The app ships one UI that grew organically: 93 components under
`components/`, ~4.1k lines of `globals.css` plus ~2.1k lines of
`settings.css`, and **2,331 inline `style={{…}}` objects** across 80 files
(549 hard-coded `fontSize`, 176 `rgba()`, 20 `borderRadius`). Colours come
from three overlapping vocabularies — 23 palette tokens supplied by the theme
files, 40 `--ds-*` tokens from the PI-Desktop port, and 40 `--cds-*` tokens
added when the Claude design language was mapped onto the theme.

Two things became necessary at once:

1. Users want the **Claude desktop look** available without losing today's
   look — both complete, both maintained.
2. Every switchable surface has to keep working: dialogs and their contents,
   how the transcript loads, how subagents are displayed.

Rewriting the pi tree in place was rejected: it would either lose today's look
or freeze it mid-refactor, and there is no pixel-level safety net.

## Decision

**Two independent trees behind a three-level switch.**

- `components/` stays exactly where it is. Nothing is moved, renamed or
  rewritten; `kit === "pi"` is therefore the current UI *by construction*.
- `components/claude/` is new and self-contained. Deleting the directory
  returns the app to a single kit with no dangling imports.
- `components/ui-kit/` owns the switch: `types.ts` (slot prop contracts),
  `registry.ts` (slot → implementation per kit), `coverage.ts` invariants,
  `UiKitProvider.tsx` (store + hooks + `KitScope`).
- Resolution order is **slot → scope → global kit → `pi`**. Overrides that
  repeat what they would inherit are not stored, so switching the global kit
  cannot leave a stale override behind.
- The choice lives in localStorage and is mirrored into `html.dataset.*` by
  the inline bootstrap script in `app/layout.tsx`, so the first paint already
  has the right kit. React reads the same dataset through
  `useSyncExternalStore` with a fixed server snapshot, which keeps hydration
  deterministic.
- **The settings page is not switchable.** It is rebuilt in the Claude design
  for both kits and pinned with `<KitScope scope="settings" pinned="claude">`
  (`SETTINGS_PINNED_KIT`).
- Heavyweight slot contracts are *derived* from the pi component
  (`ComponentProps<typeof MessageView>` …) instead of re-declared, so the two
  implementations cannot drift.

## Consequences

- The pi kit is a regression risk only where a call site is re-pointed at a
  slot; the coverage test plus the fingerprint baseline in `e2e/kit-parity.mjs`
  guard that.
- Kit CSS may only override **derived** tokens (geometry, elevation, motion,
  `--ds-*`). Pinning a palette value in the kit layer would break all 23
  shipped themes — enforced by a static test.
- Vendored Claude components must be adapted before they compile in this repo:
  `motion.*` → `m.*` (`MotionProvider` runs `LazyMotion strict`),
  Tailwind v4 class bridge (`@theme inline`), and a `dark` variant bound to
  `html.dark` rather than `prefers-color-scheme`.
- Surfaces that are algorithm rather than skin — the diff renderer, markdown /
  KaTeX / Mermaid rendering, ANSI text — stay shared and are listed in
  `pi-only.allowlist` with their reason.

## Alternatives considered

- **CSS-only theming** (restyle pi in place, no second tree): cannot deliver
  structural differences — segmented track, accordion, chin layout, subagent
  board — and the 2,331 inline styles defeat it.
- **Rewrite pi into a parameterised component** (variant props everywhere):
  one tree, two looks, but every component would carry both designs forever and
  the diff touches all 93 files at once.
- **Feature-flag per component with dynamic import**: better bundle story, but
  the props contracts would still have to exist, and it complicates the
  bootstrap pass. Revisited if bundle size becomes a problem; `registry.ts` is
  the single place to change.


## 已知限制：pi 侧栏内部仍未完全 Claude 化

**现象**：切到 Claude 后，侧栏的**外壳**（rail、footer、search band、表面色、发丝边）是 Claude 的，
但内部的会话树、分组标题、工具条仍是 pi 几何。

**根因**：`SessionSidebar` 用大量**内联 style** 渲染这些节点（审计 F2：80 个 tsx、2331 处内联样式）。
内联声明无法被无 `!important` 的样式表覆盖，而项目门禁禁止新增 `!important`。

**已做**：给搜索区加了两个 class 钩子（`sidebar-search-band` / `sidebar-search-field`），
Claude 层得以接管该区域。

**未做**：会话行、分组标题、工具条仍需逐个加 class 钩子。这是机械工作，
每处都是「加 className + 写 CSS」，不涉及逻辑。

**代价评估**：`SessionSidebar` 3647 行，会话行渲染函数约在 2345–2400 行区间，
需要先把它抽成独立组件才能干净地加钩子。约 3–4 小时。

**决定**：留作后续。当前切换已覆盖 26/27 槽位，观感差异真实存在（见
`work/e2e/shell-pi.png` 与 `shell-claude.png` 对比），但侧栏深度未达 100%。

