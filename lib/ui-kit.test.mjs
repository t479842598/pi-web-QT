import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const uiKit = await createJiti(import.meta.url).import("./ui-kit.ts");

const {
  DEFAULT_UI_KIT_SETTINGS,
  SETTINGS_PINNED_KIT,
  SLOT_IDS,
  SLOT_SCOPES,
  SCOPE_IDS,
  SLOTS_BY_SCOPE,
  DEFAULT_KIT,
  parsePairList,
  serializePairList,
  parseUiKitSettings,
  normalizeUiKitSettings,
  resolveScopeKit,
  resolveSlotKit,
  serializeUiKitSettings,
  datasetFromSettings,
  settingsFromDataset,
  withKit,
  withScope,
  withSlot,
  withLayout,
  withSidebarToggle,
  withPinnedKit,
  isSlotId,
  isScopeId,
} = uiKit;

// ─── Vocabulary integrity ────────────────────────────────────────────────────

test("every slot belongs to exactly one scope, and the grouping matches", () => {
  assert.equal(SLOT_IDS.length, 27, "27 switchable surfaces");
  for (const slot of SLOT_IDS) {
    const scope = SLOT_SCOPES[slot];
    assert.ok(SCOPE_IDS.includes(scope), `${slot} has a known scope`);
    assert.ok(SLOTS_BY_SCOPE[scope].includes(slot), `${slot} is listed under ${scope}`);
  }
  const grouped = SCOPE_IDS.flatMap((scope) => SLOTS_BY_SCOPE[scope]);
  assert.equal(new Set(grouped).size, SLOT_IDS.length, "no slot is listed twice");
  assert.deepEqual(SLOTS_BY_SCOPE.primitives, ["button", "segmented", "toggle", "status", "field", "scrollFade"]);
  assert.equal(SLOTS_BY_SCOPE.overlay.length, 7);
  assert.equal(SLOTS_BY_SCOPE.shell.length, 7);
  assert.equal(SLOTS_BY_SCOPE.conversation.length, 7);
});

test("the settings page is pinned to claude, not switchable", () => {
  assert.equal(SETTINGS_PINNED_KIT, "claude");
});

test("defaults keep today's look: pi, standard density, toggle in the sidebar", () => {
  assert.deepEqual(DEFAULT_UI_KIT_SETTINGS, {
    kit: "pi",
    scopes: {},
    slots: {},
    layout: "standard",
    sidebarToggle: "sidebar",
  });
  assert.equal(DEFAULT_KIT, "pi");
});

// ─── Pair-list codec ─────────────────────────────────────────────────────────

test("pair lists round-trip and are serialized in a stable order", () => {
  // `button` is a slot, not a scope, so it is dropped by the scope validator.
  const parsed = parsePairList("shell=claude, primitives=pi ,button=claude", isScopeId);
  assert.deepEqual(parsed, { shell: "claude", primitives: "pi" });
  const encoded = serializePairList({ shell: "claude", overlay: "pi", primitives: "claude" });
  assert.equal(encoded, "overlay=pi,primitives=claude,shell=claude");
  assert.deepEqual(parsePairList(encoded, isScopeId), { overlay: "pi", primitives: "claude", shell: "claude" });
});

test("unknown keys and bad kit ids are dropped instead of throwing", () => {
  assert.deepEqual(parsePairList("nope=claude,shell=bogus,shell=claude", isScopeId), { shell: "claude" });
  assert.deepEqual(parsePairList("", isScopeId), {});
  assert.deepEqual(parsePairList(null, isScopeId), {});
  assert.deepEqual(parsePairList("=claude,shell", isScopeId), {});
  assert.deepEqual(parsePairList("button=claude", isSlotId), { button: "claude" });
});

// ─── Resolution precedence ───────────────────────────────────────────────────

test("slot beats scope beats global", () => {
  const settings = normalizeUiKitSettings({
    kit: "pi",
    scopes: { shell: "claude" },
    slots: { composer: "pi" },
    layout: "standard",
    sidebarToggle: "sidebar",
  });
  assert.equal(resolveSlotKit(settings, "sidebar"), "claude", "scope override applies");
  assert.equal(resolveSlotKit(settings, "composer"), "pi", "slot override wins over its scope");
  assert.equal(resolveSlotKit(settings, "button"), "pi", "untouched scope follows the global kit");
  assert.equal(resolveScopeKit(settings, "shell"), "claude");
});

test("a slot may override a scope that is not overridden itself", () => {
  const settings = normalizeUiKitSettings({
    kit: "claude",
    scopes: {},
    slots: { messageList: "pi" },
    layout: "standard",
    sidebarToggle: "sidebar",
  });
  assert.equal(resolveSlotKit(settings, "messageList"), "pi");
  assert.equal(resolveSlotKit(settings, "messageShell"), "claude");
});

