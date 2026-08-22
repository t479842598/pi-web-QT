/* Pi Web Desktop — 连接页逻辑（Tauri IPC） */
const invoke = window.__TAURI__.core.invoke;

const $ = (id) => document.getElementById(id);

let servers = [];
let localServer = null; // 本机默认服务器信息（首次启动密码引导用）

function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = "toast"), 2600);
}

async function refresh() {
  try {
    servers = await invoke("list_servers");
    renderList();
  } catch (e) {
    toast("读取服务器失败: " + e, "err");
  }
}

function renderList() {
  const ul = $("server-list");
  ul.innerHTML = "";
  $("list-count").textContent = servers.length ? `${servers.length} 台` : "";
  $("list-empty").style.display = servers.length ? "none" : "block";
  for (const s of servers) {
    const li = document.createElement("li");
    li.className = "server-item";
    const lock = s.has_password ? "🔒" : "";
    li.innerHTML = `
      <div class="srv-ico">${s.is_local ? "🖥" : "🌐"}</div>
      <div class="srv-info">
        <div class="srv-name">${escapeHtml(s.name)} ${s.is_local ? '<span class="srv-tag">本机</span>' : ""} ${lock}</div>
        <div class="srv-url">${escapeHtml(s.base_url)}</div>
        <div class="srv-user">用户名：${escapeHtml(s.username || "pi")}</div>
      </div>
      <div class="srv-actions">
        <button class="ghost mini act-open" data-id="${s.id}">连接</button>
        <button class="ghost mini danger act-del" data-id="${s.id}">删除</button>
      </div>`;
    li.querySelector(".act-open").addEventListener("click", () => connect(s.id));
    li.querySelector(".act-del").addEventListener("click", () => remove(s.id));
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------- 首次启动 · 设置本机密码 ---------- */
function updateSetupUI() {
  const hasPass = localServer && localServer.has_password;
  $("setup-card").hidden = hasPass;
  $("btn-change-local-pass").hidden = !hasPass;
  $("setup-title").textContent = hasPass ? "修改本机密码" : "首次启动 · 设置本机密码";
  $("btn-setup").textContent = hasPass ? "保存并连接本机" : "设置并启动本机";
  $("btn-setup-clear").hidden = !hasPass;
  $("inp-setup-pass").value = "";
  $("inp-setup-pass2").value = "";
  $("setup-hint").textContent = "";
  $("inp-local-domain").value = (localServer && localServer.trusted_domain) || "";
  $("domain-hint").textContent = "";
}

async function initSetup() {
  try {
    localServer = await invoke("ensure_local_server");
    updateSetupUI();
  } catch (e) {
    toast("初始化失败: " + e, "err");
  }
}

async function connect(id) {
  const srv = servers.find((s) => s.id === id);
  if (!srv) return;
  // 本地条目：点击「连接」需先拉起内置后端再连接（startLocal 内部处理
  // 无密码引导 → 拉起 → 等待就绪 → 连接，避免后端未起时直接开窗命中 502）
  if (srv.is_local) {
    await startLocal();
    return;
  }
  // 未保存密码：不自动注入，引导用户到表单自己输入密码
  if (!srv.has_password) {
    openFormFor(srv);
    return;
  }
  try {
    await invoke("connect_server", { id });
  } catch (e) {
    toast("连接失败: " + e, "err");
  }
}

/* 把服务器信息填进表单（连接前需要用户输入/确认密码时调用） */
function openFormFor(srv) {
  $("inp-name").value = srv.name || "";
  $("inp-url").value = srv.base_url || "";
  $("inp-user").value = srv.username || "pi";
  $("inp-pass").value = "";
  $("form-hint").textContent = srv.has_password
    ? "已保存密码，可直接连接；如需更换请重新输入。"
    : "该服务器尚未保存密码，请输入账号密码后连接。";
  $("inp-user").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  // 记录待连接 id：表单提交时若 URL 未改动则走更新而非新增
  $("form-server").dataset.pendingId = srv.id;
}

async function remove(id) {
  try {
    await invoke("remove_server", { id });
    toast("已删除", "ok");
    refresh();
  } catch (e) {
    toast("删除失败: " + e, "err");
  }
}

/* ---------- 本机状态 ---------- */
function setLocalBadge(state, text) {
  const b = $("local-badge");
  b.className = "badge " + state;
  b.textContent = text;
}

async function probe() {
  setLocalBadge("probing", "检测中…");
  $("local-desc").textContent = "正在探测本机 Pi Web 服务…";
  $("btn-start-local").disabled = true;
  $("btn-stop-local").disabled = true;
  try {
    const r = await invoke("probe_local");
    if (r.local_alive) {
      $("btn-stop-local").disabled = false;
      if (r.unauthenticated_local) {
        setLocalBadge("warn", "未认证");
        $("local-desc").textContent =
          "检测到本机 Pi Web 服务，但未启用密码认证（对局域网开放）。建议设置本机访问密码以保护数据。";
      } else {
        setLocalBadge("online", "服务在线");
        $("local-desc").textContent = "检测到本机 Pi Web 服务，可直接连接。";
      }
      $("btn-start-local").disabled = true;
    } else if (r.cli_found) {
      setLocalBadge("offline", "未运行");
      $("local-desc").textContent = "本机装有 pi-web 但未运行，可一键启动后自动连接。";
      $("btn-start-local").disabled = false;
    } else {
      setLocalBadge("offline", "未检测到");
      $("local-desc").textContent = "未检测到本机服务与 pi-web CLI，请填写远程服务器地址，或先安装 pi-web。";
      $("btn-start-local").disabled = true;
    }
  } catch (e) {
    setLocalBadge("offline", "检测失败");
    $("local-desc").textContent = "探测失败: " + e;
  }
}

async function startLocal() {
  // 先设密码再拉起：无密码时引导设置，避免 0.0.0.0:30141 无认证暴露
  if (localServer && !localServer.has_password) {
    $("setup-card").hidden = false;
    $("setup-card").scrollIntoView({ behavior: "smooth" });
    $("inp-setup-pass").focus();
    toast("请先设置本机访问密码", "err");
    return;
  }
  const btn = $("btn-start-local");
  btn.disabled = true;
  btn.textContent = "正在启动本机 Pi Web…";
  try {
    const ok = await invoke("start_local");
    if (!ok) {
      toast("启动失败：未检测到 pi-web CLI", "err");
      probe();
      return;
    }
    // 轮询探测直到服务就绪（最多 30s），不阻塞任何线程
    toast("已拉起 pi-web，等待就绪…", "ok");
    const deadline = Date.now() + 30000;
    let r = null;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 800));
      try {
        r = await invoke("probe_local");
      } catch (_) {}
      if (r && r.local_alive) break;
    }
    if (!r || !r.local_alive) {
      toast("等待超时：本机服务未就绪，请查看终端日志", "err");
      probe();
      return;
    }
    toast("本机 Pi Web 已就绪", "ok");
    // 获取/创建本机条目：有密码直接连接；无密码填表单让用户输入
    const local = await invoke("ensure_local_server");
    if (local.has_password) {
      await invoke("connect_server", { id: local.id });
    } else {
      openFormFor(local);
      $("form-hint").textContent =
        "本机服务已就绪，请输入本机 Pi Web 账号密码后连接（输入一次即保存，下次免输入）。";
    }
    refresh();
    probe();
  } catch (e) {
    toast("启动失败: " + e, "err");
    probe();
  } finally {
    btn.disabled = false;
    btn.textContent = "启动本机 Pi Web";
  }
}

