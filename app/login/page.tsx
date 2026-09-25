"use client";

import { useEffect, useState, type FormEvent } from "react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";

function safeDestination(): string {
  const destination = new URLSearchParams(window.location.search).get("next");
  return destination?.startsWith("/") && !destination.startsWith("//") ? destination : "/";
}

function LoginForm() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bounceHint, setBounceHint] = useState("");
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "invalid") setBounceHint(t("auth.sessionExpired"));
    else if (reason === "missing") setBounceHint(t("auth.sessionMissing"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Maps each route failure to a message, including the upstream 429
  // retry-after handling from the auth throttle.
  const failureMessage = async (response: Response): Promise<string> => {
    if (response.status === 401) return t("auth.invalidPassword");
    if (response.status !== 429) return t("auth.loginFailed");
    const seconds = Number(response.headers.get("retry-after"));
    return t("auth.tooManyAttempts", { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 1 });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(await failureMessage(response));
        return;
      }
      // The server accepted the password, but browsers can still refuse the
      // Set-Cookie (blocked third-party/cookie settings, private mode). Without
      // this check the user lands back on /login after the redirect with no
      // explanation — verify the session actually stuck before navigating.
      const verify = await fetch("/api/web-auth", { cache: "no-store" });
      const status = await verify.json().catch(() => null) as { authenticated?: boolean } | null;
      if (!status?.authenticated) {
        setError(t("auth.cookieNotSaved"));
        return;
      }
      window.location.replace(safeDestination());
    } catch {
      setError(t("auth.loginFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="web-login-page">
      <div className="web-login-shell">
        <header className="web-login-brand">
          {/* A plain <img>, not next/image: this page must render its mark even
              when the image optimizer is unreachable (bare server, tunnels). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" width={56} height={56} alt="" />
          <div className="web-login-brand-copy">
            <h1>{t("auth.brand")}</h1>
            <p>{t("auth.prompt")}</p>
          </div>
        </header>

        <form className="web-login-form" onSubmit={submit}>
          <input
            id="web-login-password"
            className="web-login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("auth.password")}
            aria-label={t("auth.password")}
            autoComplete="current-password"
            autoFocus
            required
            disabled={busy}
          />
          <button type="submit" className="web-login-submit" disabled={busy || !password}>
            {busy ? t("auth.loggingIn") : t("auth.logIn")}
          </button>
          <p className="web-login-error" role="alert" aria-live="polite">{error}</p>
          {bounceHint && !error && <p className="web-login-hint">{bounceHint}</p>}
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <I18nProvider><LoginForm /></I18nProvider>;
}
