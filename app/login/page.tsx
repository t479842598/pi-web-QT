"use client";

import { useState, type FormEvent } from "react";
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
        setError(response.status === 401 ? t("auth.invalidPassword") : t("auth.loginFailed"));
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
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <I18nProvider><LoginForm /></I18nProvider>;
}
