import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneForeignNativePackages } from "./prune-native-foreign.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prune-test-"));
  const backend = join(root, "backend");
  const nm = join(backend, "node_modules");
  const mk = (rel) => {
    mkdirSync(join(nm, rel), { recursive: true });
    writeFileSync(join(nm, rel, "package.json"), "{}");
  };
  // sharp 平台包（全部预置，模拟 Linux x64 glibc 目标）
  for (const p of [
    "@img/colour",
    "@img/sharp-wasm32",
    "@img/sharp-linux-x64",
    "@img/sharp-libvips-linux-x64",
    "@img/sharp-linuxmusl-x64",
    "@img/sharp-libvips-linuxmusl-x64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-win32-x64",
  ]) mk(p);
  // next swc 平台包
  for (const p of [
    "@next/swc-linux-x64-gnu",
    "@next/swc-linux-x64-musl",
    "@next/swc-darwin-arm64",
    "@next/swc-env",
  ]) mk(p);
  // pi-tui 全平台 prebuilds
  for (const t of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
    mkdirSync(join(nm, "@earendil-works/pi-tui/native", t.split("-")[0], "prebuilds", t), { recursive: true });
  }
  return { root, backend };
}

test("linux-x64 glibc：保留 gnu 变体，删掉 musl/darwin/win32", () => {
  const { root, backend } = fixture();
  try {
    const removed = pruneForeignNativePackages({ backendDir: backend, platform: "linux", arch: "x64", isMusl: false });
    const nm = join(backend, "node_modules");
    assert.ok(existsSync(join(nm, "@img/sharp-linux-x64")), "sharp-linux-x64 保留");
    assert.ok(existsSync(join(nm, "@img/sharp-libvips-linux-x64")), "libvips-linux-x64 保留");
    assert.ok(existsSync(join(nm, "@img/colour")), "colour 保留");
    assert.ok(existsSync(join(nm, "@img/sharp-wasm32")), "wasm32 保留");
    assert.ok(!existsSync(join(nm, "@img/sharp-linuxmusl-x64")), "musl 变体被删");
    assert.ok(!existsSync(join(nm, "@img/sharp-darwin-arm64")), "darwin 被删");
    assert.ok(!existsSync(join(nm, "@img/sharp-win32-x64")), "win32 被删");
    assert.ok(existsSync(join(nm, "@next/swc-linux-x64-gnu")), "swc gnu 保留");
    assert.ok(!existsSync(join(nm, "@next/swc-linux-x64-musl")), "swc musl 被删");
    assert.ok(!existsSync(join(nm, "@next/swc-darwin-arm64")), "swc darwin 被删");
    assert.ok(existsSync(join(nm, "@next/swc-env")), "swc-env（非平台包）保留");
    assert.ok(existsSync(join(nm, "@earendil-works/pi-tui/native/linux/prebuilds/linux-x64")), "pi-tui linux-x64 保留");
    assert.ok(!existsSync(join(nm, "@earendil-works/pi-tui/native/linux/prebuilds/linux-arm64")), "pi-tui linux-arm64 被删");
    assert.ok(!existsSync(join(nm, "@earendil-works/pi-tui/native/darwin")), "pi-tui darwin 整目录被删");
    assert.ok(!existsSync(join(nm, "@earendil-works/pi-tui/native/win32")), "pi-tui win32 整目录被删");
    assert.ok(removed.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("linux-x64 musl：保留 musl 变体，删掉 gnu", () => {
  const { root, backend } = fixture();
  try {
    pruneForeignNativePackages({ backendDir: backend, platform: "linux", arch: "x64", isMusl: true });
    const nm = join(backend, "node_modules");
    assert.ok(existsSync(join(nm, "@img/sharp-linuxmusl-x64")), "sharp musl 保留");
    assert.ok(!existsSync(join(nm, "@img/sharp-linux-x64")), "sharp gnu 被删");
    assert.ok(existsSync(join(nm, "@next/swc-linux-x64-musl")), "swc musl 保留");
    assert.ok(!existsSync(join(nm, "@next/swc-linux-x64-gnu")), "swc gnu 被删");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("darwin-arm64：保留本机 sharp/swc，删掉其余", () => {
  const { root, backend } = fixture();
  try {
    pruneForeignNativePackages({ backendDir: backend, platform: "darwin", arch: "arm64", isMusl: false });
    const nm = join(backend, "node_modules");
    assert.ok(existsSync(join(nm, "@img/sharp-darwin-arm64")), "sharp darwin-arm64 保留");
    assert.ok(!existsSync(join(nm, "@img/sharp-linux-x64")), "sharp linux 被删");
    assert.ok(existsSync(join(nm, "@next/swc-darwin-arm64")), "swc darwin 保留");
    assert.ok(existsSync(join(nm, "@earendil-works/pi-tui/native/darwin/prebuilds/darwin-arm64")), "pi-tui darwin-arm64 保留");
    assert.ok(existsSync(join(nm, "@earendil-works/pi-tui/native/darwin/prebuilds/darwin-x64")), "跨架构：macOS runner 要同时带 x64 dmg，darwin 目录内 triple 不精删");
    assert.ok(!existsSync(join(nm, "@earendil-works/pi-tui/native/linux")), "pi-tui linux 被删");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("空后端目录不报错", () => {
  const root = mkdtempSync(join(tmpdir(), "prune-empty-"));
  try {
    const removed = pruneForeignNativePackages({ backendDir: root, platform: "linux", arch: "x64", isMusl: false });
    assert.deepEqual(removed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
