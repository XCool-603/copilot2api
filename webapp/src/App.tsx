import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  LayoutDashboard, ChartLine, Users, KeyRound, MessageSquare,
  Globe, Settings, LogOut,
} from "lucide-react";
import { api, isLoggedIn, login, wantsRemember, setRemember as setRememberPref } from "./api";
import { t, setLocale, getLocale, detectLocale, LOCALES, type Locale } from "./i18n";
import { ToastHost, useToasts } from "./components";
import { DashboardPage } from "./pages/Dashboard";
import { UsagePage } from "./pages/Usage";
import { AccountsPage } from "./pages/Accounts";
import { ApiKeysPage } from "./pages/ApiKeys";
import { ConversationsPage } from "./pages/Conversations";
import { ProxiesPage } from "./pages/Proxies";
import { SettingsPage } from "./pages/Settings";

const NAV = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "usage", icon: ChartLine, label: "Usage" },
  { id: "accounts", icon: Users, label: "Accounts" },
  { id: "apikeys", icon: KeyRound, label: "API Keys" },
  { id: "conversations", icon: MessageSquare, label: "Conversations" },
  { id: "proxies", icon: Globe, label: "Proxy Pool" },
  { id: "settings", icon: Settings, label: "Settings" },
] as const;

type PageId = (typeof NAV)[number]["id"];

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => isLoggedIn());
  const [mustChange, setMustChange] = useState<boolean>(false);
  const [lastEnteredPwd, setLastEnteredPwd] = useState<string>("");
  const [page, setPage] = useState<PageId>("dashboard");
  const { toasts, push, dismiss } = useToasts();
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  useEffect(() => {
    const l = detectLocale();
    setLocale(l);
    setLocaleState(l);
  }, []);

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((d) => {
        setAuthed(!!d.authenticated);
        setMustChange(!!d.must_change_password);
      })
      .catch(() => {
        setAuthed(false);
        setMustChange(false);
      });
  }, []);

  if (!authed) {
    return (
      <LoginScreen
        onSuccess={(needsChange?: boolean, enteredPwd?: string) => {
          setAuthed(true);
          if (enteredPwd) setLastEnteredPwd(enteredPwd);
          if (needsChange) setMustChange(true);
        }}
        push={push}
        toasts={toasts}
        dismiss={dismiss}
        locale={locale}
        onLocale={(l) => {
          setLocale(l);
          setLocaleState(l);
        }}
      />
    );
  }

  if (mustChange) {
    return (
      <ChangePasswordScreen
        initialCurrent={lastEnteredPwd}
        onSuccess={() => {
          setMustChange(false);
          setAuthed(false);
          push(t("Password changed successfully, please log in again"), "success");
        }}
        push={push}
        toasts={toasts}
        dismiss={dismiss}
        locale={locale}
        onLocale={(l) => {
          setLocale(l);
          setLocaleState(l);
        }}
      />
    );
  }

  return (
    <div className="app">
      <div className="sidebar">
        <div className="logo">
          <span className="logo-mark" aria-hidden="true"><span /><span /><span /><span /></span>
          <span className="logo-text">Copilot2API</span>
        </div>
        <div className="nav-label">{t("Navigation")}</div>
        <nav className="nav" aria-label={t("Navigation")}>
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? "active" : ""} onClick={() => setPage(n.id)} aria-current={page === n.id ? "page" : undefined} title={t(n.label)}>
              <n.icon size={16} strokeWidth={2} aria-hidden="true" />
              <span>{t(n.label)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot" id="sidebarVersion">dev</div>
      </div>

      <div className="main">
        <div className="topbar">
          <h1>{t(NAV.find((n) => n.id === page)!.label)}</h1>
          <div className="topbar-right">
            <span className="topbar-status" style={{ color: "var(--muted)" }}>
              <span className="status-dot" /> {t("Running")}
            </span>
            <select
              className="topbar-locale"
              value={locale}
              onChange={(e) => {
                const l = e.target.value as Locale;
                setLocale(l);
                setLocaleState(l);
              }}
              aria-label={t("Language")}
              style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 8px", fontSize: 12, color: "var(--text)" }}
            >
              {LOCALES.map((l) => (<option key={l.id} value={l.id}>{l.label}</option>))}
            </select>
            <a href="/" className="btn btn-sm" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit' }}>
              <Globe size={13} /> {t("Portal")}
            </a>
            <button className="btn btn-sm logout-btn" onClick={async () => {
              await api("/api/admin/logout", { method: "POST" }).catch(() => {});
              try { sessionStorage.clear(); } catch {}
              setAuthed(false);
            }}>
              <LogOut size={13} /> {t("Log out")}
            </button>
          </div>
        </div>

        <div className="content">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            >
              {page === "dashboard" && <DashboardPage push={push} nav={setPage} />}
              {page === "usage" && <UsagePage push={push} />}
              {page === "accounts" && <AccountsPage push={push} />}
              {page === "apikeys" && <ApiKeysPage push={push} />}
              {page === "conversations" && <ConversationsPage push={push} />}
              {page === "proxies" && <ProxiesPage push={push} />}
              {page === "settings" && <SettingsPage push={push} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <ToastHost toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

function LoginScreen({
  onSuccess,
  push,
  toasts,
  dismiss,
  locale,
  onLocale,
}: {
  onSuccess: (needsChange?: boolean, enteredPwd?: string) => void;
  push: (m: string, k?: "success" | "error" | "info") => void;
  toasts: { id: number; message: string; kind: "success" | "error" | "info" }[];
  dismiss: (id: number) => void;
  locale: Locale;
  onLocale: (l: Locale) => void;
}) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(wantsRemember());
  const pwdRef = useRef<HTMLInputElement>(null);
  void locale;
  return (
    <div className="app" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
        className="card"
        style={{ width: "min(400px, calc(100vw - 32px))", padding: 28 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 6 }}>
          <span className="logo-mark" aria-hidden="true"><span /><span /><span /><span /></span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>M365 Copilot2API</span>
        </div>
        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, margin: "0 0 18px" }}>{t("Administrator Login")}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setRememberPref(remember);
              const data = await login(pwd);
              onSuccess(!!data?.must_change_password, pwd);
              push(t("Login successful"), "success");
            } catch (err: any) {
              push(err?.message === "admin_login_locked" ? t("Too many failed attempts, try again later") : String(err?.message ?? err), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            ref={pwdRef}
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onAnimationStart={(e) => {
              if (e.animationName === "onAutoFillStart") setPwd(pwdRef.current?.value ?? "");
            }}
            placeholder={t("Password")}
            autoFocus
            required
            autoComplete="current-password"
            className="form-input"
            style={{ marginBottom: 12 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t("Remember me for 30 days")}
          </label>
          <button type="submit" className="login-submit" disabled={busy || !pwd}>
            {busy ? "…" : <><KeyRound size={15} /> {t("Sign in")}</>}
          </button>
        </form>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
          <select
            value={locale}
            onChange={(e) => onLocale(e.target.value as Locale)}
            aria-label={t("Language")}
            style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "var(--muted)" }}
          >
            {LOCALES.map((l) => (<option key={l.id} value={l.id}>{l.label}</option>))}
          </select>
        </div>
      </motion.div>
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

function ChangePasswordScreen({
  initialCurrent = "",
  onSuccess,
  push,
  toasts,
  dismiss,
  locale,
  onLocale,
}: {
  initialCurrent?: string;
  onSuccess: () => void;
  push: (m: string, k?: "success" | "error" | "info") => void;
  toasts: { id: number; message: string; kind: "success" | "error" | "info" }[];
  dismiss: (id: number) => void;
  locale: Locale;
  onLocale: (l: Locale) => void;
}) {
  const [currentPwd, setCurrentPwd] = useState(initialCurrent);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  void locale;

  return (
    <div className="app" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
        className="card"
        style={{ width: "min(440px, calc(100vw - 32px))", padding: 28 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 6 }}>
          <span className="logo-mark" aria-hidden="true"><span /><span /><span /><span /></span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>M365 Copilot2API</span>
        </div>
        <p style={{ textAlign: "center", color: "var(--text)", fontWeight: 600, fontSize: 15, margin: "0 0 6px" }}>
          {t("Change Administrator Password")}
        </p>
        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, margin: "0 0 18px", lineHeight: 1.4 }}>
          {t("Administrator password must be changed before using the console")}
        </p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (newPwd !== confirmPwd) {
              push(t("Passwords do not match"), "error");
              return;
            }
            if (newPwd.length < 12) {
              push(t("Password must be at least 12 characters and contain 3 character classes (uppercase, lowercase, numbers, symbols)"), "error");
              return;
            }
            setBusy(true);
            try {
              await api("/api/admin/change-password", {
                method: "POST",
                body: JSON.stringify({
                  current_password: currentPwd,
                  new_password: newPwd,
                }),
              });
              onSuccess();
            } catch (err: any) {
              push(String(err?.message ?? err), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {t("Current Password")}
            </label>
            <input
              type="password"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              placeholder={t("Current Password")}
              required
              autoComplete="current-password"
              className="form-input"
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {t("New Password")}
            </label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder={t("New Password")}
              required
              autoComplete="new-password"
              className="form-input"
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.3 }}>
              {t("Password must be at least 12 characters and contain 3 character classes (uppercase, lowercase, numbers, symbols)")}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {t("Confirm New Password")}
            </label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder={t("Confirm New Password")}
              required
              autoComplete="new-password"
              className="form-input"
            />
          </div>

          <button type="submit" className="login-submit" disabled={busy || !newPwd || !confirmPwd}>
            {busy ? "…" : <><KeyRound size={15} /> {t("Change Administrator Password")}</>}
          </button>
        </form>

        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
          <select
            value={locale}
            onChange={(e) => onLocale(e.target.value as Locale)}
            aria-label={t("Language")}
            style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "var(--muted)" }}
          >
            {LOCALES.map((l) => (<option key={l.id} value={l.id}>{l.label}</option>))}
          </select>
        </div>
      </motion.div>
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
