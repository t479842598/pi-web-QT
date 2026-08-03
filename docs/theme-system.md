# Pi TUI 主题系统

## 默认与切换

Pi Web 的首次加载回退与默认偏好使用 Pi TUI 官方内置主题：浅色为 `pi:light`，深色为 `pi:dark`。显示设置可以分别选择浅色主题、深色主题，或设为“跟随系统”；切换外观时会恢复对应亮/暗偏好的主题。

旧版 Web 配色（Gruvbox、Nord、Tokyo、Solarized、One Dark、Dracula、Catppuccin）保留在“Web 兼容配色”中，保存过的旧偏好会自动迁移为 `legacy:<name>`，不丢失用户设置。

## 主题来源

`GET /api/themes?cwd=<cwd>` 返回当前可用 Pi TUI 主题的安全描述信息；`GET /api/themes/<id>?cwd=<cwd>` 返回 CSS token 映射。发现顺序和来源如下：

1. Pi TUI 内置 `light`、`dark`；
2. 用户目录 `~/.pi/agent/themes/`；
3. 当前项目及扩展通过 Pi `DefaultResourceLoader` 加载到的主题。

主题 ID 始终为 `pi:<theme-name>`。项目路径会先经过既有文件访问白名单校验；接口不会返回主题文件原文或其他用户目录内容。

## 映射与维护

服务端解析 Pi Theme JSON 的 `vars`、`colors`、`export` 字段，支持变量引用和 ANSI 256 色值，并映射为当前 Web 表面使用的 CSS 变量，例如 `--bg`、`--text`、`--accent`、消息/工具/Markdown/Syntax/Diff/Git 状态 token。

客户端只将映射结果写入 `document.documentElement.style`；切到内置回退或旧版兼容配色时会先清理动态 token，避免上一个主题残留。主题发现结果有 3 秒内存缓存，以减少设置弹窗重复打开时的资源扫描。

## 兼容接口

`/api/theme-sets` 继续保留给旧调用方，但内容已改为从真实 Pi 主题描述派生。新界面和新调用方应使用 `/api/themes`。

## 验证

主题改动后至少验证：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
node --experimental-strip-types --test app/api/theme-sets/theme-sets.test.mjs
curl -sS 'http://127.0.0.1:30141/api/themes/pi%3Alight'
curl -sS 'http://127.0.0.1:30141/api/themes/pi%3Adark'
```

当使用自定义项目主题时，调用 API 时传入已允许访问的 `cwd`，并确认主题在对应的浅色或深色列表中出现、切换后 `html[data-pi-theme]` 和动态 CSS 变量同步更新。
