import assert from "node:assert/strict";
import test from "node:test";

import { invalidateModelsCache, loadModelsWithCache } from "./models-cache.ts";

function modelsData(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
  };
}

test("caches model data independently for each cwd", async () => {
  invalidateModelsCache();
  let firstLoads = 0;
  let secondLoads = 0;

  const first = await loadModelsWithCache("/first", async () => {
    firstLoads += 1;
    return modelsData("first");
  });
  await loadModelsWithCache("/second", async () => {
    secondLoads += 1;
    return modelsData("second");
  });
  const firstAgain = await loadModelsWithCache("/first", async () => {
    firstLoads += 1;
    return modelsData("replacement");
  });

  assert.deepEqual(firstAgain, first);
  assert.equal(firstLoads, 1);
  assert.equal(secondLoads, 1);
});

test("shares one loader between concurrent requests for the same cwd", async () => {
  invalidateModelsCache();
  let loads = 0;
  let finishLoad;
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => { finishLoad = resolve; });
  };

  const first = loadModelsWithCache("/shared", loader);
  const second = loadModelsWithCache("/shared", loader);
  await Promise.resolve();

  assert.equal(loads, 1);
  finishLoad(modelsData("shared"));
  assert.deepEqual(await second, await first);
});

test("does not cache a stale load that finishes after invalidation", async () => {
  invalidateModelsCache();
  let finishOldLoad;
  const oldLoad = loadModelsWithCache("/stale", () => new Promise((resolve) => { finishOldLoad = resolve; }));
  await Promise.resolve();

  invalidateModelsCache();
  let freshLoads = 0;
  const fresh = await loadModelsWithCache("/stale", async () => {
    freshLoads += 1;
    return modelsData("fresh");
  });
  finishOldLoad(modelsData("stale"));
  await oldLoad;

  const cached = await loadModelsWithCache("/stale", async () => {
    freshLoads += 1;
    return modelsData("unexpected");
  });
  assert.deepEqual(cached, fresh);
  assert.equal(freshLoads, 1);
});

test("retries after a model load fails", async () => {
  invalidateModelsCache();
  await assert.rejects(
    loadModelsWithCache("/failed", async () => { throw new Error("load failed"); }),
    /load failed/,
  );

  let retries = 0;
  const fresh = await loadModelsWithCache("/failed", async () => {
    retries += 1;
    return modelsData("fresh");
  });
  assert.deepEqual(fresh, modelsData("fresh"));
  assert.equal(retries, 1);
});

test("returns stale data while sharing a background refresh", async () => {
  invalidateModelsCache();
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await loadModelsWithCache("/swr", async () => modelsData("old"));
    now += 60_001;

    let refreshes = 0;
    let finishRefresh;
    const loader = () => {
      refreshes += 1;
      return new Promise((resolve) => { finishRefresh = resolve; });
    };
    const first = await loadModelsWithCache("/swr", loader);
    const second = await loadModelsWithCache("/swr", loader);
    await Promise.resolve();
    assert.equal(first.modelList[0].id, "old");
    assert.equal(second.modelList[0].id, "old");
    assert.equal(refreshes, 1);
    finishRefresh(modelsData("new"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const fresh = await loadModelsWithCache("/swr", async () => modelsData("unexpected"));
    assert.equal(fresh.modelList[0].id, "new");
  } finally {
    Date.now = originalNow;
  }
});

test("uses a safe error for unexpected model load failures", () => {
  const data = {
    ...modelsData("builtin"),
    modelError: "Failed to load /Users/example/.pi/agent/models.json with token secret",
  };
  const result = withSafeModelLoadFailure(data);

  assert.deepEqual(result, {
    ...data,
    modelError: "Model list is temporarily unavailable. Check your configuration and try again.",
  });
});