/* ---------- 表单 ---------- */
$("form-server").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("form-hint").textContent = "";
  const name = $("inp-name").value.trim();
  const url = $("inp-url").value.trim();
  const username = $("inp-user").value.trim();
  const pass = $("inp-pass").value;
  if (!url) {
    $("form-hint").textContent = "请填写服务器地址";
    return;
  }
  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "连接中…";
  try {
    const srv = await invoke("save_server", {
      name,
      baseUrl: url,
      username,
      password: pass,
      id: $("form-server").dataset.pendingId || null,
    });
    delete $("form-server").dataset.pendingId;
    $("inp-name").value = "";
    $("inp-user").value = "pi";
    $("inp-pass").value = "";
    toast("已保存，正在打开…", "ok");
    refresh();
    await invoke("connect_server", { id: srv.id });
  } catch (err) {
    $("form-hint").textContent = String(err).replace(/^Error:\s*/, "");
  } finally {
    submit.disabled = false;
    submit.textContent = "连接";
  }
});

/* ---------- 首次启动密码引导 ---------- */
$("btn-setup").addEventListener("click", async () => {
  const p1 = $("inp-setup-pass").value;
  const p2 = $("inp-setup-pass2").value;
  $("setup-hint").textContent = "";
  if (p1.length < 6) {
    $("setup-hint").textContent = "密码至少 6 位";
    return;
  }
  if (p1 !== p2) {
    $("setup-hint").textContent = "两次输入的密码不一致";
    return;
  }
  const btn = $("btn-setup");
  btn.disabled = true;
  try {
    const r = await invoke("set_local_password", { password: p1 });
    localServer = r.server;
    updateSetupUI();
    refresh();
    if (r.warning) {
      // 服务由外部启动：密码已保存但需手动重启，不自动连接（旧进程仍用旧密码，会 401）
      toast(r.warning, "err");
      probe();
    } else {
      toast("本机密码已保存，正在启动本机服务…", "ok");
      await startLocal();
    }
  } catch (e) {
    $("setup-hint").textContent = String(e).replace(/^Error:\s*/, "");
  } finally {
    btn.disabled = false;
  }
});

