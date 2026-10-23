import { useCallback, useEffect, useState } from "react";
import {
  Flame, TrendingUp, Activity, PiggyBank, Plus, Key, Trash2,
  Users, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, XCircle, ArrowRight, Layers
} from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { fmtTok } from "./Usage";

type Push = (m: string, k?: "success" | "error" | "info") => void;

type Account = {
  id: string;
  email: string;
  displayName?: string;
  status: string;
  scheduleEnabled: boolean;
  rateLimited?: boolean;
  callCount?: number;
  cooldownUntil?: string;
  updatedAt?: string;
  boundProxy?: string;
};

export function DashboardPage({ push, nav }: { push: Push; nav: (id: "accounts" | "apikeys" | "conversations") => void }) {
  const [stats, setStats] = useState<any>(null);
  const [day, setDay] = useState<any>(null);
  const [all, setAll] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [syncingModels, setSyncingModels] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, d, a, l, acc, m] = await Promise.all([
        api("/api/stats").catch(() => ({})),
        api("/api/usage?days=1").catch(() => ({})),
        api("/api/usage?days=365").catch(() => ({})),
        api("/api/usage/logs?limit=6&offset=0").catch(() => ({ logs: [] })),
        api("/api/accounts").catch(() => ({ accounts: [] })),
        api("/api/admin/models").catch(() => ({ data: [] })),
      ]);
      setStats(s);
      setDay(d?.stats?.summary ?? {});
      setAll(a?.stats?.summary ?? {});
      setLogs(l?.logs ?? []);
      setAccounts(acc?.accounts ?? []);
      setModels(m?.data ?? []);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!msg.includes("password_change_required") && !msg.includes("administrator password must be changed")) {
        push(msg, "error");
      }
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const syncModels = async () => {
    setSyncingModels(true);
    try {
      const res = await api("/api/admin/models/sync", { method: "POST" });
      push(`已从微软上游实时同步 ${res.count ?? res.upstream_tones?.length ?? 0} 个最新模型！`, "success");
      const m = await api("/api/admin/models");
      setModels(m?.data ?? []);
    } catch (e: any) {
      push(String(e?.message ?? e), "error");
    } finally {
      setSyncingModels(false);
    }
  };

  const cache = stats?.stats ?? {};
  const overview = [
    { Icon: Flame, label: t("Last 24 hours"), value: fmtTok(day?.tokens), sub: `${fmtTok(day?.requests)} ${t("requests")}` },
    { Icon: TrendingUp, label: t("All-time usage"), value: fmtTok(all?.tokens), sub: `${fmtTok(all?.requests)} ${t("requests")}` },
    { Icon: Activity, label: t("Request count"), value: fmtTok(all?.today_tokens), sub: `${fmtTok(all?.today_requests)} ${t("Today")}` },
    { Icon: PiggyBank, label: t("Cache hits"), value: fmtTok(cache?.tokens_saved), sub: `${t("Hit rate")} ${Math.round(cache?.hit_rate ?? 0)}%` },
  ];
  const cards = [
    { label: "Total sessions", value: stats?.conv_cache?.cached_conversations ?? 0, unit: "total" },
    { label: "Cache hits", value: fmtTok(cache?.cache_hits), unit: "hits" },
    { label: "Hit rate", value: Math.round(cache?.hit_rate ?? 0), unit: "%" },
    { label: "Tokens saved", value: fmtTok(cache?.tokens_saved), unit: "saved" },
  ];

  const onlineAccounts = accounts.filter((a) => a.status === "online" || (!a.status && !a.rateLimited));
  const cooldownAccounts = accounts.filter((a) => a.status === "cooldown" || a.rateLimited);
  const offlineAccounts = accounts.filter((a) => a.status === "offline" || a.status === "auth_failed");

  return (
    <div>
      {/* Metrics Row */}
      <div className="usage-overview">
        {overview.map((o) => (
          <div className="usage-overview-item" key={o.label}>
            <div className="usage-overview-top"><o.Icon size={14} /> {o.label}</div>
            <span className="usage-overview-value">{o.value}</span>
            <span className="usage-overview-sub">{o.sub}</span>
          </div>
        ))}
      </div>

      <div className="stats">
        {cards.map((c) => (
          <div className="stat" key={c.label}>
            <span className="stat-label">{t(c.label)}</span>
            <span className="stat-value">{String(c.value)}<span className="stat-unit">{c.unit === "%" ? "%" : t(c.unit)}</span></span>
          </div>
        ))}
      </div>

      {/* Account Matrix Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={16} color="#6366f1" />
            <span className="card-title">已授权 M365 商业账号池</span>
            <span className="badge info">{accounts.length} 账号</span>
            {onlineAccounts.length > 0 && <span className="badge success">{onlineAccounts.length} 在线</span>}
            {cooldownAccounts.length > 0 && <span className="badge warning">{cooldownAccounts.length} 冷却中</span>}
            {offlineAccounts.length > 0 && <span className="badge danger">{offlineAccounts.length} 异常</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm" onClick={syncModels} disabled={syncingModels} title="从微软上游实时获取并同步模型清单">
              <RefreshCw size={12} className={syncingModels ? "spin" : ""} />
              <span>{syncingModels ? "同步中…" : "⚡ 实时同步上游最新模型"}</span>
            </button>
            <button className="btn btn-sm primary" onClick={() => nav("accounts")}>
              <Plus size={12} /> <span>添加账号</span>
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>账号邮箱 / 标识</th>
                <th>工作状态</th>
                <th>轮询调度</th>
                <th>调用计数</th>
                <th>网络代理</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty">{t("Loading")}…</td></tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "32px 16px", textAlign: "center" }}>
                    <div style={{ maxWidth: 440, margin: "0 auto" }}>
                      <Users size={32} color="#6366f1" style={{ opacity: 0.5, marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>暂未绑定任何 M365 Copilot 账号</div>
                      <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 14 }}>
                        网关需要至少一个拥有 Copilot 权限的微软账号进行对话中继与转换。推荐使用一键免复制设备码快速入库。
                      </p>
                      <button className="btn primary" onClick={() => nav("accounts")}>
                        <Sparkles size={14} /> <span>立即一键免复制授权账号</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                accounts.map((a) => {
                  const isCool = a.status === "cooldown" || !!a.cooldownUntil;
                  const isOff = a.status === "offline" || a.status === "auth_failed";
                  return (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.email || a.id}</div>
                        {a.displayName && a.displayName !== a.email && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{a.displayName}</div>
                        )}
                      </td>
                      <td>
                        {isCool ? (
                          <span className="badge warning" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <AlertTriangle size={11} /> 冷却中
                          </span>
                        ) : isOff ? (
                          <span className="badge danger" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <XCircle size={11} /> 异常
                          </span>
                        ) : (
                          <span className="badge success" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <CheckCircle2 size={11} /> 在线就绪
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: a.scheduleEnabled !== false ? "var(--green)" : "var(--muted)" }}>
                          {a.scheduleEnabled !== false ? "● 参与轮询" : "○ 已暂停"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>
                        {a.callCount ?? 0}
                      </td>
                      <td style={{ fontSize: 12, color: a.boundProxy ? "var(--text)" : "var(--muted)" }}>
                        {a.boundProxy ? "已绑定专属代理" : "直连"}
                      </td>
                      <td>
                        <button className="btn btn-sm" onClick={() => nav("accounts")} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span>管理</span> <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Available Models Pool */}
      {models.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Layers size={16} color="#00f0ff" />
              <span className="card-title">实时就绪模型矩阵 ({models.length})</span>
            </div>
            <button className="btn btn-sm" onClick={syncModels} disabled={syncingModels}>
              <RefreshCw size={12} className={syncingModels ? "spin" : ""} />
              <span>{syncingModels ? "探测中..." : "实时刷新上游"}</span>
            </button>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {models.map((m: any) => {
                const isReasoning = String(m.id).includes("reasoning") || String(m.id).includes("o1") || String(m.id).includes("o3");
                const isClaude = String(m.id).includes("claude");
                const isImage = String(m.id).includes("flux") || String(m.id).includes("dall");
                const bg = isImage ? "rgba(236, 72, 153, 0.12)" : isReasoning ? "rgba(168, 85, 247, 0.12)" : isClaude ? "rgba(249, 115, 22, 0.12)" : "rgba(14, 165, 233, 0.12)";
                const border = isImage ? "rgba(236, 72, 153, 0.3)" : isReasoning ? "rgba(168, 85, 247, 0.3)" : isClaude ? "rgba(249, 115, 22, 0.3)" : "rgba(14, 165, 233, 0.3)";
                const color = isImage ? "#f472b6" : isReasoning ? "#c084fc" : isClaude ? "#fb923c" : "#38bdf8";

                return (
                  <div
                    key={m.id}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      background: bg,
                      border: `1px solid ${border}`,
                      fontSize: 12,
                      fontFamily: "var(--font-mono, monospace)",
                      color: color,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                    title={`${m.display_name || m.id} (${m.owned_by || "microsoft-365"})`}
                  >
                    <span>{m.id}</span>
                    {isReasoning && <span style={{ fontSize: 9.5, opacity: 0.8, background: "rgba(0,0,0,0.3)", padding: "1px 4px", borderRadius: 4 }}>THINK</span>}
                    {isImage && <span style={{ fontSize: 9.5, opacity: 0.8, background: "rgba(0,0,0,0.3)", padding: "1px 4px", borderRadius: 4 }}>IMAGE</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><span className="card-title">{t("Quick actions")}</span></div>
        <div className="card-body">
          <div className="quick-grid">
            <button type="button" className="quick-action" onClick={() => nav("accounts")}>
              <span className="quick-action-icon blue"><Plus size={18} aria-hidden="true" /></span>
              <span className="quick-action-text"><h4>{t("Add account")}</h4><p>{t("Sign in via Microsoft OAuth")}</p></span>
            </button>
            <button type="button" className="quick-action" onClick={() => nav("apikeys")}>
              <span className="quick-action-icon green"><Key size={18} aria-hidden="true" /></span>
              <span className="quick-action-text"><h4>{t("Create API key")}</h4><p>{t("Generate a key for API access")}</p></span>
            </button>
            <button type="button" className="quick-action" onClick={() => nav("conversations")}>
              <span className="quick-action-icon purple"><Trash2 size={18} aria-hidden="true" /></span>
              <span className="quick-action-text"><h4>{t("Clean conversations")}</h4><p>{t("Delete conversations you no longer need")}</p></span>
            </button>
          </div>
        </div>
      </div>

      {/* Recent requests */}
      <div className="card">
        <div className="card-head"><span className="card-title">{t("Recent requests")}</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("Time")}</th><th>{t("Model")}</th><th>{t("Endpoint")}</th><th>{t("Tokens")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">{t("Loading")}…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="empty">{t("No data")}</td></tr>
              ) : (
                logs.map((l, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{l.time ? new Date(l.time).toLocaleTimeString() : "-"}</td>
                    <td>{l.model ?? "-"}</td>
                    <td>{String(l.endpoint ?? "-").replace(/^\/v1\//, "")}</td>
                    <td>{(l.input_tokens ?? 0) + (l.output_tokens ?? 0)}</td>
                    <td>{l.status ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
