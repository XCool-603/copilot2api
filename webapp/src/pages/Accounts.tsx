import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { FlaskConical, Sparkles, Copy, ExternalLink, Check, RefreshCw, XCircle } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { Modal } from "../components";

type Account = {
  id: string;
  email: string;
  displayName?: string;
  status: string;
  scheduleEnabled: boolean;
  webSearchEnabled: boolean;
  systemPrompt?: string;
  callCount?: number;
  cooldownUntil?: string;
  updatedAt?: string;
  boundProxy?: string;
};

type Push = (m: string, k?: "success" | "error" | "info") => void;

export function AccountsPage({ push }: { push: Push }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "cooldown" | "offline">("all");
  const [loading, setLoading] = useState(true);

  // Auth Modes: device (recommended) vs pkce (legacy)
  const [authMode, setAuthMode] = useState<"device" | "pkce">("device");
  const [callback, setCallback] = useState("");
  const [authState, setAuthState] = useState("");
  const [authMsg, setAuthMsg] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const popupRef = useRef<Window | null>(null);

  // Device Code state
  const [deviceData, setDeviceData] = useState<{
    user_code: string;
    device_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  } | null>(null);
  const [devicePolling, setDevicePolling] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const pollTimerRef = useRef<any>(null);

  const [testOpen, setTestOpen] = useState(false);
  const [testModels, setTestModels] = useState<string[]>([]);
  const [testModel, setTestModel] = useState("");
  const [testPrompt, setTestPrompt] = useState('Say "OK" in one word.');
  const [testResult, setTestResult] = useState<{ status: "idle" | "busy" | "ok" | "fail"; latencyMs?: number; reply?: string; error?: string }>({ status: "idle" });

  const openTest = async () => {
    setTestResult({ status: "idle" });
    setTestOpen(true);
    if (testModels.length === 0) {
      try {
        const d = await api("/api/admin/models");
        const ids = (d.data ?? []).map((m: any) => m.id);
        setTestModels(ids);
        setTestModel((prev) => prev || ids[0] || "");
      } catch {}
    }
  };

  const runTest = async () => {
    if (!testModel) return;
    setTestResult({ status: "busy" });
    const started = performance.now();
    try {
      const d = await api("/api/admin/models/test", { method: "POST", body: JSON.stringify({ model: testModel, prompt: testPrompt }) });
      setTestResult({ status: "ok", latencyMs: d.latency_ms ?? Math.round(performance.now() - started), reply: d.reply ?? "" });
    } catch (e: any) {
      setTestResult({ status: "fail", error: String(e?.message ?? e) });
    }
  };

  const load = useCallback(async () => {
    try {
      const d = await api("/api/accounts");
      setAccounts(d.accounts ?? []);
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 1. One-click Device Code Auth Flow (NO URL Copying needed!)
  const startDeviceAuth = async () => {
    setAuthBusy(true);
    setCopiedCode(false);
    setAuthMsg({ kind: "info", text: "正在向微软申请专属授权配对码..." });
    try {
      const d = await api("/api/auth/device/start", { method: "POST" });
      setDeviceData(d);
      setDevicePolling(true);

      // Auto-copy user_code to clipboard
      if (d.user_code && navigator.clipboard) {
        navigator.clipboard.writeText(d.user_code).then(() => setCopiedCode(true)).catch(() => {});
      }

      // Open verification URL
      window.open(d.verification_uri || "https://login.microsoft.com/device", "_blank");

      setAuthMsg({
        kind: "info",
        text: `已生成配对码 [${d.user_code}] 并自动复制！请在新窗口中粘贴该码完成登录，网关将自动绑定入库。`,
      });

      // Start automatic polling
      const pollInterval = Math.max((d.interval || 5), 3) * 1000;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await api("/api/auth/device/poll", {
            method: "POST",
            body: JSON.stringify({ device_code: d.device_code }),
          });

          if (res.status === "success") {
            clearInterval(pollTimerRef.current);
            setDevicePolling(false);
            setDeviceData(null);
            const accName = res.account?.email || res.account?.displayName || "微软商用账号";
            setAuthMsg({
              kind: "success",
              text: `🎉 授权成功！已自动添加账号：${accName}，无需任何手动复制。`,
            });
            push(`${t("Authorization succeeded")} (${accName})`, "success");
            await load();
          } else if (res.status === "error") {
            clearInterval(pollTimerRef.current);
            setDevicePolling(false);
            setAuthMsg({ kind: "error", text: `授权异常: ${res.error}` });
          }
        } catch {
          // Keep polling until user completes or cancels
        }
      }, pollInterval);

    } catch (e: any) {
      setAuthMsg({ kind: "error", text: String(e?.message ?? e) });
    } finally {
      setAuthBusy(false);
    }
  };

  const cancelDeviceAuth = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setDevicePolling(false);
    setDeviceData(null);
    setAuthMsg(null);
  };

  const copyPairingCode = () => {
    if (deviceData?.user_code && navigator.clipboard) {
      navigator.clipboard.writeText(deviceData.user_code).then(() => {
        setCopiedCode(true);
        push("配对码已复制到剪贴板！", "success");
        setTimeout(() => setCopiedCode(false), 2000);
      });
    }
  };

  // 2. Legacy PKCE Auth Flow (with smart clipboard paste)
  const startPKCEAuth = async () => {
    try {
      const d = await api("/api/auth/start");
      setAuthState(d.state ?? "");
      const popup = window.open(d.url, "pkce", "width=600,height=800");
      popupRef.current = popup;
      if (!popup) {
        setAuthMsg({ kind: "error", text: t("Popup blocked — allow popups and try again") });
        return;
      }
      setAuthMsg({ kind: "info", text: t("Sign in the popup, then paste the full callback URL below") });
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    }
  };

  const submitPKCECallback = async () => {
    const raw = callback.trim();
    if (!raw) {
      push(t("Paste the callback URL"), "error");
      return;
    }
    setAuthBusy(true);
    try {
      const url = raw.startsWith("http")
        ? `/api/auth/callback?url=${encodeURIComponent(raw)}`
        : `/api/auth/callback?${raw.replace(/^\?/, "")}`;
      await api(url);
      setAuthMsg({ kind: "success", text: t("Authorization succeeded") });
      setCallback("");
      await load();
    } catch (e: any) {
      setAuthMsg({ kind: "error", text: String(e?.message ?? e) });
    } finally {
      setAuthBusy(false);
    }
  };

  const pasteAndSubmitClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.includes("code=") || text.includes("http"))) {
        setCallback(text.trim());
        const raw = text.trim();
        setAuthBusy(true);
        const url = raw.startsWith("http")
          ? `/api/auth/callback?url=${encodeURIComponent(raw)}`
          : `/api/auth/callback?${raw.replace(/^\?/, "")}`;
        await api(url);
        setAuthMsg({ kind: "success", text: t("Authorization succeeded") });
        setCallback("");
        push("从剪贴板自动识别并授权成功！", "success");
        await load();
      } else {
        push("剪贴板中未找到包含 code= 的有效链接", "error");
      }
    } catch {
      push("无法读取剪贴板，请手动粘贴", "error");
    } finally {
      setAuthBusy(false);
    }
  };

  const visible = accounts.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (a.email || "").toLowerCase().includes(q) || (a.displayName || "").toLowerCase().includes(q);
    }
    return true;
  });
  const allSelected = visible.length > 0 && visible.every((a) => selection.has(a.id));
  const toggleOne = (id: string, on: boolean) => setSelection((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const toggleAll = (on: boolean) => setSelection(on ? new Set(visible.map((a) => a.id)) : new Set());

  const batch = async (patch: Record<string, unknown>) => {
    const ids = [...selection];
    if (!ids.length) { push(t("Select at least one account"), "error"); return; }
    try {
      const r = await api("/api/accounts/batch", { method: "POST", body: JSON.stringify({ ids, ...patch }) });
      push(`${t("Settings saved")} (${r.updated})`, "success");
      await load();
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    }
  };

  const setSchedule = async (id: string, enabled: boolean) => {
    try {
      await api("/api/accounts/schedule", { method: "POST", body: JSON.stringify({ id, enabled }) });
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, scheduleEnabled: enabled } : a)));
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("Delete this account?"))) return;
    try {
      await api("/api/accounts/delete", { method: "POST", body: JSON.stringify({ id }) });
      push(t("Deleted"), "success");
      await load();
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    }
  };

  const bindProxy = async (a: Account) => {
    const input = window.prompt(t("Bound proxy URL (leave empty for direct)"), a.boundProxy ?? "");
    if (input === null) return;
    try {
      await api("/api/accounts/bind-proxy", { method: "POST", body: JSON.stringify({ id: a.id, proxyUrl: input.trim() }) });
      push(t("Proxy updated"), "success");
      await load();
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    }
  };

  const msgClass = authMsg?.kind === "success" ? "highlight-box success" : authMsg?.kind === "error" ? "highlight-box warning" : "highlight-box";

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-title">{t("Account management")}</h2>
          <p className="page-sub">授权与管理用于 API 轮询转发的 Microsoft 365 商业账号池</p>
        </div>
        <button className="btn primary" onClick={openTest}><FlaskConical size={14} /> {t("Test models")}</button>
      </div>

      {/* Add Account Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="card-title">{t("Add account")}</span>
          <div className="seg">
            <button className={authMode === "device" ? "active" : ""} onClick={() => setAuthMode("device")}>
              ⚡ 一键免复制授权 (推荐)
            </button>
            <button className={authMode === "pkce" ? "active" : ""} onClick={() => setAuthMode("pkce")}>
              传统 PKCE 模式
            </button>
          </div>
        </div>

        <div className="card-body">
          {authMode === "device" ? (
            /* Mode 1: One-Click Device Code Flow */
            <div>
              {!devicePolling && !deviceData ? (
                <div>
                  <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.2)", marginBottom: "16px" }}>
                    <div style={{ fontWeight: 600, color: "#818cf8", marginBottom: "6px", display: "flex", alignItems: "center", gap: 6 }}>
                      <Sparkles size={16} /> 极速免复制流说明
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: 1.5 }}>
                      点击下方按钮后，系统将自动生成微软配对码并写入剪贴板，同时直接打开微软官方登录页。您只需在微软页面粘贴配对码并登录，本系统将<b>全自动完成捕获与入库</b>，彻底告别繁琐的复制回调 URL！
                    </p>
                  </div>

                  <button className="btn primary" style={{ width: "100%", padding: "12px", fontSize: "14px" }} disabled={authBusy} onClick={startDeviceAuth}>
                    <Sparkles size={16} /> {authBusy ? "正在请求微软端点..." : "⚡ 立即一键开始授权 (免复制 URL)"}
                  </button>
                </div>
              ) : (
                /* In Progress */
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "8px" }}>
                    已为您生成并复制微软专属配对码，请在微软页面粘贴确认：
                  </p>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", margin: "10px 0 16px", padding: "10px 20px", background: "rgba(15, 23, 42, 0.9)", border: "2px solid #6366f1", borderRadius: "12px", boxShadow: "0 0 25px rgba(99, 102, 241, 0.3)" }}>
                    <span style={{ fontSize: "28px", fontWeight: 800, fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.15em", color: "#00f0ff" }}>
                      {deviceData?.user_code}
                    </span>
                    <button className="btn btn-sm" onClick={copyPairingCode} title="复制配对码">
                      {copiedCode ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      <span>{copiedCode ? "已复制" : "复制"}</span>
                    </button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginBottom: "16px" }}>
                    <a
                      href={deviceData?.verification_uri || "https://login.microsoft.com/device"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn primary"
                      style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <ExternalLink size={14} /> 打开微软登录页面 ↗
                    </a>
                    <button className="btn danger" onClick={cancelDeviceAuth} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <XCircle size={14} /> 取消本次授权
                    </button>
                  </div>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "#818cf8" }}>
                    <RefreshCw size={13} className="spin" />
                    <span>网关正在自动探测授权状态... 微软页面登录完成后将自动绑定</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Mode 2: Legacy PKCE with Smart Clipboard Paste */
            <div>
              <div className="onb-steps" style={{ marginBottom: 16 }}>
                {[
                  { n: 1, title: t("Click Start authorization below"), sub: t("A popup opens the Microsoft sign-in page.") },
                  { n: 2, title: t("Sign in, then copy the address-bar URL from the popup"), sub: t("The popup ends on a blank or error page — that is normal. Copy the whole URL, including the code and state parameters.") },
                  { n: 3, title: t("Paste that long URL and confirm"), sub: t("Paste it into the callback field and click Confirm and add.") },
                ].map((s) => (
                  <div className="onb-step" key={s.n}>
                    <span className="onb-step-num">{s.n}</span>
                    <span className="onb-step-text"><b>{s.title}</b><p>{s.sub}</p></span>
                  </div>
                ))}
              </div>
              <button className="btn primary" style={{ width: "100%", marginBottom: 12 }} onClick={startPKCEAuth}>
                {t("Start authorization")}
              </button>
              <label className="form-label">{t("Callback URL")}</label>
              <div className="copy-field">
                <input
                  className="form-input"
                  value={callback}
                  onChange={(e) => setCallback(e.target.value)}
                  placeholder={t("Paste the full callback URL…")}
                  autoComplete="off"
                />
                <button className="btn" onClick={pasteAndSubmitClipboard} title="从剪贴板一键提取并提交">
                  <Copy size={13} /> 剪贴板提取
                </button>
                <button className="btn primary" style={{ minWidth: 96 }} disabled={authBusy} onClick={submitPKCECallback}>
                  {authBusy ? "…" : t("Confirm and add")}
                </button>
                <input type="hidden" value={authState} readOnly />
              </div>
            </div>
          )}

          {authMsg ? (
            <div className={msgClass} style={{ marginTop: 14 }}>
              <div className="highlight-box-title">{authMsg.text}</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Account List Table */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">{t("Authorized accounts")} ({accounts.length})</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="form-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search accounts…")} style={{ width: 180, padding: "6px 10px", fontSize: 12 }} />
            <div className="seg">
              {(["all", "online", "cooldown", "offline"] as const).map((f) => (
                <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                  {t(f === "all" ? "All" : f === "online" ? "Online" : f === "cooldown" ? "Cooldown" : "Offline")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} /> {t("Select all")}
          </label>
          <span className="form-hint" style={{ margin: 0 }}>{selection.size} {t("selected")}</span>
          <button className="btn btn-sm" onClick={() => batch({ scheduling: true })}>{t("Enable sched")}</button>
          <button className="btn btn-sm danger" onClick={() => batch({ scheduling: false })}>{t("Disable sched")}</button>
          <button className="btn btn-sm" onClick={() => batch({ webSearch: true })}>{t("Search on")}</button>
          <button className="btn btn-sm danger" onClick={() => batch({ webSearch: false })}>{t("Search off")}</button>
          <input className="form-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("System prompt for selected…")} style={{ flex: 1, minWidth: 160, padding: "6px 10px", fontSize: 12 }} />
          <button className="btn btn-sm primary" onClick={() => prompt.trim() ? batch({ systemPrompt: prompt.trim() }) : push(t("Enter a system prompt first"), "error")}>{t("Apply prompt")}</button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>{t("Account")}</th>
                <th>{t("Status")}</th>
                <th>{t("Calls")}</th>
                <th>{t("Schedule")}</th>
                <th>{t("Web search")}</th>
                <th>{t("Proxy")}</th>
                <th>{t("Updated")}</th>
                <th style={{ width: 120 }}>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
                    {loading ? t("Loading…") : t("No accounts authorized yet")}
                  </td>
                </tr>
              ) : (
                visible.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <input type="checkbox" checked={selection.has(a.id)} onChange={(e) => toggleOne(a.id, e.target.checked)} />
                    </td>
                    <td>
                      <div>
                        <b>{a.displayName || a.email}</b>
                        {a.displayName && a.email ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{a.email}</div> : null}
                      </div>
                    </td>
                    <td>
                      <span className={`status ${a.status}`}>
                        <span className="dot" /> {t(a.status === "online" ? "Online" : a.status === "cooldown" ? "Cooldown" : "Offline")}
                      </span>
                    </td>
                    <td>{a.callCount ?? 0}</td>
                    <td>
                      <input type="checkbox" checked={a.scheduleEnabled} onChange={(e) => setSchedule(a.id, e.target.checked)} />
                    </td>
                    <td>{a.webSearchEnabled ? t("Enabled") : t("Disabled")}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => bindProxy(a)} style={{ fontSize: 11 }}>
                        {a.boundProxy ? a.boundProxy.slice(0, 18) + "…" : t("Direct")}
                      </button>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>
                      {a.updatedAt ? new Date(a.updatedAt).toLocaleString() : "—"}
                    </td>
                    <td>
                      <button className="btn btn-sm danger" onClick={() => remove(a.id)}>
                        {t("Delete")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Test Modal */}
      <AnimatePresence>
        {testOpen && (
          <Modal onClose={() => setTestOpen(false)} title={t("Test models")}>
            <div className="form-group">
              <label className="form-label">{t("Model")}</label>
              <select className="form-input" value={testModel} onChange={(e) => setTestModel(e.target.value)}>
                {testModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t("Prompt")}</label>
              <textarea
                className="form-input"
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={() => setTestOpen(false)}>{t("Close")}</button>
              <button className="btn primary" disabled={testResult.status === "busy"} onClick={runTest}>
                {testResult.status === "busy" ? t("Testing…") : t("Run test")}
              </button>
            </div>
            {testResult.status !== "idle" && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)" }}>
                {testResult.status === "busy" && <span>{t("Testing…")}</span>}
                {testResult.status === "ok" && (
                  <div>
                    <div style={{ color: "var(--green)", fontWeight: 600, marginBottom: 4 }}>
                      ✓ {t("Success")} ({testResult.latencyMs} ms)
                    </div>
                    <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{testResult.reply}</pre>
                  </div>
                )}
                {testResult.status === "fail" && (
                  <div style={{ color: "var(--red)" }}>✕ {testResult.error}</div>
                )}
              </div>
            )}
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
