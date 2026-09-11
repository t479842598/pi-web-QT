# 中继服务部署（阿里云）

把 `relay-server/` 部署到公网服务器，作为 pi-web 的第二条远程接入通道。

## 一、需要多大内存

实测参考：本机生产 `next-server`（pi-web 本体）RSS ≈ 316MB；中继为纯转发进程，空闲常驻约 60–150MB。

| 部署形态 | 建议规格 | 说明 |
|----------|----------|------|
| 仅中继 | **1 核 1GB** | 轻量应用服务器即可，配 `MemoryMax=512M` |
| 中继 + pi-web 本体 | **1 核 2GB** | 两者同机，留出构建/峰值余量 |

家用规模（1 台桌面 + 1~2 台手机）**1 核 1GB 就够**；不需要容器编排，`systemd` + 反代即可，部署上去就能用。

## 二、部署步骤

```bash
# 1. 上传或拉取 relay-server/（只需该目录）
sudo mkdir -p /opt/pi-web-relay
sudo cp -r relay-server/* /opt/pi-web-relay/
cd /opt/pi-web-relay

# 2. 安装依赖（只需 ws）
sudo npm ci --omit=dev

# 3. 配置环境变量
sudo cp systemd/pi-web-relay.env.example /etc/pi-web-relay.env
sudo $EDITOR /etc/pi-web-relay.env   # 至少设置 RELAY_PUBLIC_URL

# 4. 常驻
sudo useradd -r -s /usr/sbin/nologin piweb || true
sudo chown -R piweb:piweb /opt/pi-web-relay
sudo cp systemd/pi-web-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-web-relay

# 5. 反代 + HTTPS（二选一）
#    Nginx：
sudo cp systemd/nginx.conf.example /etc/nginx/sites-available/pi-web-relay
sudo ln -s /etc/nginx/sites-available/pi-web-relay /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d relay.example.com
#    Caddy：把 systemd/caddy.conf.example 追加进 /etc/caddy/Caddyfile
```

## 三、校验

```bash
curl -s https://relay.example.com/healthz
# {"ok":true,"devices":0,"publicUrl":"https://relay.example.com"}
```

然后在 pi-web 侧：

```bash
# WebSocket 地址（桌面端出站连接用）
export PI_WEB_RELAY_URL=wss://relay.example.com/ws
# 网页地址（生成二维码链接用，必须是 HTTPS origin，不是 /ws）
export PI_WEB_RELAY_PUBLIC_URL=https://relay.example.com
# 与中继 RELAY_DEVICE_SECRET 一致；公开部署时必填，否则任何人可冒充本机设备
export PI_WEB_RELAY_DEVICE_SECRET=<与中继同一串随机值>
```

重启 pi-web 后，设置 → **远程配对** → 生成二维码，手机扫码即可。

> `PI_WEB_RELAY_URL` 与 `PI_WEB_RELAY_PUBLIC_URL` 是两个不同的东西：前者是 WebSocket 端点，后者是手机浏览器打开的网页地址。写错会导致二维码指向一个打不开的 `wss://` 链接。

## 四、排障

| 现象 | 排查 |
|------|------|
| 手机一直转圈 | 反代是否透传 `Upgrade`/`Connection`；是否开了缓冲（`proxy_buffering off` / `flush_interval -1`） |
| 连接几十秒就断 | 反代 `proxy_read_timeout` 是否过短；中继心跳 25s 一次 |
| 扫码提示「配对信息无效」 | `RELAY_PUBLIC_URL` 与反代域名不一致，或二维码已过期 |
| 扫码提示「桌面端已断开」 | pi-web 未启动或 `PI_WEB_RELAY_URL` 未配置/写错 |
| 设备列表显示不出中继地址 | pi-web 侧 `PI_WEB_RELAY_URL` 未设置 |

## 五、安全

- 中继默认**不设密码**（家用），但每个会话都需要一次性配对 token；token 默认 10 分钟有效、用一次即失效。可用 `PI_WEB_PAIR_TTL_MS` 调整。
- 需要额外一道门时设置 `RELAY_PASSWORD`（需与 pi-web 侧一致）。
- 强制 HTTPS；不要把中继明文暴露在公网。
- 中继只监听回环，公网入口统一走反代。
