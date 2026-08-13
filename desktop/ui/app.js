/* Pi Web Desktop — 连接页逻辑（Tauri IPC） */
const invoke = window.__TAURI__.core.invoke;

const $ = (id) => document.getElementById(id);

let servers = [];

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

async function connect(id) {
  try {
    await invoke("connect_server", { id });
  } catch (e) {
    toast("连接失败: " + e, "err");
  }
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
  try {
    const r = await invoke("probe_local");
    if (r.local_alive) {
      setLocalBadge("online", "服务在线");
      $("local-desc").textContent = "检测到本机 Pi Web 服务，可直接连接。";
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
  const btn = $("btn-start-local");
  btn.disabled = true;
  btn.textContent = "正在启动并等待就绪…";
  try {
    const ok = await invoke("start_local");
    if (ok) {
      toast("本机 Pi Web 已启动并连接", "ok");
      refresh();
      probe();
    } else {
      toast("启动失败：未检测到 pi-web 或服务未就绪", "err");
      probe();
    }
  } catch (e) {
    toast("启动失败: " + e, "err");
    probe();
  } finally {
    btn.textContent = "启动本机 Pi Web";
  }
}

/* ---------- 表单 ---------- */
$("form-server").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("form-hint").textContent = "";
  const name = $("inp-name").value.trim();
  const url = $("inp-url").value.trim();
  const pass = $("inp-pass").value;
  if (!url) {
    $("form-hint").textContent = "请填写服务器地址";
    return;
  }
  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "连接中…";
  try {
    const srv = await invoke("save_server", { name, baseUrl: url, password: pass });
    $("inp-name").value = "";
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

$("chk-auto").addEventListener("change", async (e) => {
  try {
    await invoke("set_local_auto_start", { enabled: e.target.checked });
  } catch (_) {}
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

/* 载入自动拉起偏好 */
(async () => {
  await refresh();
  probe();
})();
