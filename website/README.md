# Pi Web 官网

静态页，无构建步骤。

```bash
cd website
python3 -m http.server 8000
```

打开 http://127.0.0.1:8000

部署：推 `main` 且改动落在 `website/` 时，`.github/workflows/deploy-website.yml` 发布到 `gh-pages`。仓库 Settings → Pages 选 `gh-pages` / root 后，地址是 https://t479842598.github.io/pi-web-QT/

页面里的客户端是界面示意，不嵌入真实会话截图。下载链接指向当前正式版 `v0.18.11`。
