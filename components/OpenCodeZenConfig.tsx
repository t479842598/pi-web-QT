"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, FloppyDisk, Play, Plus, Trash } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import type { SafeOpenCodeZenAccount, SafeOpenCodeZenConfig } from "@/lib/opencode-zen";

type DraftAccount = SafeOpenCodeZenAccount & { apiKey?: string; apiKeyDraft?: string; passwordDraft?: string };
const blankProxy = () => ({ protocol: "http" as const, enabled: true, url: "", port: 0, username: "", password: "", hasPassword: false });

function maskedKey(account: DraftAccount): string {
  return account.apiKey ? `${account.apiKey.slice(0, 4)}••••${account.apiKey.slice(-4)}` : account.apiKeyMasked;
}

export function OpenCodeZenConfig() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<DraftAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [cooldownMs, setCooldownMs] = useState(60_000);
  const [importText, setImportText] = useState("");
  const [proxyImportText, setProxyImportText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateAccount = (id: string, update: (account: DraftAccount) => DraftAccount) => {
    setAccounts((current) => current.map((account) => account.id === id ? update(account) : account));
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

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/opencode-zen", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: accounts.map((account) => ({ ...account, ...(account.apiKeyDraft ? { apiKey: account.apiKeyDraft } : {}) })), autoSwitch, cooldownMs }),
      });
      const data = await response.json() as SafeOpenCodeZenConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setAccounts(data.accounts.map((account) => ({ ...account, proxy: { ...account.proxy }, apiKeyDraft: "", passwordDraft: "" })));
      setMessage("OpenCode Zen 配置已保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

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
    const maxToUse = Math.min(proxies.length, accounts.length);
    setMessage(`已按账号顺序配置 ${maxToUse} 个代理，正在逐个测试可用性…`);
    const results = await Promise.all(proxies.slice(0, maxToUse).map(async (proxy) => {
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
    setAccounts(nextAccounts);
    setProxyImportText("");
    if (failed.length === 0) {
      setMessage(`代理导入完成：${passed.length} 个代理全部通过检测，已按账号顺序绑定，请点击保存`);
    } else {
      setMessage(`代理导入完成：${passed.length} 个通过并绑定；${failed.length} 个未通过检测、未绑定，请检查下方原因`);
      setError(failed.map((result) => `${result.proxy.protocol}://${result.proxy.url}:${result.proxy.port}：${result.error ?? "不可用"}`).join("\n"));
    }
    if (proxies.length > accounts.length) {
      setMessage((current) => `${current ?? ""}；另有 ${proxies.length - accounts.length} 个多余代理未分配`);
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
      setMessage("账号导入成功：重复的 Key 只更新备注，请配置每个账号的独立代理后保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addAccount = () => setAccounts((current) => [...current, { id: `account-${Date.now()}`, note: "新账号", apiKeyMasked: "••••••••", hasApiKey: false, enabled: true, proxy: blankProxy(), apiKeyDraft: "" }]);
  const removeAccount = (id: string) => setAccounts((current) => current.filter((account) => account.id !== id));

  if (loading) return <div style={{ flex: 1, padding: 20, color: "var(--text-muted)", fontSize: 12 }}>{t("desktop.loading")}</div>;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>OpenCode Zen</div>
        <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11 }}>账号、独立代理和 429 自动切换只在此处配置，不在普通供应商列表中显示。</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={addAccount} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}><Plus size={14} /> 添加账号</button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }}><input type="checkbox" checked={autoSwitch} onChange={(event) => setAutoSwitch(event.target.checked)} />429 自动切换账号+代理</label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }} title="一个账号触发 429 后，在此时间内不会再次被选中（毫秒）">
          429 冷却（毫秒）
          <input type="number" min={0} max={600000} step={5000} value={cooldownMs} onChange={(event) => setCooldownMs(Number(event.target.value) || 0)} style={{ width: 110, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", fontSize: 12 }} />
        </label>
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
        <button type="button" onClick={() => void save()} disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", border: "none", borderRadius: 6, background: "var(--accent)", color: "#fff", cursor: saving ? "wait" : "pointer", fontSize: 12 }}><FloppyDisk size={14} /> 保存</button>
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
