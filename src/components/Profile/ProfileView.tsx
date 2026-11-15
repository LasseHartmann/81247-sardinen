import React, { useState } from 'react';
import {
  CheckCircle2,
  Compass,
  KeyRound,
  LogOut,
  Navigation,
  Radio,
  Shield,
  Smartphone,
  Users,
  Wifi,
} from 'lucide-react';
import {
  formatPostalCodesLabel,
  getActivePostalCodes,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import { getPlayerGreeting, isOverviewMember } from '../../config/players';
import type { GpsPermissionState } from '../../hooks/useGeolocation';
import {
  deduplicateEnabledMembers,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import type {
  GeoFix,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import { formatPenaltyMinutes } from '../../utils/formatting';

export interface ProfileViewProps {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  publicState: PublicGameState;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  connected: boolean;
  ownFix: GeoFix | null;
  gpsStatus: GpsPermissionState;
  gpsError: string | null;
  onRetryGps: () => void;
  onSelectOwnRole?: (nextSelection: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  adapter,
  ownMember,
  ownTeam,
  publicState,
  members,
  presence,
  teamsPublic,
  connected,
  ownFix,
  gpsStatus,
  gpsError,
  onRetryGps,
  onSelectOwnRole,
  onLogout,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);

  const isOverviewAccount = isOverviewMember(ownMember);
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';
  const activePostalCodes = getActivePostalCodes(publicState.playArea);
  const activePostalCodesLabel = formatPostalCodesLabel(activePostalCodes);

  const ownSelectionValue =
    ownMember.side === 'HIDER'
      ? 'HIDER'
      : ownMember.side === 'SEEKER' && ownMember.teamId
        ? ownMember.teamId
        : 'UNASSIGNED';

  const enabledMembers = deduplicateEnabledMembers(members, presence);
  const teammates = enabledMembers.filter((m) => {
    if (ownMember.side === 'HIDER') return m.side === 'HIDER';
    if (ownMember.side === 'SEEKER' && ownMember.teamId) {
      return m.side === 'SEEKER' && m.teamId === ownMember.teamId;
    }
    return false;
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPassword.trim()) {
      setPwError('Bitte gib dein aktuelles Passwort ein.');
      return;
    }
    if (newPassword.trim().length < 4) {
      setPwError('Das neue Passwort muss mindestens 4 Zeichen lang sein.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    if (currentPassword === newPassword) {
      setPwError(
        'Das neue Passwort muss sich vom aktuellen Passwort unterscheiden.'
      );
      return;
    }

    setPwBusy(true);
    try {
      await adapter.changeAccountPassword({
        playerId: ownMember.playerId,
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Dein Passwort wurde erfolgreich geändert!');
    } catch (err) {
      setPwError(
        err instanceof Error
          ? err.message
          : 'Passwort konnte nicht geändert werden.'
      );
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div
      data-testid="profile-view"
      className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]"
    >
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5 pb-12">
        {/* 1. Konto-Kopfzeile & persönliche Begrüßung */}
        <div className="cmf-chassis cmf-card-enter p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider uppercase">
                SPIELER-PROFIL // @{ownMember.playerId}
              </span>
              <h2 className="font-dot mt-1 text-xl sm:text-2xl text-[var(--text-main)]">
                {ownMember.name}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {getPlayerGreeting(ownMember)}
              </p>
            </div>

            <span
              className={`rounded-full px-3 py-1 font-tech text-[10px] font-bold tracking-wider uppercase ${
                isOverviewAccount
                  ? 'cmf-badge-teal'
                  : ownMember.side === 'HIDER'
                    ? 'cmf-badge-orange'
                    : ownMember.side === 'SEEKER' && ownTeam
                      ? 'cmf-badge-teal'
                      : 'cmf-badge-amber'
              }`}
            >
              {isOverviewAccount
                ? 'SPIELLEITER (ADMIN)'
                : ownMember.side === 'HIDER'
                  ? 'VERSTECKER (DIE SARDINEN)'
                  : ownMember.side === 'SEEKER' && ownTeam
                    ? `SUCHER // ${ownTeam.name}`
                    : 'NOCH KEIN TEAM'}
            </span>
          </div>
        </div>

        {/* 2. Passwort ändern */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[var(--cmf-orange)]" />
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Passwort ändern
              </h3>
            </div>
            <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              SHA-256 GESICHERT
            </span>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="profile-current-password"
                className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase mb-1"
              >
                Aktuelles Passwort
              </label>
              <input
                id="profile-current-password"
                type="password"
                data-testid="profile-current-password-input"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  if (pwError) setPwError(null);
                  if (pwSuccess) setPwSuccess(null);
                }}
                placeholder="Dein bisheriges Passwort"
                className="cmf-input w-full px-3.5 py-2.5 text-sm font-semibold"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="profile-new-password"
                  className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase mb-1"
                >
                  Neues Passwort (mind. 4 Zeichen)
                </label>
                <input
                  id="profile-new-password"
                  type="password"
                  data-testid="profile-new-password-input"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (pwError) setPwError(null);
                    if (pwSuccess) setPwSuccess(null);
                  }}
                  placeholder="Neues Passwort"
                  className="cmf-input w-full px-3.5 py-2.5 text-sm font-semibold"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-confirm-password"
                  className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase mb-1"
                >
                  Neues Passwort bestätigen
                </label>
                <input
                  id="profile-confirm-password"
                  type="password"
                  data-testid="profile-confirm-password-input"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (pwError) setPwError(null);
                    if (pwSuccess) setPwSuccess(null);
                  }}
                  placeholder="Neues Passwort wiederholen"
                  className="cmf-input w-full px-3.5 py-2.5 text-sm font-semibold"
                />
              </div>
            </div>

            {pwError && (
              <div
                data-testid="profile-password-error"
                className="cmf-badge-orange cmf-shake rounded-xl px-3 py-2 text-xs font-semibold"
              >
                {pwError}
              </div>
            )}

            {pwSuccess && (
              <div
                data-testid="profile-password-success"
                className="cmf-badge-teal flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{pwSuccess}</span>
              </div>
            )}

            <button
              type="submit"
              data-testid="profile-change-password-btn"
              disabled={pwBusy}
              className="cmf-btn-primary font-dot inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              <span>
                {pwBusy ? 'Wird gespeichert ...' : 'Passwort speichern'}
              </span>
            </button>
          </form>
        </section>

        {/* 3. Team-Wahl & Aktuelle Team-Mitglieder */}
        {!isOverviewAccount && (
          <section className="cmf-module p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--cmf-teal)]" />
                <h3 className="font-industrial text-base text-[var(--text-main)]">
                  Dein Team &amp; Mitspieler
                </h3>
              </div>
              <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                {teammates.length} IM TEAM
              </span>
            </div>

            {onSelectOwnRole && (
              <div className="space-y-1.5">
                <label
                  htmlFor="profile-role-select"
                  className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
                >
                  Eigenes Team wählen / wechseln
                </label>
                <select
                  id="profile-role-select"
                  data-testid="profile-role-select"
                  disabled={roleBusy}
                  value={ownSelectionValue}
                  onChange={async (e) => {
                    const nextVal = e.target.value;
                    setRoleBusy(true);
                    try {
                      await onSelectOwnRole(nextVal);
                    } finally {
                      setRoleBusy(false);
                    }
                  }}
                  className="cmf-input min-h-[44px] w-full px-3 py-2 text-sm font-bold"
                >
                  <option value="UNASSIGNED">
                    — Bitte Team wählen (Noch nicht eingeteilt) —
                  </option>
                  <option value="HIDER">Verstecker (Die Sardinen)</option>
                  {TEAM_PALETTE.map((t) => {
                    const count =
                      teamsPublic[t.id]?.memberPlayerIds.length ?? 0;
                    return (
                      <option key={t.id} value={t.id}>
                        Sucher: {t.name} ({count} Spieler)
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="cmf-well p-3 space-y-2 text-xs">
              <span className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                Aktuelle Mitglieder in deinem Team
              </span>
              {teammates.length === 0 ? (
                <p className="text-[var(--text-muted)]">
                  Du hast aktuell noch kein Team ausgewählt.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {teammates.map((m) => (
                    <span
                      key={m.uid}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-bold text-[var(--text-main)]"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            ownMember.side === 'HIDER'
                              ? 'var(--cmf-orange)'
                              : (ownTeam?.color ?? 'var(--cmf-teal)'),
                        }}
                      />
                      <span>{m.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {ownMember.side === 'SEEKER' && ownTeam && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="cmf-well p-2.5">
                  <span className="block font-tech text-[9px] font-bold text-[var(--text-muted)] uppercase">
                    STATUS
                  </span>
                  <span className="font-dot text-xs font-bold text-[var(--text-main)]">
                    {ownTeam.status === 'JOINED_SARDINES'
                      ? 'BEI SARDINEN'
                      : 'SUCHT'}
                  </span>
                </div>
                <div className="cmf-well p-2.5">
                  <span className="block font-tech text-[9px] font-bold text-[var(--text-muted)] uppercase">
                    HINWEISE
                  </span>
                  <span className="font-dot text-xs font-bold text-[var(--text-main)]">
                    {ownTeam.clueCount}
                  </span>
                </div>
                <div className="cmf-well p-2.5">
                  <span className="block font-tech text-[9px] font-bold text-[var(--text-muted)] uppercase">
                    ZEIT-BONUS/STRAFE
                  </span>
                  <span className="font-dot text-xs font-bold text-[var(--text-main)]">
                    {formatPenaltyMinutes(ownTeam.penaltyMs)}
                  </span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 4. Geräte-, GPS- & Verbindungs-Diagnose */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-[var(--cmf-teal)]" />
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Gerät, GPS &amp; Runden-Info
              </h3>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase ${
                connected ? 'cmf-badge-teal' : 'cmf-badge-orange'
              }`}
            >
              {connected ? 'SERVER ONLINE' : 'OFFLINE'}
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
            <div className="cmf-well p-3 space-y-1">
              <div className="flex items-center justify-between font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                <span className="flex items-center gap-1">
                  <Navigation className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                  GPS-ORTUNG
                </span>
                <span>
                  {gpsStatus === 'TRACKING'
                    ? `AKTIV (±${Math.round(ownFix?.accuracy ?? 0)}M)`
                    : gpsStatus === 'MANUAL_TEST'
                      ? 'TEST-KLICK'
                      : gpsStatus === 'DENIED'
                        ? 'BLOCKIERT'
                        : 'SUCHE ...'}
                </span>
              </div>
              <p className="font-tech text-[11px] font-bold text-[var(--text-main)]">
                {ownFix
                  ? `${ownFix.lat.toFixed(5)}, ${ownFix.lng.toFixed(5)}`
                  : (gpsError ?? 'Noch keine GPS-Koordinaten empfangen')}
              </p>
              <button
                type="button"
                onClick={onRetryGps}
                className="cmf-btn-secondary font-tech mt-1 inline-flex min-h-[34px] items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase"
              >
                <Radio className="h-3 w-3 text-[var(--cmf-orange)]" />
                GPS neu synchronisieren
              </button>
            </div>

            <div className="cmf-well p-3 space-y-1.5">
              <div className="flex items-center justify-between font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                <span className="flex items-center gap-1">
                  <Compass className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  AKTIVES SPIELFELD
                </span>
                <span>{isManhunt ? 'MANHUNT' : 'KLASSISCH'}</span>
              </div>
              <p className="font-tech text-[11px] font-bold text-[var(--text-main)]">
                {publicState.playArea.shapeType === 'CUSTOM_CIRCLE'
                  ? `Kreis in ${activePostalCodesLabel} (R = ${publicState.playArea.circle?.radiusMeters ?? 500} m)`
                  : `Versteck-Zone: ${activePostalCodesLabel}`}
              </p>
              <div className="flex items-center gap-1.5 font-tech text-[10px] text-[var(--text-muted)] uppercase">
                <Wifi className="h-3 w-3 text-[var(--cmf-teal)]" />
                <span>Display-Wachhalter (Wake-Lock) aktiv</span>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Konto abmelden / wechseln */}
        <section className="cmf-module p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <div>
              <h3 className="font-industrial text-sm text-[var(--text-main)]">
                Konto wechseln / Abmelden
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Meldet dich auf diesem Gerät von @{ownMember.playerId} ab.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="profile-logout-btn"
            onClick={() => void onLogout()}
            className="cmf-btn-secondary font-tech inline-flex min-h-[42px] items-center gap-1.5 px-4 py-2 text-xs font-bold text-[var(--cmf-orange)] uppercase"
          >
            <LogOut className="h-4 w-4" />
            <span>Abmelden</span>
          </button>
        </section>
      </div>
    </div>
  );
};
