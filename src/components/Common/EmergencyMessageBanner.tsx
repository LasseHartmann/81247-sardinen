import React from 'react';
import { AlertOctagon, Trash2 } from 'lucide-react';
import type { EmergencyMessage } from '../../types/game';

export interface EmergencyMessageBannerProps {
  messages: EmergencyMessage[];
  ownUid: string;
  onClearOwnMessage: () => Promise<void>;
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
}) => {
  if (messages.length === 0) return null;

  return (
    <div
      role="alert"
      data-testid="emergency-messages-container"
      className="z-30 flex flex-col border-b-2 border-rose-500 bg-rose-950/95 text-rose-100 shadow-xl"
    >
      {messages.map((msg) => {
        const isSender = msg.uid === ownUid;
        const timeStr = formatClockHhMm(msg.createdAt);
        return (
          <div
            key={msg.uid}
            data-testid={`emergency-msg-${msg.playerId}`}
            className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 border-b border-rose-500/30 px-3 py-2.5 last:border-b-0"
          >
            <div className="flex items-start gap-2.5">
              <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div className="text-xs leading-snug">
                <span className="font-black tracking-wide text-rose-300 uppercase">
                  Notfallnachricht von {msg.senderName}
                  {timeStr ? ` (${timeStr})` : ''}:
                </span>{' '}
                <span className="font-bold text-white">{msg.text}</span>
              </div>
            </div>

            {isSender && (
              <button
                type="button"
                data-testid="delete-own-emergency-msg-btn"
                onClick={() => void onClearOwnMessage()}
                className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-900/80 px-2.5 py-1 text-xs font-extrabold text-white hover:bg-rose-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Nachricht löschen
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
