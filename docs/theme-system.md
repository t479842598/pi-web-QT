# Pi Web 主题系统

## 默认、固定主题与外观模式

显示设置提供“默认”配色，以及从 QT 旧界面恢复的七套固定主题：`gruvbox`、`nord`、`tokyo`（Tokyo Night）、`solarized`、`onedark`（One Dark）、`dracula` 和 `catppuccin`。每套固定主题都提供浅色与深色变量。

外观模式可独立选择“浅色”“深色”或“跟随系统”。主题切换会请求所选主题与当前外观模式对应的变量；边框可见度仍在客户端基于该主题的原始边框色计算。

## Pi JSON 自定义主题

固定主题不会替代 Pi JSON 主题。`GET /api/themes?cwd=<cwd>` 按以下顺序返回可选主题：

1. 七套固定 QT 主题（`builtin: true`）；
2. `~/.pi/agent/themes/` 中发现的 JSON 主题；
3. 传入项目工作目录下 `.pi/themes/` 中发现的 JSON 主题。

`GET /api/themes/<name>?mode=light|dark&cwd=<cwd>` 返回应用该主题所需的 CSS token。固定主题名称优先于同名 JSON 文件；自定义主题继续按照 `-light.json`、`-dark.json` 或单文件回退规则解析。

## CSS token 映射

服务端返回当前 Web 表面使用的 CSS 变量，包括 `--bg`、`--text`、`--accent`、消息/工具背景、Diff/Git 状态色和边框变量。客户端仅将返回的变量写入 `document.documentElement.style`；切回“默认”会清除动态变量，避免上一套主题残留。

## 验证

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
curl -u 'pi:<password>' 'http://127.0.0.1:30141/api/themes'
curl -u 'pi:<password>' 'http://127.0.0.1:30141/api/themes/nord?mode=dark'
```

确认 API 列出七套 `builtin: true` 主题，并在切换后检查 `html[data-theme]` 及 `--bg`、`--accent` 等变量已同步更新。