$("btn-setup-clear").addEventListener("click", async () => {
  $("setup-hint").textContent = "";
  try {
    const r = await invoke("set_local_password", { password: "" });
    localServer = r.server;
    toast(r.warning ? r.warning : "已清除本机密码", r.warning ? "err" : "ok");
    updateSetupUI();
    refresh();
  } catch (e) {
    $("setup-hint").textContent = String(e).replace(/^Error:\s*/, "");
  }
});

async function stopLocal() {
  const btn = $("btn-stop-local");
  btn.disabled = true;
  try {
    const closed = await invoke("stop_local");
    toast(closed ? "本机 Pi Web 服务已关闭" : "本机服务未在运行", closed ? "ok" : "warn");
  } catch (e) {
    toast("关闭失败: " + e, "err");
  }
  probe();
}

$("btn-stop-local").addEventListener("click", stopLocal);

$("btn-change-local-pass").addEventListener("click", () => {
  $("setup-card").hidden = false;
  $("setup-card").scrollIntoView({ behavior: "smooth" });
  $("inp-setup-pass").focus();
});

/* 可信域名：保存后作为 PI_WEB_ALLOWED_HOSTS 注入内置后端，隧道外域访问可过 Host 校验 */
$("btn-save-domain").addEventListener("click", async () => {
  const domain = $("inp-local-domain").value.trim();
  $("domain-hint").textContent = "";
  const btn = $("btn-save-domain");
  btn.disabled = true;
  try {
    localServer = await invoke("set_local_domain", { domain });
    $("inp-local-domain").value = localServer.trusted_domain || "";
    toast("已保存；若本机服务正在运行将自动重启生效", "ok");
    refresh();
  } catch (e) {
    $("domain-hint").textContent = String(e).replace(/^Error:\s*/, "");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 杂项 ---------- */
$("btn-start-local").addEventListener("click", startLocal);

/* 获取本机链接：探测本机运行的 Pi Web，把地址填入 URL 输入框 */
$("btn-get-local").addEventListener("click", async () => {
  try {
    const r = await invoke("probe_local");
    if (r.alive_url) {
      $("inp-url").value = r.alive_url;
      toast("已填入本机服务地址，点击「连接」即可", "ok");
    } else {
      toast("未检测到本机服务，可手动填写或点「启动本机 Pi Web」", "err");
    }
  } catch (e) {
    toast("检测失败: " + e, "err");
  }
});

$("btn-quit").addEventListener("click", () => invoke("quit_app"));

$("btn-update").addEventListener("click", async () => {
  try {
    const r = await invoke("plugin:updater|check");
    if (r && r.status === "UpdateAvailable") {
      toast("发现新版本，正在下载安装…", "ok");
    } else if (r && r.status === "Updated") {
      toast("已是最新版本", "ok");
    } else {
      toast("更新检查完成", "ok");
    }
  } catch (e) {
    toast("更新检查暂不可用（发布后生效）", "err");
  }
});

/* 载入：首次启动密码引导 + 服务器列表 + 本机状态 */
(async () => {
  await initSetup();
  await refresh();
  probe();
})();
