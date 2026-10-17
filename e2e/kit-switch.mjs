/**
 * Kit-switch assertions, shared by `scripts/kit-switch-smoke.mjs` and the e2e
 * suite.
 *
 * Why this lives in one place: both regressions this feature has shipped were
 * invisible to the type checker — a slot proxy forwarding the wrong prop
 * contract renders an empty shell, and `ComponentProps` makes that legal. The
 * only reliable check is presence in the page after a flip.
 *
 * The caller owns the browser context and the server; this only drives a page.
 */

/**
 * Record the surfaces a kit switch is supposed to move.
 * @param {import("playwright").Page} page
 */
export async function readKitSurface(page) {
  return page.evaluate(() => {
    const row = document.querySelector(".session-row");
    const sidebar = document.querySelector(".claude-sidebar");
    const composer = document.querySelector(".chat-input-shell");
    return {
      kit: document.documentElement.dataset.uiKit,
      rows: document.querySelectorAll(".session-row").length,
      rowRadius: row ? getComputedStyle(row).borderRadius : null,
      claudeSidebar: Boolean(sidebar),
      claudeTabBar: document.querySelectorAll(".claude-tab-bar").length,
      claudeTitleBar: document.querySelectorAll(".claude-title-bar").length,
      // Presence, not styling: a proxy that forwards the wrong props renders an
      // empty shell, and no type error is produced.
      composerExists: Boolean(composer),
      composerTypable: Boolean(composer && composer.querySelector("textarea")),
      userTurnsWithText: [...document.querySelectorAll('[data-role="user"]')].filter(
        (node) => (node.innerText ?? "").trim().length > 0,
      ).length,
    };
  });
}

/** Click the real title-bar control — never seed storage. */
export async function flipToClaude(page) {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (node) => (node.textContent ?? "").trim() === "Claude",
    );
    if (!button) return false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
}

/**
 * Compare a before/after pair and return the list of problems. Empty means the
 * switch did what it promises.
 * @param {Awaited<ReturnType<typeof readKitSurface>>} before
 * @param {Awaited<ReturnType<typeof readKitSurface>>} after
 * @param {boolean} flipped
 */
export function kitSwitchProblems(before, after, flipped) {
  const problems = [];
  if (!flipped) problems.push("the Claude switch was not found in the title bar");
  if (before.kit !== "pi") problems.push(`expected the page to start on pi, saw ${before.kit}`);
  if (after.kit !== "claude") problems.push(`clicking the switch did not change the kit (saw ${after.kit})`);
  if (!after.claudeSidebar) problems.push("the claude sidebar did not mount");
  if (after.rows < 1) problems.push("no session rows rendered");
  if (after.rowRadius === before.rowRadius) {
    problems.push(`session rows did not change between kits (both ${before.rowRadius})`);
  }
  if (!after.composerExists) problems.push("the composer disappeared after switching");
  if (!after.composerTypable) problems.push("the composer has no textarea");
  if (after.claudeTitleBar < 1) problems.push("the claude title bar did not mount");
  // Only meaningful when the session under test has user turns at all.
  if (before.userTurnsWithText > 0 && after.userTurnsWithText === 0) {
    problems.push(`user turns lost their text after switching (${before.userTurnsWithText} -> 0)`);
  }
  return problems;
}
