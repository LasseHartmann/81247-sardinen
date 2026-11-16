import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Search,
  Shield,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import { isAdminAccountId, isOverviewMember } from '../../config/players';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import type { AccountPublicRecord } from '../../types/game';
import { PlayerAvatar } from '../Common/PlayerAvatar';

export interface AdminAccountManagerProps {
  adapter: DatabaseAdapter;
  defaultCollapsed?: boolean;
}

type AccountFilter = 'ALL' | 'ACTIVE' | 'BLOCKED';

function formatCreatedDate(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return 'Unbekannt';
  try {
    return new Date(ts).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return 'Unbekannt';
  }
}

export const AdminAccountManager: React.FC<AdminAccountManagerProps> = ({
  adapter,
  defaultCollapsed = false,
}) => {
  const [accountsMap, setAccountsMap] = useState<
    Record<string, AccountPublicRecord>
  >({});
  const [filter, setFilter] = useState<AccountFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const [resettingPwForId, setResettingPwForId] = useState<string | null>(null);
  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    playerId: string;
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    const unsub = adapter.subscribeAllAccounts((map) => {
      setAccountsMap(map ?? {});
    });
    return unsub;
  }, [adapter]);

  const allAccounts = useMemo(() => {
    return Object.values(accountsMap)
      .filter((acct) => !isOverviewMember(acct))
      .sort((a, b) => {
        if (Boolean(a.blocked) !== Boolean(b.blocked)) {
          return a.blocked ? -1 : 1;
        }
        return (a.name || a.playerId).localeCompare(b.name || b.playerId, 'de');
      });
  }, [accountsMap]);

  const blockedCount = useMemo(
    () => allAccounts.filter((a) => Boolean(a.blocked)).length,
    [allAccounts]
  );

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allAccounts.filter((acct) => {
      if (filter === 'ACTIVE' && acct.blocked) return false;
      if (filter === 'BLOCKED' && !acct.blocked) return false;
      if (!q) return true;
      return (
        acct.playerId.toLowerCase().includes(q) ||
        (acct.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [allAccounts, filter, searchQuery]);

  const handleResetPassword = async (playerId: string) => {
    setFeedback(null);
    setBusyId(playerId);
    try {
      await adapter.resetAccountPasswordByAdmin(playerId, newPasswordDraft);
      setResettingPwForId(null);
      setNewPasswordDraft('');
      setFeedback({
        playerId,
        kind: 'success',
        text: 'Passwort wurde zurückgesetzt.',
      });
    } catch (err) {
      setFeedback({
        playerId,
        kind: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Passwort konnte nicht zurückgesetzt werden.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleBlock = async (acct: AccountPublicRecord) => {
    setFeedback(null);
    setBusyId(acct.playerId);
    try {
      const nextBlocked = !acct.blocked;
      await adapter.setAccountBlockedByAdmin(acct.playerId, nextBlocked);
      setFeedback({
        playerId: acct.playerId,
        kind: 'success',
        text: nextBlocked
          ? `Konto „${acct.name}“ wurde gesperrt.`
          : `Konto „${acct.name}“ wurde wieder freigegeben.`,
      });
    } catch (err) {
      setFeedback({
        playerId: acct.playerId,
        kind: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Konto-Status konnte nicht geändert werden.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteAccount = async (acct: AccountPublicRecord) => {
    setFeedback(null);
    setBusyId(acct.playerId);
    try {
      await adapter.deleteAccountByAdmin(acct.playerId);
      setConfirmDeleteId(null);
    } catch (err) {
      setFeedback({
        playerId: acct.playerId,
        kind: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Konto konnte nicht gelöscht werden.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      data-testid="admin-account-manager"
      className="cmf-module space-y-3.5 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-[#020804] text-[#00FF41]">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-emerald-500/40 bg-[#020804] px-2 py-0.5 font-tech text-[9px] font-bold tracking-wider text-[#00FF41] uppercase">
                ADMIN // KONTO-VERWALTUNG
              </span>
              <span className="cmf-well rounded-full px-2 py-0.5 font-tech text-[9px] font-bold text-[var(--text-muted)] uppercase">
                {allAccounts.length} Konten
              </span>
              {blockedCount > 0 && (
                <span className="cmf-badge-orange rounded-full px-2 py-0.5 font-tech text-[9px] font-bold uppercase">
                  {blockedCount} Gesperrt
                </span>
              )}
            </div>
            <h2 className="font-industrial mt-0.5 text-sm font-bold text-[var(--text-main)] sm:text-base">
              Spielerkonten verwalten (Passwort, Sperren &amp; Löschen)
            </h2>
          </div>
        </div>

        <button
          type="button"
          data-testid="admin-accounts-collapse-btn"
          onClick={() => setCollapsed((prev) => !prev)}
          className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase"
        >
          <span>{collapsed ? 'Ausklappen' : 'Einklappen'}</span>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-3">
          {/* Suchfeld & Filter */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                data-testid="admin-accounts-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Spieler oder @ID suchen ..."
                className="cmf-input min-h-[38px] w-full pr-3 pl-8 text-xs font-medium"
              />
            </div>

            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'ALL', label: `Alle (${allAccounts.length})` },
                  {
                    id: 'ACTIVE',
                    label: `Aktiv (${allAccounts.length - blockedCount})`,
                  },
                  { id: 'BLOCKED', label: `Gesperrt (${blockedCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`admin-accounts-filter-${tab.id.toLowerCase()}`}
                  onClick={() => setFilter(tab.id)}
                  className={`min-h-[34px] rounded-xl px-2.5 py-1 font-tech text-[10px] font-bold uppercase transition-all ${
                    filter === tab.id
                      ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
                      : 'cmf-well hover:bg-white/80'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredAccounts.length === 0 ? (
            <div className="cmf-well p-4 text-center text-xs text-[var(--text-muted)]">
              Keine passenden Spielerkonten gefunden.
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-0.5">
              {filteredAccounts.map((acct) => {
                const isRootAdmin = isAdminAccountId(acct.playerId);
                const isBusy = busyId === acct.playerId;
                const isResettingPw = resettingPwForId === acct.playerId;
                const isConfirmingDelete = confirmDeleteId === acct.playerId;
                const acctFeedback =
                  feedback?.playerId === acct.playerId ? feedback : null;
                const roundsPlayed = acct.stats?.roundsPlayed ?? 0;

                return (
                  <div
                    key={acct.playerId}
                    data-testid={`admin-account-card-${acct.playerId}`}
                    className={`cmf-well space-y-2.5 p-3 transition-all ${
                      acct.blocked
                        ? 'border border-[#DC2626]/40 bg-[#DC2626]/5'
                        : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <PlayerAvatar
                          avatar={acct.avatar}
                          playerId={acct}
                          size="md"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-industrial truncate text-sm font-bold text-[var(--text-main)]">
                              {acct.name || acct.playerId}
                            </span>
                            <span className="font-tech text-[10px] text-[var(--text-muted)]">
                              @{acct.playerId}
                            </span>
                            {isRootAdmin ? (
                              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-[#020804] px-1.5 py-0.5 font-tech text-[9px] font-bold text-[#00FF41] uppercase">
                                <Shield className="h-2.5 w-2.5" />
                                MATRIX-ADMIN
                              </span>
                            ) : acct.blocked ? (
                              <span
                                data-testid={`admin-account-blocked-badge-${acct.playerId}`}
                                className="cmf-badge-orange rounded px-1.5 py-0.5 font-tech text-[9px] font-bold uppercase"
                              >
                                GESPERRT
                              </span>
                            ) : (
                              <span className="cmf-badge-teal rounded px-1.5 py-0.5 font-tech text-[9px] font-bold uppercase">
                                AKTIV
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-tech text-[10px] text-[var(--text-muted)]">
                            <span>
                              Erstellt: {formatCreatedDate(acct.createdAt)}
                            </span>
                            <span>•</span>
                            <span>{roundsPlayed} Runden</span>
                          </div>
                        </div>
                      </div>

                      {!isRootAdmin && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`admin-acct-reset-pw-btn-${acct.playerId}`}
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmDeleteId(null);
                              setFeedback(null);
                              if (isResettingPw) {
                                setResettingPwForId(null);
                                setNewPasswordDraft('');
                              } else {
                                setResettingPwForId(acct.playerId);
                                setNewPasswordDraft('');
                              }
                            }}
                            className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase"
                          >
                            <KeyRound className="h-3 w-3" />
                            <span>Passwort</span>
                          </button>

                          <button
                            type="button"
                            data-testid={`admin-acct-toggle-block-btn-${acct.playerId}`}
                            disabled={isBusy}
                            onClick={() => void handleToggleBlock(acct)}
                            className={`cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase ${
                              acct.blocked
                                ? 'text-[var(--cmf-teal)]'
                                : 'text-amber-700'
                            }`}
                          >
                            {acct.blocked ? (
                              <>
                                <Unlock className="h-3 w-3" />
                                <span>Freigeben</span>
                              </>
                            ) : (
                              <>
                                <Ban className="h-3 w-3" />
                                <span>Sperren</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            data-testid={`admin-acct-delete-btn-${acct.playerId}`}
                            disabled={isBusy}
                            onClick={() => {
                              setResettingPwForId(null);
                              setFeedback(null);
                              setConfirmDeleteId(
                                isConfirmingDelete ? null : acct.playerId
                              );
                            }}
                            className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#DC2626] uppercase"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Löschen</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Inline Passwort-Reset */}
                    {isResettingPw && (
                      <div className="flex flex-col gap-2 rounded-xl border border-[var(--shell-border)] bg-white/80 p-2.5 sm:flex-row sm:items-center">
                        <input
                          type="password"
                          data-testid={`admin-acct-new-pw-input-${acct.playerId}`}
                          value={newPasswordDraft}
                          onChange={(e) => setNewPasswordDraft(e.target.value)}
                          placeholder={`Neues Passwort für ${acct.name} (mind. 4 Zeichen)`}
                          className="cmf-input min-h-[36px] flex-1 px-3 py-1 text-xs"
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`admin-acct-save-pw-btn-${acct.playerId}`}
                            disabled={
                              isBusy || newPasswordDraft.trim().length < 4
                            }
                            onClick={() =>
                              void handleResetPassword(acct.playerId)
                            }
                            className="cmf-btn-primary font-tech inline-flex min-h-[36px] items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Speichern</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResettingPwForId(null);
                              setNewPasswordDraft('');
                            }}
                            className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center px-2.5 py-1 text-[10px] font-bold uppercase"
                          >
                            Abbrechen
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Inline Lösch-Bestätigung */}
                    {isConfirmingDelete && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/10 px-3 py-2">
                        <span className="font-tech text-[10px] font-bold text-[#DC2626] uppercase">
                          Konto „{acct.name}“ (@{acct.playerId}) endgültig löschen?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`admin-acct-confirm-delete-btn-${acct.playerId}`}
                            disabled={isBusy}
                            onClick={() => void handleDeleteAccount(acct)}
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-[#DC2626] px-2.5 py-1 font-tech text-[10px] font-bold text-white uppercase hover:opacity-90 disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Endgültig löschen</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center px-2.5 py-1 text-[10px] font-bold uppercase"
                          >
                            Abbrechen
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Rückmeldung */}
                    {acctFeedback && (
                      <div
                        className={`rounded-lg px-2.5 py-1.5 font-tech text-[10px] font-bold uppercase ${
                          acctFeedback.kind === 'success'
                            ? 'cmf-badge-teal'
                            : 'cmf-badge-orange'
                        }`}
                      >
                        {acctFeedback.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
