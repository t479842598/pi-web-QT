import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API key saves bypass ModelRuntime catalog refresh and store the credential", async () => {
  const source = await readFile(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /modelRuntime\.login\(/);
  assert.match(source, /apiKeyAuth\.login\(/);
  assert.match(source, /signal:\s*req\.signal/);
  assert.match(source, /storeProviderCredential\(provider, credential\)/);
});

test("auth changes invalidate both the /api/models cache and the in-process model list", async () => {
  const apiKeyRoute = await readFile(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf8");
  const loginRoute = await readFile(new URL("../app/api/auth/login/[provider]/route.ts", import.meta.url), "utf8");
  const logoutRoute = await readFile(new URL("../app/api/auth/logout/[provider]/route.ts", import.meta.url), "utf8");

  for (const [name, source] of [
    ["api-key", apiKeyRoute],
    ["login", loginRoute],
    ["logout", logoutRoute],
  ]) {
    assert.match(source, /invalidateModelsCache\(\)/, `${name} route must clear the /api/models cache`);
    assert.match(source, /invalidateAvailableModelsCache\(\)/, `${name} route must clear the in-process model list`);
  }
});
