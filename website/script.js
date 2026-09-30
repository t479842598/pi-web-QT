const REL = "https://github.com/t479842598/pi-web-QT/releases/download/v0.18.11";
const downloads = [
  ["macOS", "Apple 芯片", `${REL}/Pi.Web_0.18.11_aarch64.dmg`, "DMG"],
  ["macOS", "Intel", `${REL}/Pi.Web_0.18.11_x64.dmg`, "DMG"],
  ["Windows", "安装包", `${REL}/Pi.Web_0.18.11_x64-setup.exe`, "EXE"],
  ["Windows", "MSI", `${REL}/Pi.Web_0.18.11_x64_en-US.msi`, "MSI"],
  ["Android", "APK", `${REL}/pi-web-qt-0.18.11.apk`, "APK"],
  ["Android", "AAB", `${REL}/pi-web-qt-0.18.11.aab`, "AAB"],
  ["iOS", "未签名 IPA", `${REL}/pi-web-qt-0.18.11.ipa`, "IPA"],
  ["Web", "npx @qt4798/pi-web", "https://www.npmjs.com/package/@qt4798/pi-web", "npm"],
];

const dl = document.querySelector("#dl");
for (const [os, name, href, kind] of downloads) {
  const a = document.createElement("a");
  a.className = "dl";
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.innerHTML = `<small>${os}</small><b>${name}</b><span>${kind}</span>`;
  dl.appendChild(a);
}

const shots = {
  desktop: {
    cap: "桌面客户端 · 会话、文件和流式对话",
    html: document.querySelector(".stage .bezel").outerHTML,
  },
  web: {
    cap: "网页端 · 浏览器打开本机 127.0.0.1:30141",
    html: document.querySelector('[data-shot="web"] .bezel').outerHTML,
  },
  phone: {
    cap: "移动端 · Android / iOS",
    html: document.querySelector(".phone").outerHTML,
  },
};

const box = document.querySelector("#lightbox");
const frame = document.querySelector("#lb");
const cap = document.querySelector("#lb-cap");

document.querySelectorAll("[data-shot]").forEach((el) => {
  el.addEventListener("click", () => {
    const shot = shots[el.dataset.shot];
    frame.innerHTML = shot.html;
    cap.textContent = shot.cap;
    box.showModal();
  });
});

box.addEventListener("click", (e) => {
  if (e.target === box) box.close();
});

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("on"));
    document.querySelectorAll(".code").forEach((p) => p.classList.remove("on"));
    btn.classList.add("on");
    document.querySelector(`[data-pane="${btn.dataset.tab}"]`).classList.add("on");
  });
});

document.querySelectorAll(".copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.parentElement.querySelector("pre").innerText;
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "已复制";
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
});

const nav = document.querySelector(".nav");
addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", scrollY > 8);
}, { passive: true });
