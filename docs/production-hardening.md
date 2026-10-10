# 公网生产整改执行记录

## 当前基线（2026-10-08）

- 源码提交：`21fba93d4878ae93e43abe7ad3f773408944c089`；Web 0.18.13，桌面和 Flutter 清单均为 0.18.6；Pi SDK 0.87.1。
- 独立源码基线：`.reasonix/production-baseline-21fba93`（detached worktree）。主工作区原有 `.zcodeignore` 保持不动。
- 定向基线使用现有已安装依赖，尚非全新 `npm ci` 安装验收。原有认证、审批和备份测试共 53 项通过。
- 新增隔离行为复现共 9 项预期断言失败：页面 Basic 不计入限流、页面不遵守 API 限流、bash/write 的 ask 优先级、3 类命令只读误判、JSONC 备份脱敏和会话恢复。
- 测试进程使用临时 HOME、PI_CODING_AGENT_DIR 和临时目录、`PI_OFFLINE=1`；未传递真实模型凭据。危险命令仅作为策略函数输入，没有执行。

## 已记录证据

本地 `.reasonix/production-evidence/` 保存 `baseline-targeted.{json,log}` 和 `baseline-regressions.{json,log}`。复现文件固定引用旧源码；其失败是待修复行为的证据，不是当前版本已通过安全验收。证据校验：

```sh
node --test .reasonix/baseline-evidence.test.mjs
```

这些本地执行工件不进入发布包。后续修复必须加入正式测试目录，并验证修复后的源码。

## 已完成的局部修复

### 页面 Basic 认证限流

- 页面导航和 API 的 Basic 验证现在使用同一退避账本；页面不再通过重定向差异提供不限速的密码判断。
- 冷却期间正确及错误 Basic 都返回 429 和 `Retry-After`；等待到期后可重试。Basic 成功不清空失败历史，防止自动请求持续重置退避。
- 有效签名 Cookie 仍优先于 Basic 和限流；无 Basic 的登录页和静态资源继续可达。桌面仍支持页面 Basic，不改变 Cookie 隔离方式。
- 正式测试 `lib/web-auth-throttle-routing.test.mjs` 覆盖页面 GET/HEAD、开发/生产分支、页面/API/web-auth GET/POST 互限、Cookie 优先及退避到期。它直接调用处理器，**不等于真实 Next dev/start 或 Tauri 端到端验证**。
- 2026-10-08：47 项认证定向测试通过，TypeScript、定向 ESLint 和差异检查通过；最新代码独立复核通过。其余安全、迁移及上线条件未因此自动通过。

### Shell 审批与规则优先级

- 2026-10-08 用户选择取消 Shell 隐式放行：`ask` 模式下，`bash` / `powershell` 即便是 `ls`、`cat` 或 `git status`，也需要确认，除非命中明确的 `allow` 规则。专用 `read` / `grep` / `find` / `ls` 不受这一变化影响。
- 所有模式统一遵循 `deny > ask > allow`；显式 `ask` 不再被同样命中的 `allow` 遮蔽。原有 `auto` / `yolo` 回退和 nested bash 的精确授权行为保持；这不是 Shell 沙箱。
- Shell 的 `readOnly` 提示不会恢复隐式放行；PowerShell 的规则按 `command:` 匹配，避免无法对具体命令授权。
- 48 项权限／模式及包装器集成测试、TypeScript 和定向 lint 通过。包装器测试验证拒绝不调用下游、批准只转发一次、重复回复不重放及关闭会话清理。独立复核通过；下游使用 stub，真实 SDK 执行管线和三端审批交互仍属于后续验收。

### 模型配置备份脱敏

- `models.json` 导出复用模型面板的读取器，支持 BOM、行注释和尾逗号；包含／排除密钥两条分支都执行路径归一化。
- 排除密钥时清空 `providers.*.apiKey`（包括异常值类型）并继续排除 `auth.json`。读取或解析失败中止导出，错误使用固定文案，不回传可能含密钥的解析片段。
- 30 项备份与模型配置读取器测试、TypeScript、定向 lint 和独立复核通过；未修改或读取用户真实配置。
- 此开关沿用原有范围：模型 `apiKey` 与 `auth.json`。它不自动识别脚本、MCP 自定义字段或对话正文中的任意秘密，不能把导出的整个包当作可公开分享的脱敏文件。

### 会话恢复（仅补回缺失历史）

