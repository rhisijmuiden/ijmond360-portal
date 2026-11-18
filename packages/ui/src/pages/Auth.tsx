import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { post } from "../api";
import { Alert, Button, Field, Input } from "../components/ui";
import { LANGUAGES } from "../i18n";
import { useSession } from "../session";
import { ShieldCheck } from "lucide-react";

function AuthLayout({ logo, title, intro, children }: { logo: string; title: string; intro?: string; children: React.ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden bg-sidebar px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60rem 40rem at 10% -10%, color-mix(in srgb, var(--tvsm-primary) 35%, transparent), transparent 60%), radial-gradient(40rem 30rem at 110% 110%, color-mix(in srgb, var(--tvsm-accent) 22%, transparent), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-md">
        <img src={logo} alt="" className="mx-auto mb-8 h-12" />
        <div className="rounded-xl border border-line bg-surface p-8 shadow-2xl">
          <h1 className="font-display text-xl font-semibold">{title}</h1>
          {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-6 flex justify-center gap-4 text-xs">
          {LANGUAGES.map((l) => (
            <button key={l.code} onClick={() => void i18n.changeLanguage(l.code)} className={i18n.language === l.code ? "font-semibold text-white" : "text-white/50 hover:text-white"}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The login page: brand panel on the left (logo, tagline, the pink ring), the sign-in card on the right. */
function SplitLayout({ logo, children }: { logo: string; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex min-h-full flex-col bg-bg md:flex-row">
      <div className="relative flex shrink-0 flex-col justify-between gap-10 overflow-hidden bg-sidebar px-8 py-10 text-white md:w-[44%] md:px-14 md:py-14">
        <div aria-hidden className="pointer-events-none absolute -right-40 -bottom-40 size-[30rem] rounded-full border-[56px] border-onair opacity-90" />
        <img src={logo} alt="" className="relative h-12 w-auto self-start md:h-16" />
        <div className="relative max-w-md">
          <h1 className="font-display text-3xl leading-tight font-extrabold md:text-5xl">{t("auth.portalTagline")}</h1>
          <p className="mt-4 text-base text-sidebar-fg md:text-lg">{t("auth.portalIntro")}</p>
        </div>
        <span className="relative hidden text-xs text-white/50 md:block">{t("auth.portalFooter")}</span>
      </div>
      <div className="relative grid flex-1 place-items-center px-4 py-12">
        <div className="absolute top-6 right-6 flex gap-1 rounded-md border border-line bg-surface p-1">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => void i18n.changeLanguage(l.code)}
              className={i18n.language === l.code ? "h-8 rounded-sm bg-brand px-3 text-xs font-semibold text-white" : "h-8 rounded-sm px-3 text-xs font-semibold text-muted hover:text-fg"}
            >
              {l.code.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 shadow-card md:p-10">{children}</div>
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-5" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** Reads ?sso_error=... left by a failed Microsoft sign-in, and removes it from the address bar. */
function useSsoError() {
  const [code] = useState(() => new URLSearchParams(window.location.search).get("sso_error"));
  useEffect(() => {
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("sso_error");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [code]);
  return code;
}

export function LoginPage({ appName, logo }: { appName: string; logo: string }) {
  const { t } = useTranslation();
  const { refresh, sso } = useSession();
  const ssoError = useSsoError();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<false | "invalid" | "tooMany">(false);
  const [busy, setBusy] = useState(false);
  const [showLocal, setShowLocal] = useState(!sso);
  const returnTo = window.location.pathname + window.location.search.replace(/[?&]sso_error=[^&]*/, "");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await post("/api/auth/login", { username, password });
      await refresh();
    } catch (err) {
      setError((err as { status?: number }).status === 429 ? "tooMany" : "invalid");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SplitLayout logo={logo}>
      <h2 className="font-display text-2xl font-bold">{t("auth.welcome")}</h2>
      <p className="mt-2 text-[15px] text-muted">{sso ? t("auth.welcomeSso") : t("auth.signInTitle", { app: appName })}</p>
      <div className="mt-6 space-y-4">
        {ssoError && <Alert tone="danger">{t(`auth.ssoErrors.${ssoError}`, { defaultValue: t("auth.ssoErrors.generic") })}</Alert>}
        {sso && (
          <>
            <a
              href={`/api/auth/sso/login?returnTo=${encodeURIComponent(returnTo || "/")}`}
              className="flex h-13 w-full items-center justify-center gap-3 rounded-md bg-brand text-base font-semibold text-white shadow-sm shadow-brand/30 transition hover:bg-brand-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <MicrosoftLogo />
              {sso.label || t("auth.signInMicrosoft")}
            </a>
            <p className="flex items-start gap-2 rounded-md bg-brand/10 px-3.5 py-3 text-[13px] text-brand">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              {t("auth.tenantOnly")}
            </p>
            {!showLocal && (
              <button type="button" onClick={() => setShowLocal(true)} className="w-full text-center text-[13px] text-muted hover:text-fg">
                {t("auth.useLocalAccount")}
              </button>
            )}
          </>
        )}
        {showLocal && (
          <form onSubmit={submit} className={sso ? "space-y-4 border-t border-line pt-5" : "space-y-4"}>
            {error && <Alert tone="danger">{t(error === "tooMany" ? "auth.tooManyAttempts" : "auth.invalid")}</Alert>}
            <Field label={t("auth.username")}>{(id) => <Input id={id} autoFocus={!sso} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
            <Field label={t("auth.password")}>
              {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Button type="submit" variant={sso ? "secondary" : "primary"} className="w-full" loading={busy}>
              {t("auth.signIn")}
            </Button>
          </form>
        )}
      </div>
    </SplitLayout>
  );
}

export function SetupPage({ appName, logo }: { appName: string; logo: string }) {
  const { t, i18n } = useTranslation();
  const { refresh } = useSession();
  const [f, setF] = useState({ username: "admin", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError(t("auth.passwordMismatch"));
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/setup", { username: f.username, password: f.password, email: f.email || undefined, language: i18n.language === "nl" ? "nl" : "en" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthLayout logo={logo} title={t("auth.setupTitle", { app: appName })} intro={t("auth.setupIntro")}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("auth.username")}>{(id) => <Input id={id} value={f.username} onChange={set("username")} autoComplete="username" />}</Field>
        <Field label={`${t("auth.email")} (${t("common.optional")})`}>{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} />}</Field>
        <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
          {(id) => <Input id={id} type="password" minLength={10} value={f.password} onChange={set("password")} autoComplete="new-password" />}
        </Field>
        <Field label={t("auth.passwordConfirm")}>{(id) => <Input id={id} type="password" value={f.confirm} onChange={set("confirm")} autoComplete="new-password" />}</Field>
        <Button type="submit" className="w-full" loading={busy}>
          {t("auth.createAccount")}
        </Button>
      </form>
    </AuthLayout>
  );
}
