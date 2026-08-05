# 内置供应商模型覆盖持久化修复设计

## 背景

设置页中的内置供应商模型编辑器（API key / OAuth provider）目前把覆盖写入
`models.json` 的 `providers.<provider>.models[]`，并同时存在内置模型局部保存和
设置页底部全量保存两条写入链路。局部组件卸载时还依赖组件内部状态做异步自动保存。
因此供应商切换、关闭设置或两条保存请求交错时，旧的整份配置可能覆盖刚保存的模型
参数。

## 目标与验收

- 修改 `contextWindow`、`maxTokens`、`reasoning`、`thinkingLevelMap`、`name`
  后，明确保存、切换供应商、关闭设置并重新打开都保留最终值。
- 内置模型覆盖写入 SDK 原生 `modelOverrides`，不冻结内置模型目录，也不替换内置
  模型的其它元数据。
- 兼容已有写在 `models[]` 中的旧覆盖和自定义模型配置，不要求用户手工迁移。
- 局部保存与设置页底部保存不会互相覆盖；多个请求并发时按服务端最新文件合并。
- 隐藏模型功能继续有效，新旧存储格式均可识别。

## 方案

### 1. 服务端作为唯一合并边界

新增内置覆盖的专用 PATCH 操作（沿用 `/api/models-config/builtin` 路由），请求携带
provider id 和按模型分组的字段补丁。服务端在 `models.json` 文件锁内完成：

1. 读取最新 JSON；
2. 合并指定 provider 的 `modelOverrides[modelId]`；
3. 对删除标记移除字段/模型覆盖；
4. 保留其它 provider、其它模型和 provider 级配置；
5. 原子写盘并失效 `/api/models` 缓存；
6. 返回更新后的 provider/config 片段供前端同步。

现有全量 PUT 也通过同一文件锁写入，避免局部 PATCH 与全量 PUT 的读改写竞态。

### 2. 存储兼容与优先级

- 新编辑统一写 `providers[id].modelOverrides[id]`。
- 旧 `providers[id].models[]` 条目原样保留；读取接口将 `modelOverrides` 与旧条目
  合并返回，新的字段优先。
- SDK 的有效模型顺序为内置模型 → 旧 `models[]` → `modelOverrides`，因此新覆盖
  可以安全叠加在历史配置之上。
- UI 管理的 `hidden` 不是 SDK 模型字段，但允许作为 `modelOverrides` 中的扩展元数据
  存储；`resolveVisibleModels` 同时扫描新旧位置。SDK 忽略该字段，Web 自己负责过滤。
- 不在本次修复中删除用户已有的 `models[]`，避免破坏其中可能包含的 `api`、`baseUrl`、
  `compat`、`cost`、`input` 等自定义设置。

### 3. 前端保存协调

`BuiltinModelsDetail` 保留局部 Save，但不再自行 GET 全量配置后 PUT；它调用专用
PATCH，并把服务端返回的 provider 片段交给 `ModelsConfig` 更新本地 config。

`ModelsConfig` 维护：

- 当前 config 的 ref，保证异步回调和 React 状态更新之间不使用旧快照；
- 活跃内置编辑器的 flush 注册表；
- 全局保存前的 flush 阶段。

行为如下：

- 切换供应商前先 await 当前编辑器 flush；成功才切换；失败则保留当前选择并显示错误。
- 底部全局 Save 先 flush 所有已挂载的内置编辑器，再保存其它 provider 配置，并将
  最新局部更新合并进 payload。
- 内置局部保存成功后立即同步父级 config，后续底部 Save 不会把覆盖回滚。
- 设置关闭入口通过 `ModelsConfig` 注册的 flush 回调等待未保存草稿；失败时不关闭并
  显示错误。没有修改时正常关闭。
- 组件卸载不再承担唯一的持久化责任，避免 fire-and-forget 请求和卸载竞态。

### 4. 字段补丁与清除语义

客户端把数字输入规范化为正数或删除标记；空的 thinking map 表示移除该字段。
服务端只修改请求明确列出的字段，未知字段拒绝写入。删除某个模型的最后一个新覆盖
字段时移除其 `modelOverrides[modelId]`，但保留 provider 及历史 `models[]`。

## 文件边界

- `lib/models-config-store.ts`：models.json 读写、proper-lockfile 互斥、原子写和安全
  合并基础设施。
- `app/api/models-config/route.ts`：把全量 PUT 接入共享锁。
- `app/api/models-config/builtin/route.ts`：读取新旧覆盖并提供 PATCH 合并接口。
- `lib/builtin-model-overrides.ts`：字段规范化、补丁构造与新旧覆盖读取合并纯函数。
- `lib/model-scope.ts`：同时识别新旧 `hidden` 标记。
- `components/BuiltinModelsDetail.tsx`：调用 PATCH、局部状态、flush 注册与错误处理。
- `components/ModelsConfig.tsx`：父子状态同步、供应商切换拦截、全局保存 flush。
- `components/SettingsModal.tsx`：关闭前调用 models flush，并处理异步关闭结果。
- 相关 `.test.mjs`：纯函数、文件并发合并、组件保存契约回归。

## 错误处理

- PATCH/PUT 返回非 2xx 时保留草稿和 dirty 状态，界面显示可重试错误。
- 文件锁超时或 JSON 损坏时拒绝写入并返回错误，不用空对象静默覆盖用户配置。
- 服务端始终以最新磁盘内容为合并基准；任何一次请求都不允许用旧客户端快照删除
  未涉及的 provider/model 数据。

## 验证策略

1. 纯函数测试：新旧覆盖合并、字段补丁、删除标记、hidden 兼容。
2. 文件存储测试：并发更新不同 provider/model 时两边都保留，写盘原子且权限不变。
3. 组件契约测试：局部保存使用 PATCH、全局保存前 flush、切换/关闭等待 flush。
4. 命令验证：`npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`。
5. 手动回归：修改两个不同内置供应商的上下文和最大输出，分别切换、关闭重开，并
   检查实际 `models.json` 与 `/api/models` 返回值。

## 不做的事情

- 不修改 pi SDK 或 AgentSession 协议。
- 不将所有自定义供应商编辑器重写成新的表单框架。
- 不删除旧 `models[]` 配置，不对用户配置做未经请求的全量迁移。