// ─── Normalization: no duplicated truth ─────────────────────────────────────

test("overrides equal to what they would inherit are not stored", () => {
  const normalized = normalizeUiKitSettings({
    kit: "claude",
    scopes: { shell: "claude", overlay: "pi" },
    slots: { composer: "claude", dialogShell: "pi", palette: "claude", thinking: "pi" },
    layout: "standard",
    sidebarToggle: "sidebar",
  });
  assert.deepEqual(normalized.scopes, { overlay: "pi" });
  // composer repeats its scope (shell=claude) and dialogShell repeats overlay=pi,
  // so both are dropped; palette and thinking genuinely differ from what they inherit.
  assert.deepEqual(normalized.slots, { palette: "claude", thinking: "pi" });
});

test("switching the global kit drops the overrides it absorbed", () => {
  const base = normalizeUiKitSettings({
    kit: "pi",
    scopes: { shell: "claude" },
    slots: {},
    layout: "standard",
    sidebarToggle: "sidebar",
  });
  const switched = withKit(base, "claude");
  assert.deepEqual(switched.scopes, {}, "shell=claude was the same as the new global kit");
  assert.equal(resolveSlotKit(switched, "composer"), "claude");
});

// ─── Setters ────────────────────────────────────────────────────────────────

test("setters are pure and normalize on write", () => {
  const base = parseUiKitSettings({});
  const withOne = withSlot(base, "sidebar", "claude");
  assert.equal(base.slots.sidebar, undefined, "the input object is untouched");
  assert.equal(withOne.slots.sidebar, "claude");
  assert.equal(withSlot(withOne, "sidebar", null).slots.sidebar, undefined);
  assert.equal(withScope(base, "overlay", "claude").scopes.overlay, "claude");
  assert.equal(withLayout(base, "compact").layout, "compact");
  assert.equal(withSidebarToggle(base, "titlebar").sidebarToggle, "titlebar");
});

test("invalid setter input falls back instead of corrupting settings", () => {
  const base = parseUiKitSettings({});
  assert.equal(withKit(base, "nope").kit, "pi");
  assert.equal(withLayout(base, "gigantic").layout, "standard");
  assert.equal(withSidebarToggle(base, "floating").sidebarToggle, "sidebar");
});

// ─── Storage + dataset bridge ───────────────────────────────────────────────

test("storage serialization is stable and parseable again", () => {
  const settings = normalizeUiKitSettings({
    kit: "claude",
    scopes: { shell: "pi" },
    slots: { messageList: "pi" },
    layout: "comfortable",
    sidebarToggle: "titlebar",
  });
  const stored = serializeUiKitSettings(settings);
  assert.deepEqual(stored, {
    "pi-ui-kit": "claude",
    "pi-ui-kit-scopes": "shell=pi",
    "pi-ui-kit-slots": "messageList=pi",
    "pi-ui-kit-layout": "comfortable",
    "pi-ui-kit-sidebar-toggle": "titlebar",
  });
  assert.deepEqual(
    parseUiKitSettings({
      kit: stored["pi-ui-kit"],
      scopes: stored["pi-ui-kit-scopes"],
      slots: stored["pi-ui-kit-slots"],
      layout: stored["pi-ui-kit-layout"],
      sidebarToggle: stored["pi-ui-kit-sidebar-toggle"],
    }),
    settings,
  );
});

test("dataset bridge round-trips through the inline bootstrap shape", () => {
  const settings = normalizeUiKitSettings({
    kit: "claude",
    scopes: { conversation: "pi" },
    slots: { thinking: "claude" },
    layout: "compact",
    sidebarToggle: "titlebar",
  });
  const dataset = datasetFromSettings(settings);
  assert.equal(dataset["uiKit"], "claude");
  assert.equal(dataset["uiKitScopes"], "conversation=pi");
  assert.equal(dataset["uiKitSlots"], "thinking=claude");
  assert.deepEqual(settingsFromDataset(dataset), settings);
  assert.deepEqual(settingsFromDataset(undefined), DEFAULT_UI_KIT_SETTINGS);
  assert.deepEqual(settingsFromDataset({ uiKit: "garbage" }), DEFAULT_UI_KIT_SETTINGS);
});

test("garbage input of every shape degrades to the defaults", () => {
  for (const input of [null, undefined, 42, "claude", [], { kit: 1, scopes: [], slots: "x", layout: {}, sidebarToggle: false }]) {
    assert.deepEqual(parseUiKitSettings(input), DEFAULT_UI_KIT_SETTINGS);
  }
});

// ─── Pinning ───────────────────────────────────────────────────────────────

