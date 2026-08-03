# Pi Web 部署

Pi Web 是运行在 Node.js 中的网页服务。Pi Agent 与会话文件保留在部署主机本地，浏览器通过 HTTPS 访问 Web 界面。

## 1. 安装与构建

```bash
git clone https://github.com/t479842598/pi-web-QT.git /srv/pi-web
cd /srv/pi-web
npm ci
npm run build
```

每次构建都会生成新的静态资源指纹。部署完成后刷新页面即可加载新界面；如果浏览器仍持有旧页面，请关闭该标签页后重新打开。

构建完成后，使用仓库内的 CLI 启动服务：

```bash
PI_WEB_PASSWORD='替换为随机长密码' \
PI_WEB_ALLOWED_HOSTS='piweb.example.com' \
node /srv/pi-web/bin/pi-web.js -H 127.0.0.1 -p 30141 --no-open
```

`PI_WEB_PASSWORD` 会启用 HTTP Basic Auth，用户名为 `pi`。不要把真实密码写进仓库、launchd plist 或部署脚本。

## 2. systemd（Linux）

创建 `/etc/systemd/system/pi-web.service`：

```ini
[Unit]
Description=Pi Web
After=network.target

[Service]
Type=simple
User=piweb
WorkingDirectory=/srv/pi-web
Environment=PI_WEB_PASSWORD=replace-with-a-random-password
Environment=PI_WEB_ALLOWED_HOSTS=piweb.example.com
Environment=PI_WEB_NO_OPEN=1
ExecStart=/usr/bin/node /srv/pi-web/bin/pi-web.js -H 127.0.0.1 -p 30141 --no-open
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pi-web
sudo systemctl status pi-web
```

## 3. Caddy HTTPS 反向代理

Caddyfile：

```caddy
piweb.example.com {
  reverse_proxy 127.0.0.1:30141
}
```

Caddy 负责 TLS 证书和 HTTPS；Pi Web 保持监听在 loopback 地址。外部域名必须同时配置到 `PI_WEB_ALLOWED_HOSTS`。

## 4. Cloudflare Tunnel（可选）

`config.yml`：

```yaml
tunnel: <tunnel-id>
credentials-file: /etc/cloudflared/<tunnel-id>.json

ingress:
  - hostname: piweb.example.com
    service: http://127.0.0.1:30141
  - service: http_status:404
```

仍需设置 `PI_WEB_PASSWORD` 与 `PI_WEB_ALLOWED_HOSTS=piweb.example.com`。Tunnel 只负责 HTTPS 转发，不替代 Pi Web 的访问认证。

## 5. 更新

```bash
cd /srv/pi-web
git pull --ff-only
npm ci
npm run build
sudo systemctl restart pi-web
```

更新前可执行：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```