- 选择 `sessions` 后，恢复 JSONL 及同名 `.queue.json` / `.goal.json`；已有任一文件则整组跳过并报告。暂不提供覆盖模式，避免把备份旧状态混入现有会话。
- 会话正文保持原始字节；运行目标改为 `paused`，队列仅持久化，恢复不创建 AgentSession、不投递消息。孤儿侧文件与索引不恢复。
- 源树和目标子目录不跟随符号链接。新文件以私有权限暂存，硬链接排他发布，历史最后发布；中途失败按 bigint `dev/ino` 检查清理归属，保留被其他写入者替换的文件。清理失败记入结果报告，不吞掉已恢复结果。
- 44 项备份／恢复／模型读取器测试通过，包含 14 项会话恢复与故障注入；TypeScript、定向 lint 和最终独立复核通过。验证平台为当前 macOS；Windows 和不支持硬链接的文件系统尚未验收，硬链接失败会报告而不会降级为覆盖写入。
- 旧 `cwd` 和 `parentSession` 未猜测重映射：保留原值并提示核对。跨主机路径迁移、生产数据完整回滚及三端端到端验收仍待后续完成。Node 路径检查不是防御恶意同权限本地进程的系统级沙箱。

### MCP 配置读取失败保护

- `GET /api/mcp` 遇到不可读 JSON、非对象文档或不可安全表示的服务器容器时返回 422；`PUT` 重新读取原文件，遇到相同问题返回 409，不覆盖原字节。
- 只有文件确实不存在时才按空配置处理；合法保存保留文档兄弟字段和请求中携带的服务器未知字段，成功请求格式保持不变。格式错误的请求体返回 400。
- 错误使用固定文案，不返回可能包含凭据的 JSON 解析片段。Web MCP 面板现有错误分支会显示读取失败，不会把它当作空列表。
- 20 项路由／配置验证测试、TypeScript、定向 lint 和最终独立静态复核通过。此修复不是配置并发版本控制，也不代表已完成 Pi 原生 MCP 迁移；目前仍沿用旧 MCP 格式。

## 本机备份脚本的进度与排错

本地工件 `.reasonix/backup-local-pi.mjs` 用于本次升级前备份，不随产品发布。应在 Mac 系统终端运行（代理的工作区外写入被拒绝），不要同时重复启动：

```sh
/Users/qingtang/.local/node/bin/node "/Volumes/1T 原装/项目研发/pi-web-QT/.reasonix/backup-local-pi.mjs" create
```

- 启动立即在 stderr 输出“开始备份”和输出目录；复制/校验阶段每约 2 秒在处理条目或数据块时更新扫描项数、文件数与 MiB，压缩/解压阶段有定时心跳。单次阻塞的文件系统调用期间不保证更新。
- 输出目录内的 `status.json` 记录阶段、PID、更新时间、计数及失败错误码，不包含配置正文。若进程被强制终止，状态可能停在 `running`，不能仅凭该字段认定进程仍在运行。
- `create` 成功才输出 JSON 回执并生成 `receipt.json`；之后仍需用 `verify <输出目录>` 完成归档解压及文件摘要验证。文件存在或目录达到某个大小不代表备份完成。
- 2026-10-08 排查发现 `pre-upgrade-iMwpRA`、`pre-upgrade-kNVScm` 各约1.1GB，但无manifest/归档/receipt；查询未见备份脚本进程。没有旧日志支持确定中断原因，两份残留保持不动。
- 反馈修复通过4项合成HOME测试（包含真实tar归档/解压、目录链接进度和失败不泄密），不代表用户真实备份已经完成。运行结束只需提供最后的JSON或失败行，不上传备份或原配置。

## 范围与上线条件

执行方向：Pi 1.1.0 原生 MCP；自建 OIDC 网关与 MFA；浏览器、Tauri、Flutter 三端；保留应用认证。先修安全及恢复前置，再升级和接入身份系统，不替换 fork 定制界面。

**尚未完成**：真实配置/会话/队列和发布产物的受保护备份、恢复演练、OIDC 产品及生产主机/域名选定、依赖升级、完整生产构建、三端真机验收和 48 小时稳定性观察。源码 worktree 不是生产数据备份；不能据此批准上线。

治理接手：MCP `project_status` 报 `.lrnev/agents/registry.json` 路径越界；`lrnev --workspace '/Volumes/1T 原装/项目研发/pi-web-QT' status` 成功。当前使用显式 workspace 的 CLI，不修改全局 MCP 配置。
