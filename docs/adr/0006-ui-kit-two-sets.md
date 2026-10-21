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
  `UiKitProvider.tsx` (store + hooks).
- Resolution order is **slot → scope → global kit → `pi`**. Overrides that
  repeat what they would inherit are not stored, so switching the global kit
  cannot leave a stale override behind.

  Absorbing an override is therefore a *consequence* of switching, and which
  overrides get absorbed is decided by history that the stored state no longer
  records: `{scopes:{},slots:{button:"claude"}}` is byte-identical whether the
  user pinned that slot or it survived an absorbed scope. No rule over stored
  state can tell the two apart, so the model does not try to. It only counts
  them (`kitSwitchImpact`) and the title-bar switch shows the counts before and
  after the click — visibility without a semantics change. The invariant is
  locked by `lib/ui-kit.test.mjs` (#16-19) plus the exhaustive equivalence
  between `kitSwitchImpact` and what `withKit` actually drops.
- The choice lives in localStorage and is mirrored into `html.dataset.*` by
  the inline bootstrap script in `app/layout.tsx`, so the first paint already
  has the right kit. React reads the same dataset through
  `useSyncExternalStore` with a fixed server snapshot, which keeps hydration
  deterministic.
- **The settings page is not switchable.** It is rebuilt in the Claude design
  for both kits, and the pin lives in **CSS, not React**: 422 rules in
  `app/settings-claude.css` carry no kit prefix (only 178 are gated on
  `html[data-ui-kit="claude"]` / `.claude-surface-root`), and the `--cds-*`
  tokens those rules read are declared at `:root` in `app/globals.css`, so
  `kit === "pi"` still gets the Claude settings ladder. `SETTINGS_PINNED_KIT`
  is the single declaration of that intent and drives the note in the 界面体系
  panel; `components/ui-kit/settings-page-pinned.test.mjs` locks the contract
  and fails if the core `.settings-row` / `.settings-panel` /
  `.settings-segmented` rules are ever gated behind a kit selector.

  The earlier version of this ADR claimed a `<KitScope pinned="claude">` did the
  pinning. That component had no render site anywhere in the repo, so its
  `pinned` context was always `null` and every `pinned ?? …` branch in
  `UiKitProvider` was dead code; the behaviour users saw was CSS all along. The
  component, the context, the branches, `withPinnedKit` and the two unread
  `*_PINNED` exports were deleted rather than wired up, because wiring them would
  have changed nothing on screen and added a second, weaker mechanism to
  maintain.

  The command palette is *not* part of this: `palette` is a real slot
  (`registry.ts`), so under `kit === "pi"` the pi palette renders and no
  `.cds-palette-*` node exists. That is correct behaviour, not a leak.
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



## 既有 e2e 失效（非双套件引入）

`e2e/run.mjs` 的富消息块里有 6 个选择器指向**重构前就已消失的 UI**：

- `getByRole("button", { name: /^Process details/ })` — 树中不存在该字符串；
  `ProcessGroup` 的摘要按钮只有文本内容，无 `aria-label`。
- `getByRole("button", { name: /^Thinking/ })` — 同上；`ThinkingBlock` 在
  `MessageView.tsx` 内，是带 `aria-expanded` 的按钮，没有 `Thinking` 名称。
- 早期分页断言依赖 "Scroll up to load earlier messages" 哨兵，而虚拟列表
  已取代该机制。

**证据**：`git show 3535982e:components/ThinkingBlock.tsx` 不存在；
`grep -r "Process details" components` 无结果。这些断言在双套件之前就失效。

**影响**：`npm run test:e2e` 跑到富消息块会失败，与 kit 切换无关。

**决定**：本轮只把 kit 切换检查（`e2e/kit-switch.mjs`，16 行接线）并入
`run.mjs`；上述过时断言原样保留，作为独立问题另行处理，避免把两件事混在
一次提交里。

