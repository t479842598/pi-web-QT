"use strict";

// Pi Web Desktop — 内置后端启动器（随包 standalone 服务器入口）。
// 打包脚本 scripts/bundle-backend.mjs 会把它复制为
// resources/backend/desktop-server.cjs，Rust 侧（probe::spawn_bundled）
// 优先以它作为入口拉起内置 Node + Next.js。

// 进程保持策略：客户端（GUI 壳）退出后，本机后端继续常驻运行，下次启动 /
// 其他客户端 / 浏览器可直接复用 30141。不再随父进程退出；需要停止时用
// 连接页「关闭本机服务」按钮（Rust 侧 stop_local 命令会杀本进程）。

// ABI 不匹配保险丝：包装 process.dlopen，使按不同 NODE_MODULE_VERSION 编译的
// 原生模块报出清晰、可操作的错误，而不是难懂的 "Live session indexing failed"
// 或裸的 "compiled against a different Node.js version"。
//
// 桌面端打包 Node v22（ABI 127），而 CLI 的 `pi` 可能跑在系统 Node 下
// （如 v26，ABI 147），两者从同一个 ~/.pi/agent/npm/node_modules 加载 .node
// 文件。.node 文件锁定其编译时的 ABI，谁编译的就只有谁能加载。在这里接住
// 失败，告诉用户如何重建，而不是让会话索引器（或任何其他原生扩展）半坏。
if (typeof process.dlopen === "function") {
  const originalDlopen = process.dlopen;
  process.dlopen = function dlopenAbiGuard(module, filename, ...rest) {
    try {
      return originalDlopen.call(this, module, filename, ...rest);
    } catch (error) {
      const message = String(error?.message ?? error);
      // Node 的 dlopen ABI 错误会同时给出两个 NODE_MODULE_VERSION 数字。
      const match = /NODE_MODULE_VERSION\s+(\d+)/gi.exec(message);
      const secondMatch = match && /NODE_MODULE_VERSION\s+(\d+)/gi.exec(message.slice(match.index + match[0].length));
      if (match) {
        const compiledAbi = match[1];
        const runtimeAbi = secondMatch ? secondMatch[1] : String(process.versions.modules);
        const enhanced = new Error(
          `[Pi Web] Native module ABI mismatch: ${filename}\n` +
            `  compiled for NODE_MODULE_VERSION ${compiledAbi}, runtime is NODE_MODULE_VERSION ${runtimeAbi} (Node ${process.version}).\n` +
            `  The desktop bundles Node ${process.version} but ~/.pi/agent/npm is shared with the CLI, which may\n` +
            `  have compiled this .node under a different Node major.\n` +
            `  Fix: run \`pi update --extensions\` (or remove the offending package from\n` +
            `  ~/.pi/agent/npm/node_modules and let pi reinstall it), or run the desktop and\n` +
            `  the CLI under the same Node major version.\n` +
            `  Original error: ${message}`,
        );
        if (error?.code) enhanced.code = error.code;
        throw enhanced;
      }
      throw error;
    }
  };
}

// The standalone Next.js entrypoint is CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./server.js");
