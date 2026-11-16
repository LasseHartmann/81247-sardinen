import React, { useState } from 'react';
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react';

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
      <div className="cmf-chassis cmf-sheet-up my-auto w-full max-w-md p-5 sm:p-7">
        <div className="flex items-center gap-3.5">
          <div className="flex h-15 w-15 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#27272A] bg-black p-1 shadow-md">
            <img
              src="/logo.png"
              alt="81247 Sardinen Logo"
              className="h-full w-full bg-black object-contain"
            />
          </div>
          <div>
            <h1 className="font-dot text-2xl leading-tight font-bold text-[var(--text-main)]">
              81247 SARDINEN
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Outdoor-Versteckspiel für Gruppen in München
            </p>
          </div>
        </div>

        {/* Kurze 3-Schritte-Erklärung für Erstbesucher */}
        <div className="cmf-well mt-4 grid grid-cols-3 gap-1.5 p-2.5 text-center text-[11px] leading-tight">
          <div className="rounded-xl bg-white/75 px-2 py-1.5">
            <span className="font-dot block text-xs font-bold text-[var(--cmf-orange)]">
              1. Verstecken
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Ein Team versteckt sich
            </span>
          </div>
          <div className="rounded-xl bg-white/75 px-2 py-1.5">
            <span className="font-dot block text-xs font-bold text-[var(--cmf-teal)]">
              2. Tipps
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              Andere suchen per Karte
            </span>
          </div>
          <div className="rounded-xl bg-white/75 px-2 py-1.5">
            <span className="font-dot block text-xs font-bold text-[var(--text-main)]">
              3. Gefunden!
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              QR scannen &amp; mitverstecken
            </span>
          </div>
        </div>

        <div className="my-4 border-t cmf-divider" />

        {/* Modus-Umschalter: Anmelden vs. Konto erstellen */}
        <div className="cmf-well mb-4 grid grid-cols-2 gap-1.5 p-1">
          <button
            type="button"
            data-testid="auth-mode-login-btn"
            onClick={() => {
              setMode('LOGIN');
              onClearError();
            }}
            className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 font-tech text-xs font-bold uppercase transition-all ${
              mode === 'LOGIN'
                ? 'cmf-btn-active text-[var(--text-main)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Anmelden</span>
          </button>
          <button
            type="button"
            data-testid="auth-mode-register-btn"
            onClick={() => {
              setMode('REGISTER');
              onClearError();
            }}
            className={`inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 font-tech text-xs font-bold uppercase transition-all ${
              mode === 'REGISTER'
                ? 'cmf-btn-active text-[var(--text-main)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Konto erstellen</span>
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          <div>
            <label
              htmlFor="player-name-input"
              className="mb-1 block font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
            >
              Spielername
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
              placeholder={
                mode === 'REGISTER' ? 'Name wählen ...' : 'Dein Name ...'
              }
              className="cmf-input min-h-[48px] w-full px-4 py-2.5 text-base font-semibold"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor="player-password-input"
                className="font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
              >
                Passwort
              </label>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="inline-flex items-center gap-1 font-tech text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
              >
                {showPw ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" /> Verbergen
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Zeigen
                  </>
                )}
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
                mode === 'REGISTER' ? 'Mind. 4 Zeichen ...' : 'Dein Passwort ...'
              }
              className="cmf-input min-h-[48px] w-full px-4 py-2.5 text-base font-semibold"
            />
          </div>

          {!firebaseAvailable && (
            <div className="cmf-badge-amber rounded-xl p-2.5 text-xs font-medium">
              Lokaler Demo-Modus aktiv.
            </div>
          )}

          {loginError && (
            <div
              role="alert"
              data-testid="login-error-banner"
              className="cmf-badge-orange cmf-shake rounded-xl px-3.5 py-2.5 text-xs font-semibold"
            >
              {loginError}
            </div>
          )}

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={submitting || !typedName.trim() || !password.trim()}
            className="cmf-btn-primary font-dot flex min-h-[50px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold"
          >
            {mode === 'REGISTER' ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {submitting
              ? 'Prüfe ...'
              : mode === 'REGISTER'
                ? 'Konto erstellen'
                : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
};