test("a pinned subtree ignores every override", () => {
  const settings = normalizeUiKitSettings({
    kit: "pi",
    scopes: { primitives: "pi" },
    slots: { button: "pi", dialogShell: "pi" },
    layout: "comfortable",
    sidebarToggle: "titlebar",
  });
  const pinned = withPinnedKit(settings, "claude");
  for (const slot of SLOT_IDS) assert.equal(resolveSlotKit(pinned, slot), "claude");
  assert.equal(pinned.layout, "comfortable", "density still applies inside the pinned subtree");
  assert.equal(pinned.sidebarToggle, "titlebar");
});

// ─── S4: cross-global-switch slot residue is undecidable, by construction ──
//
// The requested fix was: "when normalize drops a scope override, also drop
// that scope's slot overrides that equal the OLD scope value". These tests
// record why that rule can never fire, so the claim stays checkable instead of
// living in a report. See the dispatcher brief: no code change was made for S4.

const scopeCombos = SCOPE_IDS.reduce((acc) => acc.flatMap((a) => [undefined, "pi", "claude"].map((v) => [...a, v])), [[]]);

test("normalize never stores a slot override equal to what it inherits", () => {
  for (const kit of ["pi", "claude"]) {
    for (const combo of scopeCombos) {
      const scopes = {};
      SCOPE_IDS.forEach((scope, i) => { if (combo[i] !== undefined) scopes[scope] = combo[i]; });
      for (const slot of SLOT_IDS) {
        for (const value of [undefined, "pi", "claude"]) {
          const out = normalizeUiKitSettings({
            kit, scopes, slots: value === undefined ? {} : { [slot]: value },
            layout: "standard", sidebarToggle: "sidebar",
          });
          for (const s of SLOT_IDS) {
            if (out.slots[s] === undefined) continue;
            assert.notEqual(out.slots[s], out.scopes[SLOT_SCOPES[s]] ?? out.kit,
              `${s} must not repeat what it inherits`);
          }
        }
      }
    }
  }
});

test("dropping a scope override can never leave a slot equal to the dropped value", () => {
  // The exact precondition the requested cleanup keys on. A scope value equal to
  // the kit is dropped, so it becomes the inheritance for its slots — and a slot
  // equal to the inheritance is never stored in the first place. The rule is a
  // no-op over every reachable input, which is why S4 has no code fix.
  for (const kit of ["pi", "claude"]) {
    for (const scope of SCOPE_IDS) {
      for (const slot of SLOTS_BY_SCOPE[scope]) {
        const out = normalizeUiKitSettings({
          kit, scopes: { [scope]: kit }, slots: { [slot]: kit },
          layout: "standard", sidebarToggle: "sidebar",
        });
        assert.deepEqual(out.scopes, {}, `${scope}=${kit} repeats the global kit`);
        assert.equal(out.slots[slot], undefined, `${slot}=${kit} repeats what it inherits`);
      }
    }
  }
});

test("S4 repro: a slot that deviates from both its scope and the kit survives on purpose", () => {
  const step1 = normalizeUiKitSettings({
    kit: "claude", scopes: { primitives: "pi" }, slots: { button: "claude" },
    layout: "standard", sidebarToggle: "sidebar",
  });
  assert.deepEqual(step1.scopes, { primitives: "pi" });
  assert.deepEqual(step1.slots, { button: "claude" });

  const step2 = withKit(step1, "pi");
  assert.deepEqual(step2.scopes, {}, "primitives=pi became the global kit and is absorbed");
  assert.deepEqual(step2.slots, { button: "claude" }, "button still differs from what it inherits");
  assert.equal(resolveSlotKit(step2, "button"), "claude");
  assert.equal(resolveScopeKit(step2, "primitives"), "pi", "every other primitive follows the new kit");
});

test("S4 is undecidable: two different histories serialize identically", () => {
  // H1 — kit=pi, no scope override, the user pinned button to claude directly.
  const h1 = withSlot(parseUiKitSettings({}), "button", "claude");
  assert.equal(h1.kit, "pi");
  // H2 — kit=claude, the user set primitives=pi, then switched the global kit to
  //      pi so that scope override was absorbed. The surviving button=claude is
  //      byte-identical to H1 even though only H1 was ever a direct slot choice.
  const h2 = withKit(normalizeUiKitSettings({
    kit: "claude", scopes: { primitives: "pi" }, slots: { button: "claude" },
    layout: "standard", sidebarToggle: "sidebar",
  }), "pi");
  assert.deepEqual({ kit: h2.kit, scopes: h2.scopes, slots: h2.slots },
    { kit: h1.kit, scopes: h1.scopes, slots: h1.slots },
    "no rule over stored state can tell a genuine pin from absorbed scope history");
});
