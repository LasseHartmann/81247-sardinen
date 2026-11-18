import React, { useState } from 'react';
import { ThemeToggleButton } from '../Common/ThemeToggleButton';

export interface LoginScreenProps {
  firebaseAvailable: boolean;
  loginError: string | null;
  onClearError: () => void;
  onLogin: (name: string, password: string) => Promise<void>;
  onRegister: (name: string, password: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  firebaseAvailable,
  loginError,
  onClearError,
  onLogin,
  onRegister,
}) => {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [typedName, setTypedName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'REGISTER') {
        await onRegister(typedName, password);
      } else {
        await onLogin(typedName, password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cmf-drafting-bg cmf-scroll-area flex h-[100dvh] w-full flex-col items-center justify-start sm:justify-center pt-[max(1.25rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] text-[var(--text-main)]">
      <div className="cmf-chassis my-auto w-full max-w-sm space-y-5 p-6 sm:p-7">
        {/* Nothing OS Header-Widget mit Theme-Schnellumschalter */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#111113] p-1.5">
              <img
                src="/logo.png"
                alt="81247 Sardinen"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-dot text-xl leading-none text-[var(--text-main)]">
                  Sardinen
                </h1>
                <span className="nothing-red-dot" aria-hidden="true" />
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                81247 · Verstecken mit Karte
              </p>
            </div>
          </div>

          <ThemeToggleButton compact />
        </div>

        {/* Segmented Pill Control */}
        <div className="grid grid-cols-2 gap-1 rounded-full bg-[var(--module-sub)] p-1">
          <button
            type="button"
            data-testid="auth-mode-login-btn"
            onClick={() => {
              setMode('LOGIN');
              onClearError();
            }}
            className={`min-h-[38px] rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'LOGIN'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            Anmelden
          </button>
          <button
            type="button"
            data-testid="auth-mode-register-btn"
            onClick={() => {
              setMode('REGISTER');
              onClearError();
            }}
            className={`min-h-[38px] rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'REGISTER'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            Neu hier
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          <div>
            <label
              htmlFor="player-name-input"
              className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
            >
              Name
            </label>
            <input
              id="player-name-input"
              data-testid="player-name-input"
              type="text"
              enterKeyHint="next"
              autoComplete="username"
              autoFocus
              maxLength={24}
              value={typedName}
              onChange={(e) => {
                if (loginError) onClearError();
                setTypedName(e.target.value);
              }}
              placeholder={mode === 'REGISTER' ? 'Name wählen' : 'Dein Name'}
              className="cmf-input min-h-[46px] w-full px-4 py-2 text-base font-medium"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="player-password-input"
                className="text-xs font-medium text-[var(--text-muted)]"
              >
                Passwort
              </label>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                {showPw ? 'Verbergen' : 'Zeigen'}
              </button>
            </div>
            <input
              id="player-password-input"
              data-testid="player-password-input"
              type={showPw ? 'text' : 'password'}
              enterKeyHint="go"
              autoComplete={
                mode === 'REGISTER' ? 'new-password' : 'current-password'
              }
              maxLength={64}
              value={password}
              onChange={(e) => {
                if (loginError) onClearError();
                setPassword(e.target.value);
              }}
              placeholder={
                mode === 'REGISTER' ? 'Mind. 4 Zeichen' : 'Passwort'
              }
              className="cmf-input min-h-[46px] w-full px-4 py-2 text-base font-medium"
            />
          </div>

          {!firebaseAvailable && (
            <div className="cmf-badge-amber rounded-2xl px-3.5 py-2 text-xs">
              Lokaler Demo-Modus aktiv.
            </div>
          )}

          {loginError && (
            <div
              role="alert"
              data-testid="login-error-banner"
              className="cmf-badge-orange cmf-shake rounded-2xl px-3.5 py-2.5 text-xs"
            >
              {loginError}
            </div>
          )}

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={submitting || !typedName.trim() || !password.trim()}
            className="cmf-btn-primary flex min-h-[46px] w-full items-center justify-center px-5 py-2.5 text-sm font-medium"
          >
            {submitting
              ? 'Bitte warten …'
              : mode === 'REGISTER'
                ? 'Konto erstellen'
                : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
};
