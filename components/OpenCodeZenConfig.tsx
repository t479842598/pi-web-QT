"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Play, Plus, Trash } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import type { SafeOpenCodeZenAccount, SafeOpenCodeZenConfig } from "@/lib/opencode-zen";

type DraftAccount = SafeOpenCodeZenAccount & { apiKey?: string; apiKeyDraft?: string; passwordDraft?: string };
const blankProxy = () => ({ protocol: "http" as const, enabled: true, url: "", port: 0, username: "", password: "", hasPassword: false });
const DEFAULT_EXTERNAL_PORT = 7474;

/**
 * 代理去重：按 协议+主机（小写）+端口 视为同一节点，忽略用户名/密码差异；
 * 保留列表中首次出现的条目，后续重复节点直接丢弃。
 */
export function dedupeProxies<T extends { protocol: string; url: string; port: number }>(proxies: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const proxy of proxies) {
    const key = `${proxy.protocol}://${proxy.url.toLowerCase()}:${proxy.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(proxy);
  }
  return result;
}

function maskedKey(account: DraftAccount): string {
  return account.apiKey ? `${account.apiKey.slice(0, 4)}••••${account.apiKey.slice(-4)}` : account.apiKeyMasked;
}

function generateExternalKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `piweb-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function OpenCodeZenConfig({ onRegisterFlush }: { onRegisterFlush?: (flush: () => Promise<void>) => () => void }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<DraftAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [cooldownMs, setCooldownMs] = useState(60_000);
  const [importText, setImportText] = useState("");
  const [proxyImportText, setProxyImportText] = useState("");
  const [externalEnabled, setExternalEnabled] = useState(false);
  const [externalPort, setExternalPort] = useState(DEFAULT_EXTERNAL_PORT);
  const [freeModelsOnly, setFreeModelsOnly] = useState(true);
  const [externalApiKeyDraft, setExternalApiKeyDraft] = useState("");
  const [externalHasApiKey, setExternalHasApiKey] = useState(false);
  const [externalKeyMasked, setExternalKeyMasked] = useState("••••••••");
  /** Plaintext shown exactly once right after Generate; cleared on save/close. */
  const [externalRevealedKey, setExternalRevealedKey] = useState<string | null>(null);
  const [externalStatus, setExternalStatus] = useState<SafeOpenCodeZenConfig["externalAccess"]["status"]>({ running: false });
  const [testingExternal, setTestingExternal] = useState(false);
  const [externalSaving, setExternalSaving] = useState(false);
  /** 开关操作失败时的 inline 错误（显示在开关后面）。 */
  const [externalToggleError, setExternalToggleError] = useState<string | null>(null);
  /** 外部调用网关地址（127.0.0.1 仅本机；经 cloudflared 等隧道对外暴露）。 */
  const baseUrl = `http://127.0.0.1:${externalPort || DEFAULT_EXTERNAL_PORT}/v1`;
  /**
   * 开关的视觉状态以实际监听状态为准：配置里 enabled=true 只代表“意向”，
   * 服务重启/启动失败时网关可能并未运行，开关必须如实显示（避免“看着开了其实没开”）。
   */
  const externalActuallyOn = externalStatus.running === true;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Auto-save: every editable field change schedules a debounced PUT and the
   * latest draft values are read from this ref at save time (never stale
   * closures). The explicit „保存“ button is gone — edits persist on their
   * own. The 500ms debounce keeps keystrokes from hammering the API.
   */
  const latestRef = useRef({ accounts, autoSwitch, cooldownMs, externalEnabled, externalPort, freeModelsOnly, externalApiKeyDraft });
  latestRef.current = { accounts, autoSwitch, cooldownMs, externalEnabled, externalPort, freeModelsOnly, externalApiKeyDraft };
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const [pendingSave, setPendingSave] = useState(false);

  /** Perform one PUT with the latest draft state. Serialized; re-entrant callers queue behind the in-flight promise. */
  const performAutoSave = useCallback(async (): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setPendingSave(true);
    try {
      const latest = latestRef.current;
      const sentAccounts = latest.accounts;
      const response = await fetch("/api/opencode-zen", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: sentAccounts.map((account) => ({ ...account, ...(account.apiKeyDraft ? { apiKey: account.apiKeyDraft } : {}) })),
          autoSwitch: latest.autoSwitch,
          cooldownMs: latest.cooldownMs,
          externalAccess: { enabled: latest.externalEnabled, port: latest.externalPort, freeModelsOnly: latest.freeModelsOnly, ...(latest.externalApiKeyDraft ? { apiKey: latest.externalApiKeyDraft } : {}) },
        }),
      });
      const data = await response.json() as SafeOpenCodeZenConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setExternalHasApiKey(data.externalAccess.hasApiKey);
      setExternalKeyMasked(data.externalAccess.apiKeyMasked);
      setExternalStatus(data.externalAccess.status);
      // The plaintext hint is one-shot only — after saving it is gone for good.
      setExternalRevealedKey(null);
      // Only echo the persisted accounts back when the user has NOT edited
      // since this request was sent (identity comparison on the array). If
      // they kept typing, keep their local draft — echoing would clobber it.
      if (latestRef.current.accounts === sentAccounts) {
        setAccounts(data.accounts.map((account) => ({ ...account, proxy: { ...account.proxy }, apiKeyDraft: "", passwordDraft: "" })));
        setMessage("已自动保存");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      savingRef.current = false;
      setPendingSave(false);
    }
  }, []);

  /** Schedule a debounced auto-save (500ms). */
  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void performAutoSave();
    }, 500);
  }, [performAutoSave]);

  /** Flush any pending debounced save immediately (used before unmount/close). */
  const flushAutoSave = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await performAutoSave();
    } else if (savingRef.current) {
      // A save is in flight; wait for it so closing never loses the last edit.
      const deadline = Date.now() + 5000;
      while (savingRef.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }, [performAutoSave]);

  // Clean up a pending debounce on unmount (switching tabs / closing modal
  // unmounts this component; the SettingsModal requestClose awaits flush).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/opencode-zen");
      const data = await response.json() as SafeOpenCodeZenConfig;
      if (!response.ok) throw new Error((data as unknown as { error?: string }).error ?? `HTTP ${response.status}`);
      setAccounts(data.accounts.map((account) => ({ ...account, proxy: { ...account.proxy }, apiKeyDraft: "", passwordDraft: "" })));
      setActiveAccountId(data.activeAccountId ?? null);
      setAutoSwitch(data.autoSwitch);
      setCooldownMs(data.cooldownMs);
      setExternalEnabled(data.externalAccess.enabled);
      setExternalPort(data.externalAccess.port);
      setFreeModelsOnly(data.externalAccess.freeModelsOnly);
      setExternalApiKeyDraft("");
      setExternalHasApiKey(data.externalAccess.hasApiKey);
      setExternalKeyMasked(data.externalAccess.apiKeyMasked);
      setExternalStatus(data.externalAccess.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateAccount = (id: string, update: (account: DraftAccount) => DraftAccount) => {
    setAccounts((current) => current.map((account) => account.id === id ? update(account) : account));
    scheduleAutoSave();
  };

  /** 切换当前使用账号：立即保存 activeAccountId，不改动其他配置。 */
  const switchActiveAccount = async (accountId: string) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/opencode-zen", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeAccountId: accountId }),
      });
      const data = await response.json() as SafeOpenCodeZenConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setActiveAccountId(data.activeAccountId ?? accountId);
      const active = (data.accounts ?? []).find((account) => account.id === data.activeAccountId);
      setMessage(`已切换为使用账号「${active?.note ?? accountId}」`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const flushRef = useRef<(() => Promise<void>) | null>(null);
  flushRef.current = flushAutoSave;

  useEffect(() => {
    if (!onRegisterFlush) return undefined;
    const unregister = onRegisterFlush(() => flushRef.current?.() ?? Promise.resolve());
    return unregister;
  }, [onRegisterFlush]);

  const importProxies = async () => {
    const proxies = proxyImportText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      if (!/^(https?|socks5):\/\//i.test(line) && /^[a-z][a-z\d+.-]*:\/\//i.test(line)) {
        throw new Error(`代理格式错误：仅支持 http/https/socks5：${line}`);
      }
      const value = /^(https?|socks5):\/\//i.test(line) ? line : `http://${line}`;
      const url = new URL(value);
      const port = Number(url.port);
      const protocol = url.protocol === "socks5:" ? "socks5" : url.protocol === "https:" ? "https" : "http";
      if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`代理格式错误：${line}`);
      return {
        protocol: protocol as "http" | "https" | "socks5",
        enabled: true,
        url: url.hostname,
        port,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        hasPassword: Boolean(url.password),
      };
    });
    if (proxies.length === 0) return;
    const uniqueProxies = dedupeProxies(proxies);
    const duplicateCount = proxies.length - uniqueProxies.length;
    const maxToUse = Math.min(uniqueProxies.length, accounts.length);
    setMessage(`已按账号顺序配置 ${maxToUse} 个代理${duplicateCount > 0 ? `（跳过 ${duplicateCount} 个重复节点）` : ""}，正在逐个测试可用性…`);
    const results = await Promise.all(uniqueProxies.slice(0, maxToUse).map(async (proxy) => {
      try {
        const response = await fetch("/api/opencode-zen/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proxy }),
        });
        const data = await response.json() as { ok?: boolean; error?: string; status?: number };
        if (!response.ok || data.ok !== true) {
          return { proxy, ok: false, error: data.error ?? (response.ok ? "测试未通过" : `HTTP ${response.status}`) };
        }
        return { proxy, ok: true };
      } catch {
        return { proxy, ok: false, error: "测试请求失败" };
      }
    }));
    const passed = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    // 只有通过可用性检测的代理才会绑定到对应账号；失败的保持原样并给出原因。
    const nextAccounts = accounts.map((account, index) => {
      const result = results[index];
      return result?.ok ? { ...account, proxy: result.proxy, passwordDraft: result.proxy.password } : account;
    });
    // 自动保存：绑定结果立即写入配置，无需再点「保存」。
    setProxyImportText("");
    const saveResponse = await fetch("/api/opencode-zen", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts: nextAccounts.map((account) => ({ ...account, ...(account.apiKeyDraft ? { apiKey: account.apiKeyDraft } : {}) })) }),
    });
    const saveData = await saveResponse.json() as SafeOpenCodeZenConfig & { error?: string };
    if (!saveResponse.ok) throw new Error(saveData.error ?? `HTTP ${saveResponse.status}`);
    setAccounts(saveData.accounts.map((account) => ({ ...account, proxy: { ...account.proxy }, apiKeyDraft: "", passwordDraft: "" })));
    if (failed.length === 0) {
      setMessage(`代理导入完成：${passed.length} 个代理全部通过检测，已按账号顺序绑定并自动保存`);
    } else {
      setMessage(`代理导入完成：${passed.length} 个通过并绑定、已自动保存；${failed.length} 个未通过检测、未绑定，请检查下方原因`);
      setError(failed.map((result) => `${result.proxy.protocol}://${result.proxy.url}:${result.proxy.port}：${result.error ?? "不可用"}`).join("\n"));
    }
    if (uniqueProxies.length > accounts.length) {
      setMessage((current) => `${current ?? ""}；另有 ${uniqueProxies.length - accounts.length} 个多余代理未分配`);
    }
  };

  /** 外部调用启动开关：显示实际监听状态，点击立即保存（含端口/Key 草稿），无需再点保存。 */
  const toggleExternal = async () => {
    setExternalSaving(true);
    setExternalToggleError(null);
    setError(null);
    setMessage(null);
    try {
      // 开关反映的是实际运行状态：未运行→尝试启动，运行中→停止。
      const nextEnabled = !externalStatus.running;
      const response = await fetch("/api/opencode-zen", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccess: { enabled: nextEnabled, port: externalPort, freeModelsOnly, ...(externalApiKeyDraft ? { apiKey: externalApiKeyDraft } : {}) } }),
      });
      const data = await response.json() as SafeOpenCodeZenConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setExternalEnabled(data.externalAccess.enabled);
      setExternalStatus(data.externalAccess.status);
      setExternalHasApiKey(data.externalAccess.hasApiKey);
      setExternalKeyMasked(data.externalAccess.apiKeyMasked);
      setExternalApiKeyDraft("");
      setExternalRevealedKey(null);
      if (!data.externalAccess.enabled) setMessage("外部调用已停止");
    } catch (cause) {
      setExternalToggleError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExternalSaving(false);
    }
  };

  const importKeys = async () => {
    if (!importText.trim()) return;
    setError(null);
    try {
      const response = await fetch("/api/opencode-zen/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: importText }) });
      const data = await response.json() as SafeOpenCodeZenConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setAccounts(data.accounts.map((account) => ({ ...account, proxy: { ...account.proxy }, apiKeyDraft: "", passwordDraft: "" })));
      setActiveAccountId(data.activeAccountId ?? null);
      setImportText("");
      setMessage("账号导入成功并已自动保存：重复的 Key 只更新备注；代理可用下方「批量导入并测试代理」按账号顺序绑定");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addAccount = () => {
    setAccounts((current) => [...current, { id: `account-${Date.now()}`, note: "新账号", apiKeyMasked: "••••••••", hasApiKey: false, enabled: true, proxy: blankProxy(), apiKeyDraft: "" }]);
    scheduleAutoSave();
  };
  const removeAccount = (id: string) => {
    setAccounts((current) => current.filter((account) => account.id !== id));
    scheduleAutoSave();
  };

  const testExternal = async () => {
    setTestingExternal(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/opencode-zen/external/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: externalEnabled, port: externalPort, apiKey: externalApiKeyDraft || undefined }),
      });
      const data = await response.json() as { ok?: boolean; skipped?: boolean; message?: string; status?: number; latencyMs?: number; modelCount?: number; error?: string };
      if (data.skipped) {
        setMessage(data.message ?? "外部调用未启用，无需测试");
        return;
      }
      if (!response.ok || data.ok !== true) throw new Error(data.error ?? (response.ok ? "测试未通过" : `HTTP ${response.status}`));
      setMessage(`外部调用测试通过：模型接口返回 ${data.modelCount ?? "?"} 个模型（${data.latencyMs ?? "?"}ms）`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTestingExternal(false);
    }
  };

  const copyExternalKey = async () => {
    try {
      const response = await fetch("/api/opencode-zen/external/key", { method: "POST" });
      const data = await response.json() as { apiKey?: string; error?: string };
      if (!response.ok || !data.apiKey) throw new Error(data.error ?? `HTTP ${response.status}`);
      await copyText(data.apiKey);
      setMessage("外部调用 API Key 已复制");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (loading) return <div style={{ flex: 1, padding: 20, color: "var(--text-muted)", fontSize: 12 }}>{t("desktop.loading")}</div>;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>OpenCode Zen</div>
        <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11 }}>账号、独立代理和 429 自动切换只在此处配置，不在普通供应商列表中显示。</div>
      </div>
      <section style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>外部调用（OpenAI 兼容 API）</span>
          <button
            type="button"
            role="switch"
            aria-checked={externalActuallyOn}
            aria-label="外部调用开关"
            onClick={() => void toggleExternal()}
            disabled={externalSaving}
            title={externalActuallyOn
              ? "点击关闭（立即生效）"
              : externalEnabled
                ? "已开启但网关未运行，点击重新启动"
                : "点击开启（立即生效，需要已设置 API Key）"}
            style={{
              position: "relative",
              width: 38, height: 20, borderRadius: 10,
              border: "1px solid var(--border)",
              background: externalActuallyOn ? "#22c55e" : "var(--bg)",
              cursor: externalSaving ? "wait" : "pointer",
              transition: "background 0.15s",
              padding: 0,
            }}
          >
            <span style={{
              position: "absolute", top: 2, left: externalActuallyOn ? 18 : 2,
              width: 14, height: 14, borderRadius: 7,
              background: "#fff", opacity: externalActuallyOn ? 1 : 0.7,
              transition: "left 0.15s",
            }} />
          </button>
          {externalSaving
            ? <span style={{ color: "var(--text-dim)", fontSize: 11 }}>保存中…</span>
            : externalToggleError
              ? <span style={{ color: "#ef4444", fontSize: 11 }}>{externalToggleError}</span>
              : externalStatus.running
                ? <span style={{ color: "#22c55e", fontSize: 11 }}>运行中（127.0.0.1:{externalStatus.port ?? externalPort}）</span>
                : externalStatus.error
                  ? <span style={{ color: "#ef4444", fontSize: 11 }}>未运行：{externalStatus.error}</span>
                  : externalEnabled && !externalHasApiKey
                    ? <span style={{ color: "#f59e0b", fontSize: 11 }}>已开启但未设置 API Key，服务未启动</span>
                    : externalEnabled
                      ? <span style={{ color: "#f59e0b", fontSize: 11 }}>已开启但网关未运行，点击开关重新启动</span>
                      : <span style={{ color: "var(--text-dim)", fontSize: 11 }}>已停止</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 12 }}>端口
            <input type="number" min={1} max={65535} value={externalPort || ""} onChange={(event) => { setExternalPort(Number(event.target.value) || 0); scheduleAutoSave(); }} style={{ width: 90, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 12 }} />
          </label>
          <code style={{ padding: "6px 8px", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 5, fontSize: 11 }}>{baseUrl}</code>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 12 }} title="开启时 GET /v1/models 仅返回免费模型（-free 后缀）；关闭后返回全部模型（含付费）">
            <input type="checkbox" checked={freeModelsOnly} onChange={(event) => { setFreeModelsOnly(event.target.checked); scheduleAutoSave(); }} />只显示免费模型
          </label>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>API Key（外部客户端 Bearer 认证）：</span>
          <input type="password" value={externalApiKeyDraft} onChange={(event) => { setExternalApiKeyDraft(event.target.value); setExternalRevealedKey(null); scheduleAutoSave(); }} placeholder={externalHasApiKey ? `${externalKeyMasked}（留空保持不变）` : "设置外部调用 API Key"} style={{ width: 220, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }} />
          <button type="button" onClick={() => {
            const key = generateExternalKey();
            setExternalApiKeyDraft(key);
            setExternalRevealedKey(key);
            setMessage(null);
            scheduleAutoSave();
          }} style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>生成随机 Key</button>
          <button type="button" onClick={() => void copyExternalKey()} disabled={!externalHasApiKey} title="复制已保存的 API Key" style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: externalHasApiKey ? "pointer" : "not-allowed", fontSize: 11 }}><Copy size={12} /> 复制 Key</button>
          <button type="button" onClick={() => void testExternal()} disabled={testingExternal} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: testingExternal ? "wait" : "pointer", fontSize: 11 }}><Play size={12} /> {testingExternal ? "测试中…" : "测试连接"}</button>
        </div>
        {externalRevealedKey && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 6, background: "rgba(34,197,94,0.08)" }}>
            <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>⚠ 明文仅显示这一次，请立即复制（保存后无法再次查看明文）：</span>
            <code style={{ padding: "4px 8px", background: "var(--bg)", borderRadius: 4, fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{externalRevealedKey}</code>
            <button type="button" onClick={async () => { await copyText(externalRevealedKey); setMessage("API Key 已复制"); }} style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}><Copy size={12} /> 复制</button>
          </div>
        )}

        {/* 调用地址与调用方式 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>调用地址与调用方式</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code style={{ padding: "6px 8px", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 5, fontSize: 11 }}>{baseUrl}</code>
            <button type="button" onClick={async () => { await copyText(baseUrl); setMessage("baseURL 已复制"); }} title="复制 baseURL" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}><Copy size={12} /> 复制 baseURL</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>curl 示例：</div>
            <div style={{ padding: "8px 10px", background: "var(--bg)", borderRadius: 5, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-muted)", overflowX: "auto", whiteSpace: "pre" }}>
{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer <你的 Key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"<${freeModelsOnly ? "免费模型，见 GET /v1/models" : "模型，见 GET /v1/models"}>","messages":[{"role":"user","content":"Hello"}]}'`}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>OpenAI 兼容客户端（Cline / Roo Code / Open WebUI 等）配置：baseURL = <code>{baseUrl}</code>，API Key = 上方外部调用 Key，模型列表来自 <code>{baseUrl}/models</code>{freeModelsOnly ? "（仅返回免费模型）" : "（返回全部模型，含付费）"}。</div>
          </div>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: 11 }}>流量复用本账号/代理池；仅监听 127.0.0.1，可通过 cloudflared 等隧道对外暴露（Bearer Key 鉴权，未配置 Key 不启动）。开关显示的是实际运行状态（服务重启后自动恢复启动），点击即生效；所有修改自动保存，无需手动保存。</div>
      </section>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={addAccount} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}><Plus size={14} /> 添加账号</button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }}><input type="checkbox" checked={autoSwitch} onChange={(event) => { setAutoSwitch(event.target.checked); scheduleAutoSave(); }} />429 自动切换账号+代理</label>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }} title="账号返回 429 表示当日免费额度耗尽，冷却至次日 UTC 0 点自动重置">429 限额冷却：至 UTC 0 点自动重置</span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }} title="请求将优先使用此账号；429 自动切换会暂时移开它，冷却结束后回到它">
          当前使用账号
          <select
            value={activeAccountId ?? ""}
            onChange={(event) => { if (event.target.value) void switchActiveAccount(event.target.value); }}
            disabled={saving || accounts.length === 0}
            style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: accounts.length === 0 ? "var(--text-dim)" : "var(--text)", fontSize: 12, maxWidth: 220 }}
          >
            {accounts.length === 0 ? <option value="">暂无账号</option> : activeAccountId === null ? <option value="">自动轮换</option> : null}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.note}（{maskedKey(account)}）</option>
            ))}
          </select>
        </label>
        {pendingSave && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>自动保存中…</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={"每行：账号-apikey\n例如：alice-sk-abc-def"} rows={4} style={{ width: "100%", resize: "vertical", padding: 9, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }} />
        <button type="button" onClick={() => void importKeys()} style={{ alignSelf: "flex-start", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>批量导入账号</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea value={proxyImportText} onChange={(event) => setProxyImportText(event.target.value)} placeholder={"每行一个代理，按账号顺序分配\n例如：http://user:password@proxy.example.com:7890"} rows={3} style={{ width: "100%", resize: "vertical", padding: 9, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }} />
        <button type="button" onClick={() => { void importProxies().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }} style={{ alignSelf: "flex-start", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>批量导入并测试代理</button>
      </div>
      {message && <div style={{ color: "#22c55e", fontSize: 12 }}>{message}</div>}
      {error && <div style={{ color: "#ef4444", fontSize: 12, whiteSpace: "pre-wrap" }}>{error}</div>}
      {accounts.map((account) => (
        <section key={account.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input value={account.note} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, note: event.target.value }))} style={{ flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 12 }} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={account.enabled} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, enabled: event.target.checked }))} />启用</label>
            <button type="button" onClick={() => removeAccount(account.id)} aria-label="删除账号" title="删除账号" style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer" }}><Trash size={15} /></button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "6px 8px", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 5, fontSize: 11 }}>{maskedKey(account)}</code>
            <input type="password" value={account.apiKeyDraft ?? ""} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, apiKeyDraft: event.target.value }))} placeholder={account.hasApiKey ? "替换 Key" : "输入 API Key"} style={{ width: 150, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }} />
            <button type="button" onClick={async () => {
              try {
                const response = await fetch("/api/opencode-zen/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account.id, proxy: account.proxy }) });
                const data = await response.json() as { apiKey?: string; error?: string };
                if (!response.ok || !data.apiKey) throw new Error(data.error ?? `HTTP ${response.status}`);
                await copyText(data.apiKey);
                setMessage(`${account.note} 的 API Key 已复制`);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
              }} disabled={!account.hasApiKey} title="复制 API Key" aria-label="复制 API Key" style={{ border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: account.hasApiKey ? "pointer" : "not-allowed" }}><Copy size={14} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "86px minmax(130px, 1fr) 92px minmax(100px, 1fr) minmax(100px, 1fr)", gap: 6 }}>
            <select value={account.proxy.protocol} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, proxy: { ...current.proxy, protocol: event.target.value as "http" | "https" | "socks5" } }))} style={{ padding: "6px 4px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }}>
              <option value="http">http</option>
              <option value="https">https</option>
              <option value="socks5">socks5</option>
            </select>
            <input value={account.proxy.url} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, proxy: { ...current.proxy, url: event.target.value } }))} placeholder="代理主机" style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }} />
            <input type="number" value={account.proxy.port || ""} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, proxy: { ...current.proxy, port: Number(event.target.value) || 0 } }))} placeholder="端口" style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }} />
            <input value={account.proxy.username} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, proxy: { ...current.proxy, username: event.target.value } }))} placeholder="代理账号" style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }} />
            <input type="password" value={account.passwordDraft ?? ""} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, passwordDraft: event.target.value, proxy: { ...current.proxy, password: event.target.value, hasPassword: Boolean(event.target.value) } }))} placeholder={account.proxy.hasPassword ? "••••••••" : "代理密码"} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", fontSize: 11 }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-dim)", fontSize: 11 }}><label><input type="checkbox" checked={account.proxy.enabled} onChange={(event) => updateAccount(account.id, (current) => ({ ...current, proxy: { ...current.proxy, enabled: event.target.checked } }))} /> 启用此账号独立代理</label><button type="button" onClick={() => void fetch("/api/opencode-zen/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account.id, proxy: { ...account.proxy, password: account.passwordDraft ?? "" } }) }).then(async (response) => { const data = await response.json() as { ok?: boolean; error?: string; status?: number }; setMessage(data.ok ? `${account.note} 代理测试成功` : `${account.note} 代理测试失败：${data.error ?? data.status ?? `HTTP ${response.status}`}`); }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer" }}><Play size={12} /> 测试代理</button></div>
        </section>
      ))}
      {accounts.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>尚未配置 OpenCode Zen 账号。</div>}
    </div>
  );
}
