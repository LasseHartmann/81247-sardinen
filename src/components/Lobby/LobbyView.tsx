import React, { useState } from 'react';

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
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#1C1917] p-1">
            <img
              src="/logo.png"
              alt="81247 Sardinen"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-main)]">
              81247 Sardinen
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              München · Verstecken mit Karte
            </p>
          </div>
        </div>

        {/* Modus-Umschalter: Anmelden vs. Konto erstellen */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--module-sub)] p-1">
          <button
            type="button"
            data-testid="auth-mode-login-btn"
            onClick={() => {
              setMode('LOGIN');
              onClearError();
            }}
            className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'LOGIN'
                ? 'bg-white text-[var(--text-main)] shadow-xs'
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
            className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'REGISTER'
                ? 'bg-white text-[var(--text-main)] shadow-xs'
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
              className="mb-1 block text-xs font-medium text-[var(--text-main)]"
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
              className="cmf-input min-h-[44px] w-full px-3.5 py-2 text-base font-medium"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor="player-password-input"
                className="text-xs font-medium text-[var(--text-main)]"
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
              className="cmf-input min-h-[44px] w-full px-3.5 py-2 text-base font-medium"
            />
          </div>

          {!firebaseAvailable && (
            <div className="cmf-badge-amber rounded-lg px-3 py-2 text-xs">
              Lokaler Demo-Modus aktiv.
            </div>
          )}

          {loginError && (
            <div
              role="alert"
              data-testid="login-error-banner"
              className="cmf-badge-orange cmf-shake rounded-lg px-3 py-2 text-xs"
            >
              {loginError}
            </div>
          )}

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={submitting || !typedName.trim() || !password.trim()}
            className="cmf-btn-primary flex min-h-[46px] w-full items-center justify-center px-4 py-2.5 text-sm font-semibold"
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
