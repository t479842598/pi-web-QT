# Pi Web Relay

pi-web 的第二条远程接入通道：本机 pi-web 作为客户端**主动外连**本服务，手机浏览器访问本服务托管的移动页，帧经 WebSocket 双向转发。

与 Cloudflare Tunnel 直连方式并行，互不影响。

## 为什么需要中继

直连方式要求本机可被手机直达（同一局域网，或已建隧道）。中继让本机藏在任意 NAT 后也能被访问：**只做出站连接，不暴露任何入站端口**。

## 快速开始

```bash
npm install
RELAY_PUBLIC_URL=https://relay.example.com npm start
```

默认监听 `127.0.0.1:8787`，由反向代理对外暴露（见 `docs/relay-deployment.md`）。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `RELAY_PORT` | `8787` | 监听端口 |
| `RELAY_HOST` | `127.0.0.1` | 监听地址；公网暴露请交给反向代理 |
| `RELAY_PASSWORD` | 空 | 可选的共享密码；为空时仅配对 token 鉴权 |
| `RELAY_DEVICE_SECRET` | 空 | 桌面端注册设备时必须出示的共享密钥。**公网部署必填**，否则任何人可冒充设备 |
| `RELAY_PUBLIC_URL` | 空 | 对外 HTTPS 地址，用于展示与二维码链接拼接（不是 `/ws` 地址） |

## 协议

服务端不解析聊天内容，只做透明转发。控制帧由中继自己应答；桌面端的配对请求带 `rid`，中继按同一 `rid` 回 `pair_result`，实现请求-响应。

| 方向 | 帧 | 说明 |
|------|-----|------|
| 桌面 → 中继 | `device_register_init` | 注册设备：`device_mid`、`device_secret`、`meta` |
| 中继 → 桌面 | `device_register_ack` | 注册确认 |
| 桌面 → 中继 | `pair_register` | 申请配对 token，返回一次原始值（带 `rid`） |
| 桌面 → 中继 | `pair_revoke` / `pair_list` | 吊销 / 列出配对（带 `rid`） |
| 手机 → 中继 | `client_pair` | 用 token 兑换会话 |
| 双方 | `ping` / `pong` | 心跳（中继直接应答，不转发） |
| 其余 | 任意 | 原样转发给对端 |

配对 token **一次性**：兑换成功即失效，因此二维码截图在首次配对后不再可用。token 的「已使用」与「已吊销」分开记录，桌面端的设备列表能区分二者。

## 测试

```bash
npm test
```

覆盖设备注册、协议版本校验、双向转发、token 单次使用/过期/吊销、双设备不串线，以及未配对客户端无法触达设备。
