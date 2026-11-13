import React from 'react';
import { AlertOctagon, MapPin, Trash2 } from 'lucide-react';
import type { EmergencyMessage } from '../../types/game';

export interface EmergencyMessageBannerProps {
  messages: EmergencyMessage[];
  ownUid: string;
  onClearOwnMessage: () => Promise<void>;
  onLocateMessage?: (lat: number, lng: number) => void;
}

function formatClockHhMm(timestampMs: number): string {
  if (!timestampMs) return '';
  try {
    const d = new Date(timestampMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

export const EmergencyMessageBanner: React.FC<EmergencyMessageBannerProps> = ({
  messages,
  ownUid,
  onClearOwnMessage,
  onLocateMessage,
}) => {
  if (messages.length === 0) return null;

  return (
    <div
      role="alert"
      data-testid="emergency-messages-container"
      className="z-30 flex flex-col border-b-2 border-[#FCA5A5] bg-[#991B1B] text-white shadow-[0_6px_24px_rgba(220,38,38,0.5)]"
    >
      {messages.map((msg) => {
        const isSender = msg.uid === ownUid;
        const timeStr = formatClockHhMm(msg.createdAt);
        const hasCoords =
          typeof msg.lat === 'number' &&
          Number.isFinite(msg.lat) &&
          typeof msg.lng === 'number' &&
          Number.isFinite(msg.lng);

        return (
          <div
            key={msg.uid}
            data-testid={`emergency-msg-${msg.playerId}`}
            className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 border-b border-dashed border-white/25 px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-ping rounded-full bg-white" />
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-[#FECACA]" />
              <div className="min-w-0 text-xs leading-snug">
                <div>
                  <span className="font-tech text-[11px] font-bold tracking-wider text-[#FEE2E2] uppercase">
                    NOTFALL // {msg.senderName}
                    {timeStr ? ` [${timeStr}]` : ''}:
                  </span>{' '}
                  <span className="font-bold text-white">{msg.text}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 font-tech text-[10px] text-[#FECACA]">
                  {hasCoords ? (
                    <span data-testid={`emergency-coords-${msg.playerId}`}>
                      STANDORT: {msg.lat!.toFixed(5)}, {msg.lng!.toFixed(5)}
                      {typeof msg.accuracy === 'number'
                        ? ` (±${Math.round(msg.accuracy)}m)`
                        : ''}
                    </span>
                  ) : (
                    <span>STANDORT WIRD ERMITTELT ...</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {hasCoords && onLocateMessage && (
                <button
                  type="button"
                  data-testid={`locate-emergency-${msg.playerId}`}
                  onClick={() => onLocateMessage(msg.lat!, msg.lng!)}
                  className="font-tech inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-white/40 bg-[#7F1D1D] px-2.5 py-1 text-[11px] font-bold text-white uppercase shadow hover:bg-[#450A0A] active:scale-95"
                >
                  <MapPin className="h-3.5 w-3.5 text-[#FCA5A5]" />
                  <span>Standort zeigen</span>
                </button>
              )}

              {isSender && (
                <button
                  type="button"
                  data-testid="delete-own-emergency-msg-btn"
                  onClick={() => void onClearOwnMessage()}
                  className="font-dot inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-1 text-[11px] font-bold text-[#991B1B] shadow hover:bg-[#FEE2E2]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Löschen</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
