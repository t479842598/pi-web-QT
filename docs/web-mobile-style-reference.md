# 网页移动端样式参考基线（ZCode 远程端）

本文件记录从 ZCode 客户端 `app.asar` 内嵌的远程 Web UI 产物中提取的设计系统，作为 pi-web 网页端移动形态的对齐基线。

**只取结构**：字号梯度、圆角梯度、页面边距、布局骨架、容器查询断点。
**不取配色**：pi-web 保留自有 7 套主题与 teal 强调色（见 `docs/theme-system.md`）。

## 尺寸 token

| Token | 值 | 说明 |
|-------|-----|------|
| `--size-base` | `14px` | 基准字号；对齐 ZCode 的 `--ui-font-size` |
| `--text-ui-xs` | `base - 4px` | |
| `--text-ui-sm` | `base - 2px` | |
| `--text-ui-base` | `base` | 正文 |
| `--text-ui-caption` | `base - 1px` | 次要说明 |
| `--text-ui-lg` | `base + 2px` | |
| `--text-ui-xl` | `base + 4px` | 标题 |
| `--radius-xs` | `0.125rem` | |
| `--radius-sm` | `0.25rem` | 控件主用 |
| `--radius-md` | `0.375rem` | |
| `--radius-lg` | `0.5rem` | 卡片/面板 |
| `--radius-xl` | `0.75rem` | 弹层 |
| `--page-margin-mobile` | `20px` | ZCode `mobilePageMargin` |
| `--page-margin-desktop` | `32px` | ZCode `desktopPageMargin` |

字号全部由 `--size-base` 派生，因此调整整体密度只需改一个值；圆角与边距是结构量，**不随主题变化**。

## 布局骨架

| 项 | ZCode 远程端 | pi-web |
|----|--------------|--------|
| 根容器 | `height:100dvh; overflow:hidden` | 同（已具备） |
| 移动壳 | `flex h-dvh flex-col` | 同 |
| 侧栏 | 滑入浮层 `w-[min(88vw,28rem)]` + `translate-x-full` + 半透明 backdrop-blur | `width:min(88vw,28rem)` 抽屉 + 遮罩 |
| 页面边距 | 移动 20 / 桌面 32 | 走 `--page-margin-*` |
| 移动输入框字号 | `--text-mobile-input-safe:16px` | `max(16px, …)` 防 iOS 聚焦缩放（等价手段） |

## 容器查询（最值得借鉴的一点）

ZCode 的 composer 用**容器查询**而非视口查询决定折叠：

```
@container composer (width >= 24rem)   /* 480px */
@container composer (width >= 32rem)   /* 512px */
@container composer (width >= 36rem)   /* 576px */
@container composer (width >= 42rem)   /* 672px */
@container composer not (width >= 480px)
```

视口查询无法感知「侧栏展开后聊天列变窄」，所以桌面宽度下输入栏可能已经挤到很窄却仍按桌面规则渲染。pi-web 的 composer 适配应迁到容器查询，视口查询只保留给页面级布局（侧栏、边距）。

## 错误态用语（中继链路）

ZCode 区分以下状态，pi-web 中继沿用同名语义：

| 状态 | 含义 |
|------|------|
| `sessionExpired` | 凭证过期 |
| `sessionConflict` | 会话冲突 |
| `kicked` | 被吊销/被顶下线 |
| `desktopDisconnected` | 本机桌面端断开 |
