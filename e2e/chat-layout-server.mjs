import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { outputFiles } = await build({
  absWorkingDir: root,
  entryPoints: ["e2e/chat-layout-fixture.tsx"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "empty" },
});
const sourceCss = await readFile(join(root, "app/globals.css"), "utf8");
const visibilityRule = sourceCss.match(/\.chat-user-message,\s*\.chat-assistant-message:not\(\.is-streaming\)\s*\{[^}]*\}/)?.[0] ?? "";
const virtualRule = sourceCss.match(/\.virtualized-message-list [^{]+\{[^}]*\}/)?.[0] ?? "";
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Pi Web 布局回归</title><style>
* { box-sizing: border-box; } body { font: 14px/1.65 system-ui; margin: 16px; color: #252525; background: white; }
h1 { font-size: 20px; } button { padding: 4px 8px; margin: 3px; } output { display: block; white-space: pre-wrap; min-height: 28px; }
.fixture-scroll { height: 600px; max-width: 100%; overflow-y: auto; border: 1px solid #aaa; position: relative; }
.chat-assistant-message { margin-bottom: 22px; padding: 8px; } .markdown-body { overflow-wrap: anywhere; } .markdown-body p { margin: 8px 0; } .markdown-body h3 { margin: 10px 0; }
${visibilityRule}\n${virtualRule}
</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(outputFiles[0].contents);
  } else if (request.url === "/" || request.url?.startsWith("/?")) {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(page);
  } else {
    response.statusCode = 404;
    response.end();
  }
});
server.listen(0, "127.0.0.1", () => console.log(`Layout fixture: http://127.0.0.1:${server.address().port}`));
const stop = () => server.close(() => process.exit(0));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
