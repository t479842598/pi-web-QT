#!/usr/env python3
"""Map the settings pages' inline styles onto the PI-Desktop token layer.

Two classes of change, both purely mechanical and both idempotent:

1. Colour tokens: the legacy `--text-dim` / `--bg-panel` / `--bg-selected` /
   `--bg-hover` pairs become their `--ds-*` equivalents, which carry the same
   meaning in the ported design language (`--ds-text-muted` for dim ink,
   `--ds-bg-secondary` for panels, `--ds-bg-active` for selection,
   `--ds-bg-hover` for hover).
2. Numeric type/radius literals inside the settings surface: `fontSize: 13`
   becomes the `--text-ui-base` step, and the small radii become `--radius-*`.
   Only the settings-owned files are touched; chat surfaces keep their own
   scale.

Run with `--check` to list what would change without writing.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Settings surfaces only. Chat/transcript files are deliberately excluded: their
# type scale is tuned for reading long messages, not for form density.
TARGETS = [
    "components/SkillsConfig.tsx",
    "components/PluginsConfig.tsx",
    "components/DisplayConfig.tsx",
    "components/LogsConfig.tsx",
    "components/UsageConfig.tsx",
    "components/ToolsConfig.tsx",
    "components/SnippetsConfig.tsx",
    "components/FeaturesConfig.tsx",
    "components/AgentsConfig.tsx",
    "components/ProxyConfig.tsx",
    "components/BackupConfig.tsx",
    "components/ImportSessionsConfig.tsx",
    "components/ServerSwitchConfig.tsx",
    "components/McpConfig.tsx",
    "components/VisionMcpConfig.tsx",
    "components/ModelsConfig.tsx",
    # The built-in provider detail and its "fetch new models" tray: part of the
    # model settings page, so it follows the settings surface, not chat's scale.
    "components/BuiltinModelsDetail.tsx",
    "components/ModelConfigImportPanel.tsx",
    "components/ModelSelector.tsx",
    "components/SettingsUi.tsx",
    "components/SettingCard.tsx",
    "components/SettingToggle.tsx",
    "components/ApplyNowButton.tsx",
]

COLOR_PAIRS = [
    ('"var(--text-dim)"', '"var(--ds-text-muted)"'),
    ('"var(--text-muted)"', '"var(--ds-text-secondary)"'),
    ('"var(--text)"', '"var(--ds-text-primary)"'),
    ('"var(--bg-panel)"', '"var(--ds-bg-secondary)"'),
    ('"var(--bg-selected)"', '"var(--ds-bg-active)"'),
    ('"var(--bg-hover)"', '"var(--ds-bg-hover)"'),
    ('"var(--border)"', '"var(--ds-border-default)"'),
    ('"var(--accent)"', '"var(--ds-accent)"'),
]

# PI-Desktop's settings ramp: text-md 13-14, text-sm 12, text-2xs 10-11.
FONT_PAIRS = [
    ("fontSize: 14", "fontSize: 'var(--text-ui-base)'"),
    ("fontSize: 13", "fontSize: 'var(--text-ui-base)'"),
    ("fontSize: 12", "fontSize: 'var(--text-ui-sm)'"),
    ("fontSize: 11", "fontSize: 'var(--text-ui-xs)'"),
    ("fontSize: 10", "fontSize: 'var(--text-ui-xs)'"),
    ("fontSize: 9", "fontSize: 'var(--text-ui-xs)'"),
]

RADIUS_PAIRS = [
    ("borderRadius: 999", "borderRadius: 'var(--radius-full)'"),
    ("borderRadius: 12", "borderRadius: 'var(--radius-lg-plus)'"),
    ("borderRadius: 11", "borderRadius: 'var(--radius-md-plus)'"),
    ("borderRadius: 10", "borderRadius: 'var(--radius-md-plus)'"),
    ("borderRadius: 9", "borderRadius: 'var(--radius-md)'"),
    ("borderRadius: 8", "borderRadius: 'var(--radius-md)'"),
    ("borderRadius: 7", "borderRadius: 'var(--radius-md)'"),
    ("borderRadius: 6", "borderRadius: 'var(--radius-sm)'"),
    ("borderRadius: 5", "borderRadius: 'var(--radius-sm)'"),
    ("borderRadius: 4", "borderRadius: 'var(--radius-xs)'"),
    ("borderRadius: 3", "borderRadius: 'var(--radius-xs)'"),
]


def apply(text, pairs):
    total = 0
    for old, new in pairs:
        # `borderRadius: 999` must not also fire on a later `9999`.
        if old.endswith("999"):
            hits = len(re.findall(re.escape(old) + r"(?!\d)", text))
            text = re.sub(re.escape(old) + r"(?!\d)", new, text)
        else:
            hits = text.count(old)
            text = text.replace(old, new)
        total += hits
    return text, total


def main():
    check = "--check" in sys.argv
    grand = 0
    for rel in TARGETS:
        path = ROOT / rel
        if not path.exists():
            print("missing: %s" % rel)
            continue
        original = path.read_text(encoding="utf-8")
        text = original
        counts = []
        for label, pairs in (
            ("color", COLOR_PAIRS),
            ("font", FONT_PAIRS),
            ("radius", RADIUS_PAIRS),
        ):
            text, n = apply(text, pairs)
            counts.append("%s=%d" % (label, n))
        changed = sum(int(c.split("=")[1]) for c in counts)
        grand += changed
        if changed:
            print("%-42s %s" % (rel, " ".join(counts)))
            if not check:
                path.write_text(text, encoding="utf-8")
    print("total replacements: %d%s" % (grand, " (check only)" if check else ""))


if __name__ == "__main__":
    main()
