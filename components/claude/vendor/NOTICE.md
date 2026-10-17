# Vendored / adapted upstream — open-claude-ui

Source: https://github.com/Caho1/open-claude-ui (MIT License, Copyright (c) 2026 Caho1)
Local probe clone: `/tmp/ocu-probe/open-claude-ui`
Commit read: `ddf3aea1711db62fd6d24343bbab500a5ae69f64` (2026-10-16, "Merge pull request #15 from Caho1/feat/rea-ground-truth-audit")
Reference tree: `code-examples/` (`CdsButton.tsx`, `SegmentedControl.tsx`,
`StatusIndicators.tsx`, `ScrollFadeContainer.tsx`, `cds-theme.css`,
`tailwind.config.js`).

## What this directory contains

Only this NOTICE. **No upstream file was copied verbatim**, deliberately:

* every upstream example is a `"use client"` component that imports
  `framer-motion`, and this repo mounts `LazyMotion strict`, where `motion.*`
  throws;
* every upstream example spells colour as `rgba(...)`, `#0000000d` mask stops
  or the Tailwind `neutral-*` palette, while the Claude tree here may only use
  `var(--cds-*)` / `var(--status-*)` / `var(--accent)` and the registered
  semantic utilities (`bg-clay`, `bg-surface-2`, `shadow-field`, `rounded-cds`);
* `cds-theme.css` is 789 lines of palette definitions, and the token layer for
  this repo already lives in `app/globals.css` + `app/ui-kit-claude.css`
  (read-only for the Claude tree). Vendoring it would fork the palette.

So the four primitives were re-implemented against the upstream *spec* and the
diff is recorded per file below. This file is the required attribution.

## Per-file provenance and changes

| Here | Upstream | Kept | Changed |
| --- | --- | --- | --- |
| `../primitives/CdsButton.tsx` | `CdsButton.tsx` | size ladder 20/24/28/32/40, radius 6/8/10/12, the 1-border rule (secondary = surface fill, no border), outer shell + inner `data-cds-part="paint"` layer, loading spinner | `framer-motion` removed (not imported at all); the 15-step `linear()` press spring replaced by `active:scale-[0.98]`; `neutral-*`/`text-white`/`bg-red-600` replaced by `--cds-fill-*`, `--accent-fg`, `--status-error`, `bg-clay`; `brand`/`onContent` variants dropped (no call site, and they carried raw literals) |
| `../primitives/SegmentedControl.tsx` | `SegmentedControl.tsx` | 1px track padding, the geometry formula `left = 1px + i*(100% - 2px)/n`, 120ms snap easing, indicator inset hairline + two-layer shadow | framer-motion `layoutId` thumb replaced by the upstream's own CSS branch; `role="tablist"/"tab"` replaced by this repo's contract (`role="group"` + `aria-pressed`, named by `ariaLabel`); container-query label collapsing not carried over; `bg-white`/`dark:bg-[#2c2c2a]` replaced by `var(--cds-surface-1)` |
| `../primitives/StatusIndicators.tsx` | `StatusIndicators.tsx` | 6px dot, tone ladder, 2.4s breathe / 1.2s pulse speeds, 105° skeleton sheen gradient | the three `@keyframes` that file relied on (`dframe-dot-blink`, `dframe-clay-breathe`, `cds-skeleton-sweep`) are not in this repo's CSS and a component may not add a stylesheet, so the breathe rides `drop-ring-pulse` (2.4s) and the blink rides `pulse` (1.2s), both already global; the skeleton sheen breathes with `pulse` instead of translating `background-position`, because that needs a new keyframe. Documented degradation, not an oversight. `--cds-fill-danger` -> `--status-error` |
| `../primitives/ScrollFadeContainer.tsx` | `ScrollFadeContainer.tsx` | `--cds-scroll-fade-top/bottom` variable contract, 28px default, one-sided edges | the 8-stop `#0000000d` ramp rebuilt from `black` + two `color-mix` midpoints (no literal hex); `ResizeObserver`/`onScroll` sensor dropped — the slot is a pure container and the owning shell sets the two variables (same split as the pi adapter) |
| `../primitives/CdsToggle.tsx` | (none) | — | hand-written to the CDS spec: 34x20 track, 16px knob, `bg-clay` when on, inset hairline as shadow, transform travel |
| `../primitives/CdsField.tsx` | (none) | — | hand-written to the CDS spec: 32px (`--cds-control-height-lg`) / 28px (`sm`), `var(--cds-radius)`, `inset 0 0 0 1px var(--cds-hairline-1)`, error ring from `--status-error` |

## Token mapping used by every file

`--cds-radius`, `--cds-shadow-sm/md/lg` (via `shadow-field` and
`--cds-shadow-tint`), `--cds-hairline-1/2`, `--cds-fill-secondary`,
`--cds-fill-secondary-hover`, `--cds-fill-ghost-hover`, `--cds-surface-1`,
`--cds-dur-fast/snap`, `--cds-ease-swift/snap/pulse`, `--cds-clay`,
`--cds-control-height-lg`, `--cds-scroll-fade-size` — all defined by
`app/ui-kit-claude.css` / `app/globals.css`. No hex, no `rgba(`, no inline
numeric `fontSize`.

Tailwind v4 note: `dark:` in this repo is bound to `html.dark` through
`@custom-variant dark`, not to `prefers-color-scheme`, so the adapted files use
token colours and need no `dark:` pairs at all.

## License

MIT. The upstream copyright notice above applies to the designs and structures
derived from `open-claude-ui`; the re-implementation in `../primitives/` is
part of this repository.
