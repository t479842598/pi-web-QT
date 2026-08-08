import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Isolate storage to a temp file (PI_SNIPPETS_FILE) so tests never touch the
// real ~/.pi/agent/snippets.json.
const tmp = mkdtempSync(join(tmpdir(), "snip-test-"));
const snippetsFile = join(tmp, "snippets.json");
process.env.PI_SNIPPETS_FILE = snippetsFile;

const { createSnippet, listSnippets, updateSnippet, deleteSnippet } = await createJiti(import.meta.url).import("./snippet-store.ts");

test("create/list/update/delete snippets with atomic persistence", async () => {
  const s1 = createSnippet({ name: "git", content: "git status\n" });
  const s2 = createSnippet({ name: "todo", content: "- [ ] task" });
  assert.equal(listSnippets().length, 2);
  assert.equal(s1.name, "git");

  const updated = updateSnippet(s1.id, { content: "git diff\n" });
  assert.equal(updated?.content, "git diff\n");
  assert.equal(listSnippets().find((s) => s.id === s1.id)?.content, "git diff\n");

  assert.equal(deleteSnippet(s2.id), true);
  assert.equal(deleteSnippet("missing"), false);
  assert.equal(listSnippets().length, 1);

  // Persistence: fresh module state re-reads the same file.
  const again = await createJiti(import.meta.url).import("./snippet-store.ts");
  assert.equal(again.listSnippets().length, 1);
  assert.equal(again.listSnippets()[0].name, "git");
  assert.equal(existsSync(snippetsFile), true);

  rmSync(tmp, { recursive: true, force: true });
});
