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
  `registry.ts` (slot → implementation per kit), `UiKitProvider.tsx` (store +
  hooks). The coverage invariants live in the tests beside them —
  `registry.test.mjs`, `wiring.test.mjs`, `primitives.test.mjs` and
  `session-row-fidelity.test.mjs`; there is no `coverage.ts`.
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


## 已知限制：侧栏会话行——已接线，深节点仍非 100%

**原现象**：切到 Claude 后，侧栏的**外壳**（rail、footer、search band、表面色、发丝边）是 Claude 的，
但内部的会话行仍是 pi 几何。

**原根因**：`SessionSidebar` 用**内联 style** 渲染会话行，内联声明无法被无 `!important` 的样式表
覆盖，而项目门禁禁止新增 `!important`。当时 `sessionRow` 槽位有两份实现却没有任何挂载点
（`wiring.test.mjs` 用 `NOT_YET_WIRED` 自认未接线），`registry.ts` 的注释也仍停在「还需要 pi 适配器」。

**已做（Q2）**：行的**盒（box）**成为 `sessionRow` 槽位的渲染单元，行内容仍留在 sidebar。

- `components/ui-kit/pi/SessionRow.tsx` 逐条复刻原内联声明，`variant` 区分两个视图：`tree`
  （列表/fork 树：固定 50px 高、radius 回退 0）与 `group`（分组手风琴：两行 column、radius 回退 6px）。
  两者的 pi 几何本来就不同，所以 `variant` 是契约的一部分，而不是让调用方去记默认值。
- `components/session-row-render-proxy.tsx` 挂载槽位；pi 分支直接返回 `PiSessionRow`，**不产生任何
  wrapper 节点**；只有非 pi 实现才包一层 `display: contents` 的 `.claude-surface-root`——per-slot
  override 下 `html[data-ui-kit]` 仍是 pi，没有这层标记 Claude 样式根本选不中。
- `ClaudeSessionRow` 改为同一契约的 row shell：保留 `session-row` + 状态修饰类 + `data-fork-depth`
  （kit 无关钩子），另加 `.claude-session-row` / `data-active`。

**证据（pi 像素不变）**：

1. 真实浏览器 A/B（`work/row-geometry-probe.mjs`，HEAD 工作树 vs 工作树，两个视图 × 前 4 行）：
   class、`style` 属性原文、声明顺序、`data-*`、子节点标签、文本、boundingRect 以及 23 项
   computed style —— 0 差异。
2. `e2e/kit-parity.mjs --check`（sidebar-expanded / sidebar-collapsed × 3 viewport）：改动前捕获的
   指纹与改动后捕获的指纹逐字节相同。
3. 静态契约 `components/ui-kit/session-row-fidelity.test.mjs`：按顺序钉住两套声明，并钉住 50px
   常量与 `confirmDelete || isSelected` 的原始配色条件（`armed` 与 `inert` 因此是两个 prop，不能合并）。

**证据（claude 确实换了几何）**：同一探针在 `kit=claude` 下，列表行 `border-radius` 0px → 8px、
`border-left-width` 2px → 0px（改为 inset 阴影黏土轨）、`min-height` 50px → 30px、实测行高
50 → 46.5、`gap` 6px → 8px；分组行 47px → 30px、radius 6px → 8px。类名多出 `claude-session-row`，
pi 侧永不输出该标记（`wiring.test.mjs` 钉住这一点）。

**仍未做**：分组标题、工具条与文件树表头仍是内联样式，靠 class 钩子 + CSS 覆盖；它们不是行盒，
接线不会带来新的用户可见差异。

**同时删掉的死规则**：`app/settings-claude.css` 里 `.claude-session-dot`、`-dot.is-running`、
`-dot.is-unread`、`@keyframes claude-session-dot-pulse`、`.claude-session-body`、`.claude-row-title`、
`.claude-session-subtitle`、`.claude-session-meta`、`.claude-session-actions` 及其 hover/focus 规则，
**从来就不可达**：它们由旧版 `ClaudeSessionRow` 发射，而该组件在 Q2 之前零挂载点，接线后行壳只渲染
盒 + `children`（children 来自 `SessionSidebar`，是纯内联样式，不发射这些类名）。全仓 grep 这些类名
只在上述 CSS 中有出现。留着会让人以为「Claude 行内样式在这里调」。真要做 Claude 专属行内样式，
正确做法是让 sidebar 的 children 发射类名——那是新特性，不是修复。

**同时摘除**：`scrollFade` 从槽位表移除（27 → 26）。两套实现都零消费者，真实渐隐是
`ChatWindow.tsx` 手写的 `.chat-scroll-fade` + 内联 `--chat-fade-top/bottom`；切套件无人可察觉，
属内部实现细节，不该占一个用户可见槽位。

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

