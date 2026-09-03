/* Pi Web Desktop — 连接管理气泡（内嵌于主窗口，不新建 WebView2 窗口） */
(function () {
  if (window.__piwebManagerRoot) { window.__piwebManagerRoot.show(); return; }
  var invoke = (window.__TAURI__ && window.__TAURI__.core) ? window.__TAURI__.core.invoke : null;
  if (!invoke) return;

  var CSS = `
  #piweb-manager-root{position:fixed;inset:0;z-index:2147483000;
    --pw-fg:var(--text,#1a1a1a);--pw-muted:var(--text-muted,#555);--pw-dim:var(--text-dim,#888);
    --pw-panel:var(--bg-panel,#fff);--pw-card:var(--bg-card,#fff);--pw-inset:var(--bg-secondary,#fafafa);
    --pw-border:var(--border,#e0e0e0);--pw-accent:var(--accent,#0d9488);--pw-accent-h:var(--accent-hover,#0f766e);
    --pw-red:var(--accent-red,#dc2626);--pw-green:var(--accent-green,#16a34a);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:var(--pw-fg)}
  #piweb-manager-root *{box-sizing:border-box}
  .pw-backdrop{position:fixed;inset:0;background:rgba(10,12,18,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:pwFade .16s ease}
  .pw-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,94vw);max-height:min(86vh,760px);
    display:flex;flex-direction:column;background:var(--pw-panel);border:1px solid var(--pw-border);border-radius:16px;
    box-shadow:0 24px 70px rgba(0,0,0,.35),0 2px 10px rgba(0,0,0,.12);overflow:hidden;animation:pwIn .18s cubic-bezier(.2,.8,.2,1)}
  @keyframes pwFade{from{opacity:0}to{opacity:1}}
  @keyframes pwIn{from{opacity:0;transform:translate(-50%,-46%) scale(.97)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
  .pw-head{display:flex;align-items:center;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--pw-border)}
  .pw-logo{width:34px;height:34px;flex:none;border-radius:9px;background:var(--pw-accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
  .pw-head h2{margin:0;font-size:16px;font-weight:650;letter-spacing:.2px}
  .pw-head p{margin:2px 0 0;font-size:12px;color:var(--pw-muted)}
  .pw-close{margin-left:auto;flex:none;width:30px;height:30px;border:none;border-radius:8px;background:transparent;color:var(--pw-muted);font-size:16px;line-height:1;cursor:pointer;transition:.15s}
  .pw-close:hover{background:var(--pw-inset);color:var(--pw-fg)}
  .pw-body{padding:16px 20px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}
  .pw-body::-webkit-scrollbar{width:10px}
  .pw-body::-webkit-scrollbar-thumb{background:var(--pw-border);border-radius:8px;border:3px solid transparent;background-clip:padding-box}
  .pw-card{background:var(--pw-card);border:1px solid var(--pw-border);border-radius:12px;padding:14px 16px}
  .pw-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .pw-card-head h3{margin:0;font-size:13px;font-weight:650;color:var(--pw-fg)}
  .pw-count{margin-left:auto;font-size:11px;color:var(--pw-dim);background:var(--pw-inset);border-radius:20px;padding:2px 9px}
  .pw-badge{font-size:11px;font-weight:600;border-radius:20px;padding:2px 9px}
  .pw-badge.on{color:var(--pw-green);background:color-mix(in srgb,var(--pw-green) 14%,transparent)}
  .pw-badge.off{color:var(--pw-dim);background:var(--pw-inset)}
  .pw-desc{margin:0 0 12px;font-size:12px;color:var(--pw-muted);line-height:1.5;word-break:break-all}
  .pw-field{margin-bottom:10px}
  .pw-field label{display:block;font-size:11.5px;color:var(--pw-muted);margin-bottom:5px;font-weight:500}
  .pw-input{width:100%;background:var(--pw-inset);border:1px solid var(--pw-border);color:var(--pw-fg);border-radius:9px;padding:9px 11px;font-size:13px;outline:none;transition:.15s}
  .pw-input::placeholder{color:var(--pw-dim)}
  .pw-input:focus{border-color:var(--pw-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pw-accent) 22%,transparent);background:var(--pw-card)}
  .pw-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .pw-grid .pw-span{grid-column:1/-1}
  .pw-actions{display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap}
  .pw-btn{cursor:pointer;border:1px solid var(--pw-border);background:var(--pw-card);color:var(--pw-fg);border-radius:9px;padding:8px 15px;font-size:13px;font-weight:550;transition:.15s;white-space:nowrap}
  .pw-btn:hover{background:var(--pw-inset);border-color:var(--border-hover,#cfd3d9)}
  .pw-btn:active{transform:translateY(1px)}
  .pw-btn.primary{background:var(--pw-accent);border-color:var(--pw-accent);color:#fff}
  .pw-btn.primary:hover{background:var(--pw-accent-h);border-color:var(--pw-accent-h)}
  .pw-btn.danger{color:var(--pw-red);border-color:color-mix(in srgb,var(--pw-red) 40%,var(--pw-border))}
  .pw-btn.danger:hover{background:color-mix(in srgb,var(--pw-red) 12%,transparent)}
  .pw-btn.sm{padding:5px 12px;font-size:12px;border-radius:8px}
  .pw-btn:disabled{opacity:.5;cursor:default;transform:none}
  .pw-hint{font-size:12px;color:var(--pw-muted);min-height:16px;flex:1}
  .pw-hint.ok{color:var(--pw-green)}.pw-hint.err{color:var(--pw-red)}
  .pw-list{display:flex;flex-direction:column;gap:8px}
  .pw-row{display:flex;align-items:center;gap:11px;padding:10px 12px;border:1px solid var(--pw-border);border-radius:10px;background:var(--pw-inset);transition:.15s}
  .pw-row:hover{border-color:var(--pw-accent);background:var(--pw-card)}
  .pw-row-ico{width:30px;height:30px;flex:none;border-radius:8px;background:var(--pw-card);border:1px solid var(--pw-border);display:flex;align-items:center;justify-content:center;font-size:14px}
  .pw-row-main{flex:1;min-width:0}
  .pw-row-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
  .pw-tag{font-size:10px;font-weight:600;color:var(--pw-accent);background:color-mix(in srgb,var(--pw-accent) 14%,transparent);border-radius:5px;padding:1px 6px}
  .pw-lock{opacity:.7}
  .pw-row-url{font-size:11.5px;color:var(--pw-dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pw-row-ops{display:flex;gap:6px;flex:none}
  .pw-empty{text-align:center;color:var(--pw-dim);font-size:13px;padding:22px 0}
  `;

  var ROOT = document.createElement("div");
  ROOT.id = "piweb-manager-root";
  var sheet = document.createElement("style");
  sheet.textContent = CSS;
  ROOT.appendChild(sheet);

  var backdrop = document.createElement("div");
  backdrop.className = "pw-backdrop";
  var panel = document.createElement("div");
  panel.className = "pw-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "连接管理");
  ROOT.appendChild(backdrop);
  ROOT.appendChild(panel);
  document.body.appendChild(ROOT);

  function hide() { if (ROOT) ROOT.remove(); window.__piwebManagerRoot = null; }
  ROOT.show = function () { if (ROOT) ROOT.hidden = false; };
  window.__piwebManagerRoot = ROOT;
  backdrop.addEventListener("click", hide);
  document.addEventListener("keydown", onKey);
  function onKey(e) { if (e.key === "Escape") { hide(); document.removeEventListener("keydown", onKey); } }

  var local = null;
  var servers = [];
  var loaded = false;

  async function refresh() {
    try { servers = await invoke("list_servers"); } catch (e) { servers = []; }
    try { local = await invoke("ensure_local_server"); } catch (e) { local = null; }
    loaded = true;
    render();
  }

  function render() {
    panel.innerHTML = "";

    var head = document.createElement("header");
    head.className = "pw-head";
    head.innerHTML =
      '<div class="pw-logo">π</div>' +
      '<div><h2>连接管理</h2><p>管理本机访问密码与已保存的服务器</p></div>' +
      '<button class="pw-close" title="关闭 (Esc)">✕</button>';
    panel.appendChild(head);
    head.querySelector(".pw-close").addEventListener("click", hide);

    var body = document.createElement("div");
    body.className = "pw-body";
    panel.appendChild(body);

    // 远程访问 / 本机密码
    var hasPass = !!(local && local.has_password);
    var passCard = document.createElement("section");
    passCard.className = "pw-card";
    passCard.innerHTML =
      '<div class="pw-card-head"><h3>远程访问</h3>' +
      '<span class="pw-badge ' + (!loaded ? "off\">…" : (hasPass ? "on\">已开启" : "off\">未开启")) + "</span></div>" +
      '<p class="pw-desc">本机服务 ' + (local ? escapeHtml(local.base_url || "") : "") +
      "。设置密码后对局域网开放并启用 Basic Auth（用户名 pi），供手机/其他设备连接。</p>" +
      '<div class="pw-grid">' +
      '<div class="pw-field"><label>访问密码' + (loaded && hasPass ? "（已设置，留空则不修改）" : "") + '</label><input id="pw-pw1" class="pw-input" type="password" placeholder="至少 6 位" autocomplete="new-password"></div>' +
      '<div class="pw-field"><label>确认密码</label><input id="pw-pw2" class="pw-input" type="password" placeholder="再次输入" autocomplete="new-password"></div>' +
      "</div>" +
      '<div class="pw-actions"><button id="pw-save-pass" class="pw-btn primary">' + (hasPass ? "保存新密码" : "保存并开启对外访问") + "</button>" +
      (loaded && hasPass ? '<button id="pw-clear-pass" class="pw-btn danger">关闭对外访问</button>' : "") +
      '<span id="pw-pass-hint" class="pw-hint"></span></div>';
    body.appendChild(passCard);

    // 服务器列表
    var srvCard = document.createElement("section");
    srvCard.className = "pw-card";
    srvCard.innerHTML =
      '<div class="pw-card-head"><h3>已保存的服务器</h3><span class="pw-count">' + (loaded ? servers.length : "…") + "</span></div>" +
      '<div id="pw-srv-list" class="pw-list"></div>';
    body.appendChild(srvCard);

    // 添加服务器
    var addCard = document.createElement("section");
    addCard.className = "pw-card";
    addCard.innerHTML =
      '<div class="pw-card-head"><h3>添加 / 连接服务器</h3></div>' +
      '<div class="pw-grid">' +
      '<div class="pw-field"><label>名称（可选）</label><input id="pw-n" class="pw-input" type="text" placeholder="例如：云端"></div>' +
      '<div class="pw-field"><label>用户名（默认 pi）</label><input id="pw-un" class="pw-input" type="text" value="pi" placeholder="pi"></div>' +
      '<div class="pw-field pw-span"><label>服务器地址</label><input id="pw-u" class="pw-input" type="text" placeholder="http://127.0.0.1:30141 或 https://pi.example.com"></div>' +
      '<div class="pw-field pw-span"><label>密码（输入一次保存，之后免输入）</label><input id="pw-up" class="pw-input" type="password" placeholder="PI_WEB_PASSWORD" autocomplete="new-password"></div>' +
      "</div>" +
      '<div class="pw-actions"><button id="pw-add-srv" class="pw-btn primary">保存并连接</button><span id="pw-add-hint" class="pw-hint"></span></div>';
    body.appendChild(addCard);

    renderList();
    wirePass();
    wireAdd();
  }

  function renderList() {
    var el = document.getElementById("pw-srv-list");
    if (!el) return;
    if (!loaded) { el.innerHTML = '<div class="pw-empty">加载中…</div>'; return; }
    if (!servers.length) { el.innerHTML = '<div class="pw-empty">还没有保存的服务器</div>'; return; }
    el.innerHTML = "";
    servers.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "pw-row";
      row.innerHTML =
        '<div class="pw-row-ico">' + (s.is_local ? "🖥" : "🌐") + "</div>" +
        '<div class="pw-row-main"><div class="pw-row-name">' + escapeHtml(s.name) +
        (s.is_local ? '<span class="pw-tag">本机</span>' : "") +
        (s.has_password ? '<span class="pw-lock" title="已保存密码">🔒</span>' : "") + "</div>" +
        '<div class="pw-row-url">' + escapeHtml(s.base_url) + "</div></div>" +
        '<div class="pw-row-ops"><button class="pw-btn primary sm" data-connect="' + escapeAttr(s.id) + '">连接</button>' +
        '<button class="pw-btn sm" data-remove="' + escapeAttr(s.id) + '">删除</button></div>';
      el.appendChild(row);
    });
    el.querySelectorAll("[data-connect]").forEach(function (b) {
      b.addEventListener("click", function () { connectServer(b.getAttribute("data-connect")); });
    });
    el.querySelectorAll("[data-remove]").forEach(function (b) {
      b.addEventListener("click", function () { removeServer(b.getAttribute("data-remove")); });
    });
  }

  function wirePass() {
    var btn = document.getElementById("pw-save-pass");
    var clear = document.getElementById("pw-clear-pass");
    var hint = document.getElementById("pw-pass-hint");
    if (btn) btn.addEventListener("click", async function () {
      var p1 = document.getElementById("pw-pw1").value;
      var p2 = document.getElementById("pw-pw2").value;
      hint.className = "pw-hint"; hint.textContent = "";
      if (p1.length && p1.length < 6) { hint.className = "pw-hint err"; hint.textContent = "密码至少 6 位"; return; }
      if (p1 !== p2) { hint.className = "pw-hint err"; hint.textContent = "两次输入的密码不一致"; return; }
      btn.disabled = true;
      try {
        var r = await invoke("set_local_password", { password: p1 });
        local = r.server;
        hint.className = "pw-hint ok";
        hint.textContent = "已保存" + (r.warning ? "：" + r.warning : "");
        refresh();
      } catch (e) { hint.className = "pw-hint err"; hint.textContent = String(e).replace(/^Error:\s*/, ""); }
      finally { btn.disabled = false; }
    });
    if (clear) clear.addEventListener("click", async function () {
      hint.className = "pw-hint"; hint.textContent = "";
      clear.disabled = true;
      try {
        var r = await invoke("set_local_password", { password: "" });
        local = r.server;
        hint.className = "pw-hint ok";
        hint.textContent = r.warning ? r.warning : "已关闭对外访问（仅本机）";
        refresh();
      } catch (e) { hint.className = "pw-hint err"; hint.textContent = String(e).replace(/^Error:\s*/, ""); }
      finally { clear.disabled = false; }
    });
  }

  function wireAdd() {
    var btn = document.getElementById("pw-add-srv");
    var hint = document.getElementById("pw-add-hint");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      var name = document.getElementById("pw-n").value.trim();
      var url = document.getElementById("pw-u").value.trim();
      var username = document.getElementById("pw-un").value.trim();
      var pass = document.getElementById("pw-up").value;
      hint.className = "pw-hint"; hint.textContent = "";
      if (!url) { hint.className = "pw-hint err"; hint.textContent = "请填写服务器地址"; return; }
      btn.disabled = true;
      try {
        var srv = await invoke("save_server", { name: name, baseUrl: url, username: username, password: pass });
        hint.className = "pw-hint ok"; hint.textContent = "已保存，正在打开…";
        await refresh();
        await invoke("connect_server", { id: srv.id });
        hide();
      } catch (e) { hint.className = "pw-hint err"; hint.textContent = String(e).replace(/^Error:\s*/, ""); }
      finally { btn.disabled = false; }
    });
  }

  async function connectServer(id) {
    try { await invoke("connect_server", { id: id }); hide(); }
    catch (e) { alert("连接失败: " + e); }
  }
  async function removeServer(id) {
    try { await invoke("remove_server", { id: id }); refresh(); }
    catch (e) { alert("删除失败: " + e); }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  render();
  refresh();
})();
