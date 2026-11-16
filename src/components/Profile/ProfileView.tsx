import React, { useState } from 'react';
import {
  ArrowLeft,
  BatteryCharging,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Footprints,
  KeyRound,
  Lock,
  LogOut,
  Navigation,
  Radio,
  RotateCcw,
  Shield,
  Shuffle,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  Vibrate,
  Volume2,
} from 'lucide-react';
import {
  DEFAULT_CLASSIC_SEARCH_MINUTES,
  GAME_ID,
  getQuestionPenaltyMs,
} from '../../config/gameConfig';
import { getPlayerGreeting, isOverviewMember } from '../../config/players';
import {
  canPlayerUseExclusiveTier,
  createRandomSardineAvatar,
  DEFAULT_SARDINE_AVATAR,
  getExclusiveTierBadgeLabel,
  getExclusiveTierDescriptionDe,
  parseSardineAvatar,
  sanitizeSardineAvatarForPlayer,
  SARDINE_COLOR_OPTIONS,
  SARDINE_EXTRA_OPTIONS,
  SARDINE_GLASSES_OPTIONS,
  SARDINE_HAT_OPTIONS,
  serializeSardineAvatar,
  type SardineAvatarConfig,
  type SardineExclusiveTier,
} from '../../config/sardineAvatar';
import type { GpsPermissionState } from '../../hooks/useGeolocation';
import {
  deduplicateEnabledMembers,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import {
  getNotificationSupportState,
  playFeedbackSound,
  requestSystemNotificationPermission,
  triggerFeedbackVibration,
  type PlayerDevicePreferences,
} from '../../services/playerPreferencesService';
import type {
  GeoFix,
  MemberRecord,
  PlayerAllTimeStats,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import {
  formatDurationClock,
  formatPenaltyMinutes,
} from '../../utils/formatting';
import { PlayerAvatar } from '../Common/PlayerAvatar';

export interface ProfileViewProps {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  publicState: PublicGameState;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  connected: boolean;
  ownFix: GeoFix | null;
  gpsStatus: GpsPermissionState;
  gpsError: string | null;
  playerStats: PlayerAllTimeStats;
  devicePrefs: PlayerDevicePreferences;
  onChangeDevicePrefs: (next: PlayerDevicePreferences) => void;
  onSelectAvatar: (nextAvatar: string) => Promise<void>;
  onRetryGps: () => void;
  onReturnToLobbyByHost?: () => Promise<void>;
  onLeaveRoom?: () => Promise<void>;
  onLogout: () => Promise<void>;
}

function formatDistanceWalked(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  adapter,
  ownMember,
  ownTeam,
  publicState,
  members,
  presence,
  connected,
  ownFix,
  gpsStatus,
  gpsError,
  playerStats,
  devicePrefs,
  onChangeDevicePrefs,
  onSelectAvatar,
  onRetryGps,
  onReturnToLobbyByHost,
  onLeaveRoom,
  onLogout,
}) => {
  const roomCode = publicState.roomCode ?? GAME_ID;
  const [returningToLobby, setReturningToLobby] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarTab, setAvatarTab] = useState<
    'COLOR' | 'HAT' | 'GLASSES' | 'EXTRA'
  >('COLOR');
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [pwExpanded, setPwExpanded] = useState(false);
  const [gpsDiagExpanded, setGpsDiagExpanded] = useState(false);
  const [rulesModeTab, setRulesModeTab] = useState<'CLASSIC' | 'MANHUNT'>(
    (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC'
  );
  const [notifPermission, setNotifPermission] = useState(() =>
    getNotificationSupportState()
  );

  const isOverviewAccount = isOverviewMember(ownMember);

  const enabledMembers = deduplicateEnabledMembers(members, presence);
  const teammates = enabledMembers.filter((m) => {
    if (ownMember.side === 'HIDER') return m.side === 'HIDER';
    if (ownMember.side === 'SEEKER' && ownMember.teamId) {
      return m.side === 'SEEKER' && m.teamId === ownMember.teamId;
    }
    return false;
  });

  const searchDurationMs =
    publicState.classicSearchDurationMs ??
    DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000;
  const splitPenaltyMin = Math.round(
    getQuestionPenaltyMs('SPLIT_NS', searchDurationMs) / 60_000
  );
  const thermoPenaltyMin = Math.round(
    getQuestionPenaltyMs('THERMOMETER', searchDurationMs) / 60_000
  );
  const osmPenaltyMin = Math.round(
    getQuestionPenaltyMs('OSM_TRANSIT', searchDurationMs) / 60_000
  );
  const radarPenaltyMin = Math.round(
    getQuestionPenaltyMs('RADIUS_RADAR', searchDurationMs) / 60_000
  );
  const donutPenaltyMin = Math.round(
    getQuestionPenaltyMs('DONUT_RING', searchDurationMs) / 60_000
  );
  const photoPenaltyMin = Math.round(
    getQuestionPenaltyMs('MEDIA_SKY', searchDurationMs) / 60_000
  );

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

  const handleToggleNotifications = async () => {
    if (devicePrefs.notificationsEnabled) {
      onChangeDevicePrefs({
        ...devicePrefs,
        notificationsEnabled: false,
      });
      return;
    }
    const perm = await requestSystemNotificationPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      onChangeDevicePrefs({
        ...devicePrefs,
        notificationsEnabled: true,
      });
    }
  };

  return (
    <div
      data-testid="profile-view"
      className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]"
    >
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5 pb-12">
        {/* 1. Konto-Kopfzeile mit Avatar & persönlicher Begrüßung */}
        <div className="cmf-chassis cmf-card-enter p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="cmf-oled flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/15">
                <PlayerAvatar
                  avatar={ownMember.avatar}
                  playerId={ownMember}
                  size="lg"
                />
              </div>
              <div>
                <h2 className="font-dot text-xl sm:text-2xl text-[var(--text-main)]">
                  {ownMember.name}
                </h2>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  @{ownMember.playerId} • {getPlayerGreeting(ownMember)}
                </p>
              </div>
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
                    : 'KEIN TEAM'}
            </span>
          </div>
        </div>

        {/* 2. Anpassbarer Sardinen-Avatar & Accessoires (für Admin: erzwungenes Matrix-Icon) */}
        {isOverviewAccount ? (
          <section
            data-testid="profile-avatar-section"
            className="cmf-module p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-500" />
                <h3 className="font-industrial text-base text-[var(--text-main)]">
                  Matrix-System-Avatar (Admin)
                </h3>
              </div>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider text-emerald-700 uppercase">
                ERZWUNGEN // MATRIX-ICON
              </span>
            </div>

            <div className="cmf-oled flex items-center gap-4 rounded-2xl border border-emerald-500/40 p-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/30 bg-black p-1">
                <PlayerAvatar playerId={ownMember} size="xl" />
              </div>
              <div className="space-y-1">
                <span className="font-tech block text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
                  ROOT // MATRIX-SARDINE
                </span>
                <p className="font-industrial text-sm font-bold text-[#F8FAFC]">
                  Feste System-Identität für das Admin-Konto
                </p>
                <p className="text-xs text-slate-300">
                  Das Admin-Konto trägt dauerhaft das exklusive Matrix-Cyber-Icon.
                </p>
              </div>
            </div>
          </section>
        ) : (
          (() => {
          const currentSardine = parseSardineAvatar(ownMember.avatar, ownMember);
          const applySardineConfig = async (nextCfg: SardineAvatarConfig) => {
            const safeCfg = sanitizeSardineAvatarForPlayer(nextCfg, ownMember);
            const encoded = serializeSardineAvatar(safeCfg);
            setAvatarBusy(true);
            try {
              await onSelectAvatar(encoded);
            } finally {
              setAvatarBusy(false);
            }
          };

          const renderTierBadge = (
            tier: SardineExclusiveTier,
            unlocked: boolean
          ) => {
            const label = getExclusiveTierBadgeLabel(tier);
            if (!label) return null;
            const badgeStyle =
              tier === 'OWNER'
                ? 'bg-amber-400/20 text-amber-700 border-amber-500/40'
                : tier === 'DEVELOPER'
                  ? 'bg-sky-400/20 text-sky-700 border-sky-500/40'
                  : 'bg-[var(--cmf-orange)]/15 text-[var(--cmf-orange)] border-[var(--cmf-orange)]/35';
            return (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.2 font-tech text-[8px] font-bold tracking-wider uppercase ${badgeStyle}`}
              >
                {!unlocked && <Lock className="h-2.5 w-2.5" />}
                {label}
              </span>
            );
          };

          const activeColorLabel =
            SARDINE_COLOR_OPTIONS.find((c) => c.id === currentSardine.color)
              ?.label ?? 'Klassik-Silber';
          const activeHatLabel =
            SARDINE_HAT_OPTIONS.find((h) => h.id === currentSardine.hat)
              ?.label ?? 'Keine';
          const activeGlassesLabel =
            SARDINE_GLASSES_OPTIONS.find((g) => g.id === currentSardine.glasses)
              ?.label ?? 'Keine';
          const activeExtraLabel =
            SARDINE_EXTRA_OPTIONS.find((e) => e.id === currentSardine.extra)
              ?.label ?? 'Keins';

          return (
            <section
              data-testid="profile-avatar-section"
              className="cmf-module p-4 sm:p-5 space-y-3.5"
            >
              <div className="flex items-center gap-2 border-b cmf-divider pb-3">
                <Sparkles className="h-4 w-4 text-[var(--cmf-orange)]" />
                <h3 className="font-industrial text-base text-[var(--text-main)]">
                  Dein Sardinen-Avatar
                </h3>
              </div>

              {/* Große Live-Vorschau im OLED-Rahmen */}
              <div className="cmf-oled flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl p-3.5 sm:p-4">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-1">
                    <PlayerAvatar
                      config={currentSardine}
                      playerId={ownMember}
                      size="xl"
                    />
                  </div>
                  <div className="space-y-1 text-left">
                    <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--cmf-teal)] uppercase">
                      DEINE SARDINE
                    </span>
                    <div className="font-industrial text-sm font-bold text-[#F8FAFC]">
                      {activeColorLabel}
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px] text-slate-300">
                      <span className="rounded bg-white/10 px-1.5 py-0.5">
                        Kopf: {activeHatLabel}
                      </span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5">
                        Brille: {activeGlassesLabel}
                      </span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5">
                        Extra: {activeExtraLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex w-full sm:w-auto items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="avatar-randomize-btn"
                    disabled={avatarBusy}
                    onClick={() =>
                      void applySardineConfig(
                        createRandomSardineAvatar(ownMember)
                      )
                    }
                    className="cmf-btn-secondary font-tech inline-flex flex-1 sm:flex-initial min-h-[36px] items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                    <span>Zufall</span>
                  </button>
                  <button
                    type="button"
                    data-testid="avatar-reset-btn"
                    disabled={avatarBusy}
                    onClick={() =>
                      void applySardineConfig(DEFAULT_SARDINE_AVATAR)
                    }
                    className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center justify-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase"
                    title="Auf Klassik-Sardine zurücksetzen"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Kategorie-Reiter */}
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'COLOR', label: 'Farbe' },
                    { id: 'HAT', label: 'Kopf' },
                    { id: 'GLASSES', label: 'Brille' },
                    { id: 'EXTRA', label: 'Extras' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    data-testid={`avatar-tab-${tab.id.toLowerCase()}`}
                    onClick={() => setAvatarTab(tab.id)}
                    className={`min-h-[36px] rounded-xl font-tech text-[11px] font-bold uppercase transition-all ${
                      avatarTab === tab.id
                        ? 'cmf-btn-active ring-1 ring-[var(--cmf-orange)]'
                        : 'cmf-well hover:bg-white/80'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Options-Raster der gewählten Kategorie */}
              {avatarTab === 'COLOR' && (
                <div className="grid grid-cols-3 gap-2">
                  {SARDINE_COLOR_OPTIONS.map((opt) => {
                    const unlocked = canPlayerUseExclusiveTier(
                      opt.tier,
                      ownMember
                    );
                    const selected = currentSardine.color === opt.id;
                    const previewCfg: SardineAvatarConfig = {
                      ...currentSardine,
                      color: opt.id,
                    };
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={avatarBusy || !unlocked}
                        data-testid={`avatar-color-${opt.id}`}
                        title={
                          unlocked
                            ? opt.label
                            : `${opt.label} — ${getExclusiveTierDescriptionDe(opt.tier)}`
                        }
                        onClick={() => void applySardineConfig(previewCfg)}
                        className={`flex flex-col items-center justify-between gap-1 rounded-xl p-2 text-center transition-all ${
                          selected
                            ? 'cmf-btn-active ring-2 ring-[var(--cmf-orange)]'
                            : unlocked
                              ? 'cmf-well hover:bg-white/80'
                              : 'cmf-well opacity-55 cursor-not-allowed'
                        }`}
                      >
                        <PlayerAvatar config={previewCfg} size="md" />
                        <span className="font-tech text-[10px] font-bold leading-tight text-[var(--text-main)]">
                          {opt.label}
                        </span>
                        {renderTierBadge(opt.tier, unlocked)}
                      </button>
                    );
                  })}
                </div>
              )}

              {avatarTab === 'HAT' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SARDINE_HAT_OPTIONS.map((opt) => {
                    const unlocked = canPlayerUseExclusiveTier(
                      opt.tier,
                      ownMember
                    );
                    const selected = currentSardine.hat === opt.id;
                    const previewCfg: SardineAvatarConfig = {
                      ...currentSardine,
                      hat: opt.id,
                    };
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={avatarBusy || !unlocked}
                        data-testid={`avatar-hat-${opt.id}`}
                        title={
                          unlocked
                            ? opt.label
                            : `${opt.label} — ${getExclusiveTierDescriptionDe(opt.tier)}`
                        }
                        onClick={() => void applySardineConfig(previewCfg)}
                        className={`flex flex-col items-center justify-between gap-1 rounded-xl p-2 text-center transition-all ${
                          selected
                            ? 'cmf-btn-active ring-2 ring-[var(--cmf-orange)]'
                            : unlocked
                              ? 'cmf-well hover:bg-white/80'
                              : 'cmf-well opacity-55 cursor-not-allowed'
                        }`}
                      >
                        <PlayerAvatar config={previewCfg} size="md" />
                        <span className="font-tech text-[10px] font-bold leading-tight text-[var(--text-main)]">
                          {opt.label}
                        </span>
                        {renderTierBadge(opt.tier, unlocked)}
                      </button>
                    );
                  })}
                </div>
              )}

              {avatarTab === 'GLASSES' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SARDINE_GLASSES_OPTIONS.map((opt) => {
                    const unlocked = canPlayerUseExclusiveTier(
                      opt.tier,
                      ownMember
                    );
                    const selected = currentSardine.glasses === opt.id;
                    const previewCfg: SardineAvatarConfig = {
                      ...currentSardine,
                      glasses: opt.id,
                    };
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={avatarBusy || !unlocked}
                        data-testid={`avatar-glasses-${opt.id}`}
                        title={
                          unlocked
                            ? opt.label
                            : `${opt.label} — ${getExclusiveTierDescriptionDe(opt.tier)}`
                        }
                        onClick={() => void applySardineConfig(previewCfg)}
                        className={`flex flex-col items-center justify-between gap-1 rounded-xl p-2 text-center transition-all ${
                          selected
                            ? 'cmf-btn-active ring-2 ring-[var(--cmf-orange)]'
                            : unlocked
                              ? 'cmf-well hover:bg-white/80'
                              : 'cmf-well opacity-55 cursor-not-allowed'
                        }`}
                      >
                        <PlayerAvatar config={previewCfg} size="md" />
                        <span className="font-tech text-[10px] font-bold leading-tight text-[var(--text-main)]">
                          {opt.label}
                        </span>
                        {renderTierBadge(opt.tier, unlocked)}
                      </button>
                    );
                  })}
                </div>
              )}

              {avatarTab === 'EXTRA' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SARDINE_EXTRA_OPTIONS.map((opt) => {
                    const unlocked = canPlayerUseExclusiveTier(
                      opt.tier,
                      ownMember
                    );
                    const selected = currentSardine.extra === opt.id;
                    const previewCfg: SardineAvatarConfig = {
                      ...currentSardine,
                      extra: opt.id,
                    };
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={avatarBusy || !unlocked}
                        data-testid={`avatar-extra-${opt.id}`}
                        title={
                          unlocked
                            ? opt.label
                            : `${opt.label} — ${getExclusiveTierDescriptionDe(opt.tier)}`
                        }
                        onClick={() => void applySardineConfig(previewCfg)}
                        className={`flex flex-col items-center justify-between gap-1 rounded-xl p-2 text-center transition-all ${
                          selected
                            ? 'cmf-btn-active ring-2 ring-[var(--cmf-orange)]'
                            : unlocked
                              ? 'cmf-well hover:bg-white/80'
                              : 'cmf-well opacity-55 cursor-not-allowed'
                        }`}
                      >
                        <PlayerAvatar config={previewCfg} size="md" />
                        <span className="font-tech text-[10px] font-bold leading-tight text-[var(--text-main)]">
                          {opt.label}
                        </span>
                        {renderTierBadge(opt.tier, unlocked)}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()
        )}

        {/* 3. Statistik */}
        <section
          data-testid="profile-alltime-stats"
          className="cmf-module p-4 sm:p-5 space-y-3.5"
        >
          <div className="flex items-center gap-2 border-b cmf-divider pb-3">
            <Trophy className="h-4 w-4 text-[var(--cmf-amber)]" />
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Deine Statistik
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="cmf-well p-3 space-y-0.5">
              <span className="block font-tech text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                GESPIELTE RUNDEN
              </span>
              <span className="font-dot text-lg text-[var(--text-main)]">
                {playerStats.roundsPlayed}
              </span>
            </div>

            <div className="cmf-well p-3 space-y-0.5">
              <span className="block font-tech text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                SARDINEN GEFUNDEN
              </span>
              <span className="font-dot text-lg text-[var(--cmf-teal)]">
                {playerStats.catchesAsSeeker}
              </span>
            </div>

            <div className="cmf-well p-3 space-y-0.5">
              <span className="block font-tech text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                BESTE SUCHZEIT
              </span>
              <span className="font-dot text-lg text-[var(--text-main)]">
                {playerStats.bestSearchTimeMs !== null
                  ? formatDurationClock(playerStats.bestSearchTimeMs)
                  : '–'}
              </span>
            </div>

            <div className="cmf-well p-3 space-y-0.5">
              <span className="block font-tech text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                RUNDEN ALS SARDINE
              </span>
              <span className="font-dot text-lg text-[var(--cmf-orange)]">
                {playerStats.roundsAsHider}
              </span>
            </div>

            <div className="cmf-well p-3 space-y-0.5">
              <span className="block font-tech text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                LÄNGSTE VERSTECKZEIT
              </span>
              <span className="font-dot text-lg text-[var(--text-main)]">
                {playerStats.longestHiderTimeMs > 0
                  ? formatDurationClock(playerStats.longestHiderTimeMs)
                  : '–'}
              </span>
            </div>

            <div className="cmf-well p-3 space-y-0.5">
              <span className="flex items-center gap-1 font-tech text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                <Footprints className="h-3 w-3 text-[var(--cmf-teal)]" />
                STRECKE GELAUFEN
              </span>
              <span className="font-dot text-lg text-[var(--text-main)]">
                {formatDistanceWalked(playerStats.totalDistanceMeters)}
              </span>
            </div>
          </div>

          <div className="cmf-well flex items-center justify-between px-3 py-2 text-xs">
            <span className="font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
              GEKAUFTE TIPPS (TEAM)
            </span>
            <span className="font-dot text-sm font-bold text-[var(--text-main)]">
              {playerStats.cluesBought}
            </span>
          </div>
        </section>

        {/* 4. Team-Wahl & Aktuelle Team-Mitglieder */}
        {!isOverviewAccount && (
          <section
            data-testid="profile-team-section"
            className="cmf-module p-4 sm:p-5 space-y-3.5"
          >
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

            <div className="cmf-well p-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                  Aktuelle Mitglieder in deinem Team
                </span>
                <span className="font-tech text-[10px] text-[var(--text-muted)]">
                  Teamwechsel in der Lobby
                </span>
              </div>
              {teammates.length === 0 ? (
                <p className="text-[var(--text-muted)]">
                  Du bist aktuell in keinem Team eingeteilt. Wähle dein Team in der Lobby.
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
                      <PlayerAvatar
                        avatar={m.avatar}
                        playerId={m}
                        size="xs"
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
                    TIPPS
                  </span>
                  <span className="font-dot text-xs font-bold text-[var(--text-main)]">
                    {ownTeam.clueCount}
                  </span>
                </div>
                <div className="cmf-well p-2.5">
                  <span className="block font-tech text-[9px] font-bold text-[var(--text-muted)] uppercase">
                    TIPP-STRAFE
                  </span>
                  <span className="font-dot text-xs font-bold text-[var(--text-main)]">
                    {formatPenaltyMinutes(ownTeam.penaltyMs)}
                  </span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 5. Ton-, Vibrations-, Benachrichtigungs- & Energiespar-Einstellungen */}
        <section
          data-testid="profile-preferences-section"
          className="cmf-module p-4 sm:p-5 space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-[var(--cmf-teal)]" />
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Ton, Vibration, Hinweise &amp; Akku
              </h3>
            </div>
            <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              GERÄTE-OPTIONEN
            </span>
          </div>

          <div className="space-y-2.5">
            {/* Soundeffekte */}
            <div className="cmf-well p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                  <div>
                    <p className="text-xs font-bold text-[var(--text-main)]">
                      Synthesizer-Soundeffekte
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Akustische Signale bei Rundenstart, Radar-Kreisen, Foto-Anfragen &amp; Leash-Warnung.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      playFeedbackSound('TEST', {
                        ...devicePrefs,
                        soundEnabled: true,
                      })
                    }
                    className="cmf-btn-secondary font-tech min-h-[36px] px-2.5 py-1 text-[10px] font-bold uppercase"
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    role="switch"
                    data-testid="profile-sound-toggle"
                    aria-checked={devicePrefs.soundEnabled}
                    onClick={() => {
                      const next = {
                        ...devicePrefs,
                        soundEnabled: !devicePrefs.soundEnabled,
                      };
                      onChangeDevicePrefs(next);
                      if (next.soundEnabled) {
                        playFeedbackSound('TEST', next);
                      }
                    }}
                    className={`font-tech min-h-[36px] min-w-[64px] px-3 py-1 text-[11px] font-bold uppercase ${
                      devicePrefs.soundEnabled
                        ? 'cmf-btn-active'
                        : 'cmf-btn-secondary'
                    }`}
                  >
                    {devicePrefs.soundEnabled ? 'AN' : 'AUS'}
                  </button>
                </div>
              </div>

              {devicePrefs.soundEnabled && (
                <div className="flex items-center gap-3 border-t cmf-divider pt-2">
                  <span className="font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                    LAUTSTÄRKE ({Math.round(devicePrefs.soundVolume * 100)}%)
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.1}
                    aria-label="Ton-Lautstärke"
                    value={devicePrefs.soundVolume}
                    onChange={(e) => {
                      const vol = Number(e.target.value);
                      onChangeDevicePrefs({
                        ...devicePrefs,
                        soundVolume: vol,
                      });
                    }}
                    className="flex-1 accent-[var(--cmf-orange)]"
                  />
                </div>
              )}
            </div>

            {/* Vibrations-Alarm */}
            <div className="cmf-well flex items-center justify-between gap-3 p-3">
              <div className="flex items-start gap-2.5">
                <Vibrate className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
                <div>
                  <p className="text-xs font-bold text-[var(--text-main)]">
                    Vibrations-Alarm (Haptik)
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Vibriert auf unterstützten Smartphones bei Radar-Pings, Zonen-Warnung &amp; Notfällen.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    triggerFeedbackVibration('DOUBLE', {
                      ...devicePrefs,
                      vibrationEnabled: true,
                    })
                  }
                  className="cmf-btn-secondary font-tech min-h-[36px] px-2.5 py-1 text-[10px] font-bold uppercase"
                >
                  Test
                </button>
                <button
                  type="button"
                  role="switch"
                  data-testid="profile-vibration-toggle"
                  aria-checked={devicePrefs.vibrationEnabled}
                  onClick={() => {
                    const next = {
                      ...devicePrefs,
                      vibrationEnabled: !devicePrefs.vibrationEnabled,
                    };
                    onChangeDevicePrefs(next);
                    if (next.vibrationEnabled) {
                      triggerFeedbackVibration('SHORT', next);
                    }
                  }}
                  className={`font-tech min-h-[36px] min-w-[64px] px-3 py-1 text-[11px] font-bold uppercase ${
                    devicePrefs.vibrationEnabled
                      ? 'cmf-btn-active'
                      : 'cmf-btn-secondary'
                  }`}
                >
                  {devicePrefs.vibrationEnabled ? 'AN' : 'AUS'}
                </button>
              </div>
            </div>

            {/* System-Benachrichtigungen */}
            <div className="cmf-well flex items-center justify-between gap-3 p-3">
              <div className="flex items-start gap-2.5">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
                <div>
                  <p className="text-xs font-bold text-[var(--text-main)]">
                    Browser- / System-Benachrichtigungen
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {notifPermission === 'UNSUPPORTED'
                      ? 'Auf diesem Gerät/Browser nicht verfügbar.'
                      : notifPermission === 'denied'
                        ? 'Im Browser blockiert – bitte in den Browser-Einstellungen freigeben.'
                        : 'Informiert dich bei neuen Radar-Stufen, Foto-Anfragen & Notfall-Meldungen.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="profile-notifications-toggle"
                disabled={
                  notifPermission === 'UNSUPPORTED' ||
                  notifPermission === 'denied'
                }
                aria-checked={devicePrefs.notificationsEnabled}
                onClick={() => void handleToggleNotifications()}
                className={`font-tech min-h-[36px] min-w-[64px] shrink-0 px-3 py-1 text-[11px] font-bold uppercase disabled:opacity-40 ${
                  devicePrefs.notificationsEnabled
                    ? 'cmf-btn-active'
                    : 'cmf-btn-secondary'
                }`}
              >
                {devicePrefs.notificationsEnabled ? 'AN' : 'AUS'}
              </button>
            </div>

            {/* Energiespar-Modus */}
            <div className="cmf-well flex items-center justify-between gap-3 p-3">
              <div className="flex items-start gap-2.5">
                <BatteryCharging className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
                <div>
                  <p className="text-xs font-bold text-[var(--text-main)]">
                    Energiespar-Modus (Outdoor-Akku schonen)
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Deaktiviert Dauer-Animationen &amp; Unschärfe-Filter und nutzt ein akkuschonendes GPS-Intervall.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="profile-power-save-toggle"
                aria-checked={devicePrefs.powerSaveMode}
                onClick={() =>
                  onChangeDevicePrefs({
                    ...devicePrefs,
                    powerSaveMode: !devicePrefs.powerSaveMode,
                  })
                }
                className={`font-tech min-h-[36px] min-w-[64px] shrink-0 px-3 py-1 text-[11px] font-bold uppercase ${
                  devicePrefs.powerSaveMode
                    ? 'cmf-btn-active'
                    : 'cmf-btn-secondary'
                }`}
              >
                {devicePrefs.powerSaveMode ? 'AKTIV' : 'AUS'}
              </button>
            </div>
          </div>
        </section>

        {/* 6. Schnell-Spickzettel für die Spielregeln */}
        <section
          data-testid="profile-rules-cheatsheet"
          className="cmf-module p-4 sm:p-5 space-y-3"
        >
          <button
            type="button"
            data-testid="profile-rules-toggle-btn"
            onClick={() => setRulesExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[var(--cmf-orange)]" />
              <div>
                <h3 className="font-industrial text-base text-[var(--text-main)]">
                  Schnell-Spickzettel: Spielregeln &amp; Hinweis-Preise
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Alle Regeln für Klassisch (Sardinen) &amp; Manhunt kompakt zum Nachschlagen.
                </p>
              </div>
            </div>
            <span className="cmf-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
              {rulesExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </span>
          </button>

          {rulesExpanded && (
            <div className="space-y-3 border-t cmf-divider pt-3 text-xs">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setRulesModeTab('CLASSIC')}
                  className={`min-h-[36px] rounded-xl px-3 py-1.5 font-tech text-[11px] font-bold uppercase ${
                    rulesModeTab === 'CLASSIC'
                      ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
                      : 'cmf-well text-[var(--text-muted)]'
                  }`}
                >
                  Klassisch (Sardinen)
                </button>
                <button
                  type="button"
                  onClick={() => setRulesModeTab('MANHUNT')}
                  className={`min-h-[36px] rounded-xl px-3 py-1.5 font-tech text-[11px] font-bold uppercase ${
                    rulesModeTab === 'MANHUNT'
                      ? 'cmf-btn-active ring-1 ring-[var(--cmf-orange)]'
                      : 'cmf-well text-[var(--text-muted)]'
                  }`}
                >
                  Manhunt-Modus
                </button>
              </div>

              {rulesModeTab === 'CLASSIC' ? (
                <div className="space-y-2.5">
                  <div className="cmf-well p-3 space-y-1.5">
                    <p className="font-tech text-[10px] font-bold text-[var(--cmf-teal)] uppercase">
                      1. GRUNDSPIEL &amp; VERSTECK-LEASH (50 M)
                    </p>
                    <p className="leading-relaxed text-[var(--text-main)]">
                      <strong>Die Sardinen</strong> suchen sich in der Versteckzeit ein festes Versteck innerhalb der Versteck-Zone und fixieren ihren Ankerpunkt. Danach dürfen sie sich maximal <strong>50 m</strong> vom Anker entfernen.
                    </p>
                    <p className="leading-relaxed text-[var(--text-muted)]">
                      Findet ein Sucher-Team die Sardinen, scannt es den <strong>QR-Code</strong> (oder gibt den 6-stelligen Code ein) und <strong>versteckt sich heimlich mit</strong>, bis alle Teams angekommen sind! Es gewinnt das Team mit der kleinsten Gesamtzeit (Suchzeit + Hinweis-Strafzeiten).
                    </p>
                  </div>

                  <div className="cmf-well p-3 space-y-1.5">
                    <p className="font-tech text-[10px] font-bold text-[var(--cmf-orange)] uppercase">
                      2. HINWEIS-KATEGORIEN (AKTUELLE RUNDE: {Math.round(searchDurationMs / 60_000)} MIN.)
                    </p>
                    <ul className="space-y-1 text-[var(--text-main)]">
                      <li className="flex items-center justify-between gap-2">
                        <span>• Nord/Süd- oder Ost/West-Teilung, 45°-Peilung</span>
                        <strong className="font-tech">+{splitPenaltyMin} Min.</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>• Thermometer (Warm / Kalt zwischen A &amp; B)</span>
                        <strong className="font-tech">+{thermoPenaltyMin} Min.</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>• Radius-Radar (50 m – 1000 m Treffer-Check)</span>
                        <strong className="font-tech">+{radarPenaltyMin} Min.</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>• Umgebungs-Check (ÖPNV 150m, Wertstoffinsel, Grün)</span>
                        <strong className="font-tech">+{osmPenaltyMin} Min.</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>• Donut-Entfernungsring (200m-Bänder)</span>
                        <strong className="font-tech">+{donutPenaltyMin} Min.</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>• Live-Foto der Sardinen (Himmel / Boden / Selfie)</span>
                        <strong className="font-tech">+{photoPenaltyMin} Min.</strong>
                      </li>
                    </ul>
                  </div>

                  <div className="cmf-well p-3 space-y-1">
                    <p className="font-tech text-[10px] font-bold text-[var(--cmf-amber)] uppercase">
                      3. AUTOMATISCHES ENDSPIEL-SCHRUMPF-RADAR
                    </p>
                    <p className="leading-relaxed text-[var(--text-muted)]">
                      Im Verlauf der Suchzeit erscheint für alle Teams kostenlos ein schrumpfender Radar-Kreis um das Versteck (angepasst an die Kartengröße bis auf <strong>25 m</strong> im Endspiel).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="cmf-well p-3 space-y-1.5">
                    <p className="font-tech text-[10px] font-bold text-[var(--cmf-orange)] uppercase">
                      MANHUNT // DAUERHAFT IN BEWEGUNG
                    </p>
                    <p className="leading-relaxed text-[var(--text-main)]">
                      Die Verstecker haben <strong>kein festes Versteck</strong>, sondern bleiben in der aktiven Zone in Bewegung. Es gibt keine kaufbaren Hinweis-Fragen.
                    </p>
                    <p className="leading-relaxed text-[var(--text-muted)]">
                      Stattdessen wird regelmäßig ein <strong>Positions-Ping</strong> der Verstecker veröffentlicht (anfangs alle 10 Min., im Endspiel alle 5 Min.), während sich die erlaubte Spielzone Stufe für Stufe zusammenzieht!
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 7. Passwort ändern (einklappbar) */}
        <section className="cmf-module p-4 sm:p-5 space-y-3">
          <button
            type="button"
            onClick={() => setPwExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[var(--cmf-orange)]" />
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Passwort ändern
              </h3>
            </div>
            <span className="cmf-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
              {pwExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </span>
          </button>

          {pwExpanded && (
            <form
              onSubmit={handlePasswordSubmit}
              className="space-y-3 border-t cmf-divider pt-3"
            >
              <div>
                <label
                  htmlFor="profile-current-password"
                  className="mb-1 block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
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
                  placeholder="Aktuelles Passwort"
                  className="cmf-input w-full px-3.5 py-2.5 text-sm font-semibold"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="profile-new-password"
                    className="mb-1 block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
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
                    className="mb-1 block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
                  >
                    Wiederholen
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
                    placeholder="Neues Passwort bestätigen"
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
                  {pwBusy ? 'Speichere ...' : 'Passwort speichern'}
                </span>
              </button>
            </form>
          )}
        </section>

        {/* 8. GPS- & Verbindungs-Diagnose (einklappbar) */}
        <section className="cmf-module p-4 sm:p-5 space-y-3">
          <button
            type="button"
            onClick={() => setGpsDiagExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-[var(--cmf-teal)]" />
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                GPS &amp; Verbindung prüfen
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase ${
                  connected ? 'cmf-badge-teal' : 'cmf-badge-orange'
                }`}
              >
                {connected ? 'ONLINE' : 'OFFLINE'}
              </span>
              <span className="cmf-btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                {gpsDiagExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </span>
            </div>
          </button>

          {gpsDiagExpanded && (
            <div className="cmf-well p-3 space-y-1.5 border-t cmf-divider text-xs">
              <div className="flex items-center justify-between font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                <span className="flex items-center gap-1">
                  <Navigation className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                  GPS-ORTUNG
                </span>
                <span>
                  {gpsStatus === 'TRACKING'
                    ? `AKTIV (±${Math.round(ownFix?.accuracy ?? 0)} m)`
                    : gpsStatus === 'MANUAL_TEST'
                      ? 'TEST-PIN'
                      : gpsStatus === 'DENIED'
                        ? 'BLOCKIERT'
                        : 'SUCHE ...'}
                </span>
              </div>
              <p className="font-tech text-[11px] font-bold text-[var(--text-main)]">
                {ownFix
                  ? `${ownFix.lat.toFixed(5)}, ${ownFix.lng.toFixed(5)}`
                  : (gpsError ?? 'Noch kein GPS-Signal empfangen')}
              </p>
              <button
                type="button"
                onClick={onRetryGps}
                className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase"
              >
                <Radio className="h-3 w-3 text-[var(--cmf-orange)]" />
                GPS neu verbinden
              </button>
            </div>
          )}
        </section>

        {/* 9. Geordnete Aktionen am unteren Rand */}
        <section className="cmf-module p-4 sm:p-5 space-y-3">
          {onReturnToLobbyByHost && (
            <button
              type="button"
              data-testid="profile-host-return-lobby-btn"
              disabled={returningToLobby}
              onClick={async () => {
                setReturningToLobby(true);
                try {
                  await onReturnToLobbyByHost();
                } finally {
                  setReturningToLobby(false);
                }
              }}
              className="cmf-btn-secondary font-tech flex min-h-[42px] w-full items-center justify-center gap-1.5 border-[var(--cmf-orange)]/35 px-4 py-2 text-xs font-bold text-[var(--cmf-orange)] uppercase disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>
                {returningToLobby
                  ? 'Öffne Lobby ...'
                  : 'Runde beenden & zurück zur Lobby'}
              </span>
            </button>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {onLeaveRoom && (
              <button
                type="button"
                data-testid="profile-leave-room-btn"
                onClick={() => void onLeaveRoom()}
                className="cmf-btn-secondary font-tech inline-flex min-h-[44px] items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold uppercase"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Lobby wechseln ({roomCode})</span>
              </button>
            )}
            <button
              type="button"
              data-testid="profile-logout-btn"
              onClick={() => void onLogout()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[44px] items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-[var(--cmf-orange)] uppercase"
            >
              <LogOut className="h-4 w-4" />
              <span>Konto abmelden</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
