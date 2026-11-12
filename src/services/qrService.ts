import type { QrCatchPayload } from '../types/game';

/**
 * Verwechslungsfreies Alphabet ohne 0, O, 1, I (32 Zeichen).
 */
export const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function getCryptoBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/**
 * Erzeugt eine eindeutige Session-/Objekt-ID.
 */
export function generateRandomId(prefix = 'id'): string {
  const bytes = getCryptoBytes(8);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${hex}`;
}

/**
 * Generiert für eine Spielrunde ein kryptographisches 128-Bit-Secret (Hex)
 * sowie einen 6-stelligen gut ablesbaren Ersatzcode ohne 0/O/1/I.
 */
export function generateSessionSecrets(): {
  qrSecret: string;
  shortCode: string;
} {
  const secretBytes = getCryptoBytes(16); // 128 Bit
  const qrSecret = Array.from(secretBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const codeBytes = getCryptoBytes(6);
  let shortCode = '';
  for (let i = 0; i < 6; i++) {
    shortCode += UNAMBIGUOUS_ALPHABET[codeBytes[i] % UNAMBIGUOUS_ALPHABET.length];
  }

  return { qrSecret, shortCode };
}

/**
 * Erstellt das JSON-Payload für den Verstecker-QR-Code.
 */
export function serializeQrPayload(
  sessionId: string,
  qrSecret: string,
  shortCode: string
): string {
  const payload: QrCatchPayload = {
    gameId: '81247',
    sessionId,
    secret: qrSecret,
    shortCode,
  };
  return JSON.stringify(payload);
}

/**
 * Extrahiert aus einem rohen Kamera-Scan oder einer manuellen Texteingabe
 * den relevanten Code/Secret sowie optional eine mitgelieferte sessionId.
 */
export function parseSubmittedCatchInput(rawInput: string): {
  extractedCodeOrSecret: string;
  embeddedSessionId?: string;
  wrongGameId?: boolean;
} {
  const trimmed = rawInput.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<QrCatchPayload>;
      if (parsed.gameId && parsed.gameId !== '81247') {
        return { extractedCodeOrSecret: '', wrongGameId: true };
      }
      return {
        extractedCodeOrSecret: (parsed.secret ?? parsed.shortCode ?? '').trim(),
        embeddedSessionId: parsed.sessionId,
      };
    } catch {
      // Fallback als Klartext behandeln
    }
  }
  return {
    extractedCodeOrSecret: trimmed.toUpperCase(),
  };
}

/**
 * Prüft deterministisch, ob ein eingereichter Catch-Code zum geheimen Runden-Secret
 * oder dem 6-stelligen Ersatzcode der aktuellen Session passt.
 */
export function verifyCatchSubmission(
  submittedCodeOrSecret: string,
  requestSessionId: string,
  activeSessionId: string,
  expectedQrSecret: string,
  expectedShortCode: string
): { valid: boolean; reason?: string } {
  if (!activeSessionId || requestSessionId !== activeSessionId) {
    return {
      valid: false,
      reason: 'Ungültige Spielrunde (Code stammt aus einer älteren Sitzung).',
    };
  }
  const parsed = parseSubmittedCatchInput(submittedCodeOrSecret);
  if (parsed.wrongGameId) {
    return { valid: false, reason: 'Falscher Spiel-QR-Code.' };
  }
  if (parsed.embeddedSessionId && parsed.embeddedSessionId !== activeSessionId) {
    return {
      valid: false,
      reason: 'Abgelaufener QR-Code aus einer früheren Runde.',
    };
  }
  const candidate = parsed.extractedCodeOrSecret.trim();
  if (!candidate) {
    return { valid: false, reason: 'Kein gültiger Code übermittelt.' };
  }

  const secretMatch =
    expectedQrSecret.length > 0 &&
    candidate.toLowerCase() === expectedQrSecret.trim().toLowerCase();
  const shortMatch =
    expectedShortCode.length > 0 &&
    candidate.toUpperCase() === expectedShortCode.trim().toUpperCase();

  if (secretMatch || shortMatch) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: 'Code oder QR-Geheimnis stimmt nicht überein.',
  };
}
