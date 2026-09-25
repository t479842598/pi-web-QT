import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  ModelsConfigReadError,
  readModelsConfig,
  replaceModelsConfig,
} = await jiti.import("./models-config-store.ts");

function createTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-models-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Fork note: writes go through replaceModelsConfig → mutateModelsConfig
// (lockfile + atomic write + cache invalidation) instead of upstream's
// synchronous writeModelsConfig. The read-leniency and never-replace
// contracts are the same.

test("models.json reads accept the BOM, comments and trailing commas pi accepts", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, `\uFEFF{
  // Hand-edited provider
  "providers": {
    "acme": {
      "baseUrl": "https://models.example.test/v1", // keeps the // inside strings
      "apiKey": "key,}",
      "models": [{ "id": "acme-2", }],
    },
  },
}
`);

  assert.deepEqual(readModelsConfig(modelsPath), {
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        apiKey: "key,}",
        models: [{ id: "acme-2" }],
      },
    },
  });
});

test("an unreadable models.json is reported and never replaced by a save", async (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  const original = '{ "providers": { "acme": { "models": [ } } }';
  writeFileSync(modelsPath, original);

  assert.throws(() => readModelsConfig(modelsPath), ModelsConfigReadError);
  await assert.rejects(
    () => replaceModelsConfig({ providers: { other: { models: [] } } }, modelsPath),
    ModelsConfigReadError,
  );
  assert.equal(readFileSync(modelsPath, "utf8"), original);

  writeFileSync(modelsPath, "[]");
  assert.throws(() => readModelsConfig(modelsPath), /expected an object/);
});

test("an empty models.json reads as no providers and can be saved over", async (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, "\n");

  assert.deepEqual(readModelsConfig(modelsPath), { providers: {} });
  await replaceModelsConfig({ providers: { acme: { models: [] } } }, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), { providers: { acme: { models: [] } } });
});
