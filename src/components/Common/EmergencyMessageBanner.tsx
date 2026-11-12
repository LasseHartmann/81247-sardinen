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
      className="z-30 flex flex-col border-b-2 border-[var(--cmf-orange)] bg-[#0B0D10] text-[#F8FAFC] shadow-lg"
    >
      {messages.map((msg) => {
        const isSender = msg.uid === ownUid;
        const timeStr = formatClockHhMm(msg.createdAt);
        return (
          <div
            key={msg.uid}
            data-testid={`emergency-msg-${msg.playerId}`}
            className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 border-b border-dashed border-[#27272A] px-3 py-2.5 last:border-b-0"
          >
            <div className="flex items-start gap-2.5">
              <span className="nothing-red-dot mt-1.5" />
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
              <div className="text-xs leading-snug">
                <span className="font-tech text-[11px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
                  NOTFALL // {msg.senderName}
                  {timeStr ? ` [${timeStr}]` : ''}:
                </span>{' '}
                <span className="font-semibold text-[#F8FAFC]">{msg.text}</span>
              </div>
            </div>

            {isSender && (
              <button
                type="button"
                data-testid="delete-own-emergency-msg-btn"
                onClick={() => void onClearOwnMessage()}
                className="cmf-btn-primary font-dot inline-flex min-h-[34px] shrink-0 items-center gap-1.5 px-3 py-1 text-[11px]"
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
