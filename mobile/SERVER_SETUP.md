# Pi Mobile 域名与 HTTPS 配置

当前 Flutter 客户端可以直接连接现有的 `http://IP:6004`，不需要修改 Pi Web。要通过公网域名安全访问，请在服务器前增加 HTTPS 反向代理。

> 设置 `PI_WEB_PASSWORD` 时，Pi Web 使用 HTTP Basic Auth。明文 HTTP 会暴露账号密码，公网访问必须使用 HTTPS 或可信 VPN。未设置或留空时会禁用认证，只建议用于本机或可信内网。

## 1. 配置 DNS

在域名服务商添加 A 记录，例如：

```text
pi.example.com -> 服务器公网 IP
```

如果只在局域网使用，可以在内网 DNS 中把域名解析到服务器的局域网 IP。

## 2. 允许域名 Host

启动 Pi Web 的环境变量中增加域名（多个域名用逗号分隔）：

```bash
PI_WEB_ALLOWED_HOSTS=pi.example.com
```

保留原来的 `PI_WEB_PASSWORD`。Pi Web 用户名固定为 `pi`。

修改环境变量后，需要重启 Pi Web 进程。反向代理不需要修改 Pi Web 源代码。

## 3. Nginx 反向代理

安装 Nginx 后创建 `/etc/nginx/conf.d/pi-web.conf`：

```nginx
server {
    listen 80;
    server_name pi.example.com;

    location / {
        proxy_pass http://127.0.0.1:6004;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Pi 的事件流（SSE）需要关闭缓冲并保持长连接。
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

检查并重载：

```bash
nginx -t
systemctl reload nginx
```

## 4. 申请 HTTPS 证书

以 Certbot 为例：

```bash
certbot --nginx -d pi.example.com
```

成功后，用下面的命令确认 API、鉴权和 SSE 反代正常：

```bash
curl -u 'pi:你的密码' https://pi.example.com/api/sessions
curl -N -u 'pi:你的密码' https://pi.example.com/api/agent/某个会话ID/events
```

第二条命令看到 `connected` 后可以按 `Ctrl+C` 退出。

## 5. App 登录

Pi Mobile 登录页填写：

```text
服务器地址：https://pi.example.com
账号：pi
密码：PI_WEB_PASSWORD 对应的密码
```

不要在地址末尾填写 `/api`。

## 生产运行示例

正式使用时建议通过进程管理器持续运行 Pi Web：

```bash
PI_WEB_ALLOWED_HOSTS=pi.example.com \
PI_WEB_PASSWORD='你的强密码' \
npx @agegr/pi-web@latest -p 6004 -H 0.0.0.0 --no-open
```

建议把环境变量和启动命令放入 systemd 或其他进程管理器中，避免把密码写进 Git 仓库。
