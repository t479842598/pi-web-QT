import assert from "node:assert/strict";
import { join } from "node:path";

export const extensionSource = `export default function (pi) {
  pi.registerCommand("e2e-dialog", {
    handler: async (mode, ctx) => {
      let result;
      if (mode === "timeout") {
        await ctx.ui.select("E2E timeout", ["Wait"], { timeout: 4000 });
        result = await ctx.ui.input("E2E after timeout");
      } else if (mode === "select") {
        result = await ctx.ui.select("E2E select", Array.from({ length: 30 }, (_, i) => "Option " + (i + 1)));
      } else {
        result = await ctx.ui[mode]("E2E " + mode, "Details");
      }
      ctx.ui.notify("E2E " + mode + " result: " + String(result));
    },
  });
}`;

/**
 * Capability gate for the extension dialog scenario.
 *
 * The suite's agent dir is a fresh mkdtemp (e2e/run.mjs) that seeds sessions,
 * the preview fixture, and extensions/e2e-dialog.js — and deliberately no
 * provider credential (no auth.json, no models.json). With nothing to
 * authenticate against, GET /api/models reports an empty catalogue, the
 * composer renders the "No models configured" empty state, and the prompt the
 * scenario relies on never reaches an agent: POST /api/agent/<id> with
 * type:"prompt" is accepted and then hangs with no response and no agent
 * events, so getByRole("dialog", { name: "E2E select" }) can only ever time
 * out. That is an unrunnable fixture, not a regression, so report it the way
 * the kit-parity gate reports a missing baseline ("Skipped while the baseline
 * is absent") and let the rest of the suite continue. Every assertion below
 * stays in force whenever a model really is available.
 */
export async function readModelCapability(page) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get(origin + "/api/models");
  if (!response.ok()) {
    return { available: false, reason: "GET /api/models -> HTTP " + response.status() };
  }
  const data = await response.json().catch(() => null);
  if (!data || data.error) {
    return { available: false, reason: "GET /api/models -> " + JSON.stringify(data?.error ?? data).slice(0, 120) };
  }
  const count = (data.modelList ?? []).length || Object.keys(data.models ?? {}).length;
  if (!count) {
    return { available: false, reason: "0 models (defaultModel " + JSON.stringify(data.defaultModel) + ")" };
  }
  return { available: true, count, defaultModel: data.defaultModel ?? null };
}

export async function checkExtensionDialogs(page, artifacts, width) {
  const capability = await readModelCapability(page);
  if (!capability.available) {
    console.log("SKIP: " + width + "px extension dialogs — the e2e agent dir seeds no provider "
      + "credential, so /api/models has " + capability.reason + " and a prompt can never start an "
      + "agent to raise a dialog (needs a fixture with a real or stubbed provider credential).");
    return { skipped: true, reason: "no-models" };
  }
  const commands = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)) {
      commands.push(request.postDataJSON());
    }
  };
  page.on("request", onRequest);
  const start = async (mode) => {
    await page.mouse.move(0, 0);
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    const input = page.locator("textarea").last();
    await input.fill(`/e2e-dialog ${mode}`);
    // The composer's accessible name is "Send message" (ChatInput.tsx:3547
    // → desktop.sendMessage, en.ts:526), not "Send": chat.send exists in the
    // catalog with no consumer. exact:true therefore never matched, and this
    // scenario only started running now that the file-panel click lands.
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `E2E ${mode}`, exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const finish = async (mode, result) => {
    await page.getByText(`E2E ${mode} result: ${result}`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };

  try {
    const select = await start("select");
    await page.waitForFunction(() => document.activeElement?.textContent === "Option 1");
    for (const [key, expected] of [["ArrowUp", "Option 30"], ["ArrowDown", "Option 1"], ["ArrowRight", "Option 2"], ["ArrowLeft", "Option 1"], ["End", "Option 30"], ["Home", "Option 1"], ["End", "Option 30"]]) {
      await page.keyboard.press(key);
      assert.equal(await page.locator(":focus").textContent(), expected);
    }
    assert.ok(await page.locator(":focus").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const container = element.parentElement.parentElement.getBoundingClientRect();
      return bounds.top >= container.top && bounds.bottom <= container.bottom;
    }), "Keyboard selection must scroll into view");
    await page.screenshot({ path: join(artifacts, `extension-select-${width}.png`) });
    await page.keyboard.press("Enter");
    await select.waitFor({ state: "hidden" });
    await finish("select", "Option 30");

    for (const mode of ["select", "confirm", "input", "editor"]) {
      const dialog = await start(mode);
      assert.ok(await page.locator(":focus").evaluate(element => element.closest('[role="dialog"]')));
      if (mode === "input" || mode === "editor") {
        await dialog.getByRole("textbox").fill("Preserved draft");
        await dialog.getByRole("button", { name: "Collapse", exact: true }).click();
        await page.getByRole("button", { name: new RegExp(`Awaiting response.*E2E ${mode}`) }).click();
        assert.equal(await dialog.getByRole("textbox").inputValue(), "Preserved draft");
      }
      if (mode === "input" || mode === "editor") await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
      const before = commands.length;
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await finish(mode, mode === "confirm" ? "false" : "undefined");
      assert.equal(commands.slice(before).filter(command => command.type === "extension_ui_response").length, 1);
      assert.equal(commands.slice(before).some(command => command.type === "abort"), false, "Dialog Esc must not abort the agent");
    }

    const timed = await start("timeout");
    const countdown = timed.getByText(/expires in \ds/);
    await countdown.waitFor();
    const initialCountdown = await countdown.innerText();
    await page.waitForFunction(initial => {
      const text = document.querySelector('[role="dialog"]')?.textContent;
      return text?.includes("expires in") && !text.includes(initial);
    }, initialCountdown);
    const before = commands.length;
    await timed.getByRole("button", { name: "Collapse", exact: true }).click();
    await page.getByRole("button", { name: /Awaiting response.*E2E timeout.*expires in/ }).waitFor();
    const afterTimeout = page.getByRole("dialog", { name: "E2E after timeout", exact: true });
    await afterTimeout.waitFor();
    assert.equal(commands.slice(before).some(command => command.type === "extension_ui_response"), false, "Only the server closes expired requests");
    assert.equal(await afterTimeout.getByText(/expires in/).count(), 0);
    await afterTimeout.getByRole("textbox").fill("Still answerable");
    await page.keyboard.press("Enter");
    await finish("timeout", "Still answerable");
    console.log(`PASS: ${width}px extension keyboard navigation, cancel, draft preservation, and server expiry`);
  } finally {
    page.off("request", onRequest);
  }
}
