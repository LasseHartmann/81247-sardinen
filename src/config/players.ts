export const ADMIN_ACCOUNT_ID = 'admin';

export const PLAYER_CUSTOM_GREETINGS: Record<string, string> = {
  admin: 'Spielleiter-Konsole bereit.',
  linus: 'GOLD! GOLD! GOLD!',
  lasse: 'Welcome back, sir.',
  thomas: 'Papaya Rules sind heute aktiv!',
  nick: 'Hast du das POTENZIAL zu gewinnen?',
  robert: 'Hast du deinen Atlas dabei? Wenn ja: Warum?',
  jonah: 'Hast du dein Handtuch dabei?',
  lorenzo: 'Ciao, boss mafiosi.',
  max: 'ATTACK THE D POINT!',
  theo: 'YO PHONE LINGING!',
};

export function getPlayerGreeting(
  playerOrMember:
    | { playerId?: string | null; id?: string | null; name?: string | null }
    | string
): string {
  if (typeof playerOrMember === 'string') {
    const key = playerOrMember.trim().toLowerCase();
    return PLAYER_CUSTOM_GREETINGS[key] ?? `Hallo ${playerOrMember.trim()}!`;
  }
  const pid = (playerOrMember.playerId ?? playerOrMember.id ?? '')
    .trim()
    .toLowerCase();
  const byName = (playerOrMember.name ?? '').trim().toLowerCase();
  const custom =
    PLAYER_CUSTOM_GREETINGS[pid] ?? PLAYER_CUSTOM_GREETINGS[byName];
  if (custom) return custom;
  return `Hallo ${playerOrMember.name ?? 'Spieler'}!`;
}

export function isAdminAccountId(
  playerId: string | null | undefined
): boolean {
  return (playerId ?? '').trim().toLowerCase() === ADMIN_ACCOUNT_ID;
}

/**
 * Der Account `admin` dient ausschließlich als Spielleiter-Konsole & Live-Kartenübersicht
 * und zählt nicht als regulärer Verstecker/Sucher bei Team- oder Bereit-Zählungen.
 */
export function isOverviewMember(
  member?: { playerId?: string | null; name?: string | null } | null
): boolean {
  if (!member) return false;
  const pid = (member.playerId ?? '').trim().toLowerCase();
  if (pid === ADMIN_ACCOUNT_ID || pid === 'overview') return true;
  const n = member.name?.trim().toLowerCase() ?? '';
  return n === ADMIN_ACCOUNT_ID || n === 'overview';
}

export function normalizeAccountId(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function validateAndNormalizeAccountName(
  rawName: string | null | undefined
):
  | {
      valid: true;
      playerId: string;
      displayName: string;
      isAdmin: boolean;
    }
  | {
      valid: false;
      error: string;
    } {
  const cleaned = (rawName ?? '').trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2) {
    return {
      valid: false,
      error: 'Der Benutzername muss mindestens 2 Zeichen lang sein.',
    };
  }
  if (cleaned.length > 24) {
    return {
      valid: false,
      error: 'Der Benutzername darf maximal 24 Zeichen lang sein.',
    };
  }
  if (!/^[A-Za-zÄÖÜäöüß0-9 _-]+$/.test(cleaned)) {
    return {
      valid: false,
      error:
        'Der Benutzername darf nur Buchstaben, Zahlen, Leerzeichen, Bindestriche und Unterstriche enthalten.',
    };
  }

  const playerId = normalizeAccountId(cleaned);
  if (
    playerId.length < 2 ||
    playerId.length > 32 ||
    !/^[a-z0-9_-]+$/.test(playerId)
  ) {
    return {
      valid: false,
      error: 'Ungültiger Benutzername.',
    };
  }

  const isAdmin = playerId === ADMIN_ACCOUNT_ID;
  return {
    valid: true,
    playerId,
    displayName: isAdmin ? 'Admin' : cleaned,
    isAdmin,
  };
}

export function validateAccountPassword(
  rawPassword: string | null | undefined
):
  | {
      valid: true;
      password: string;
    }
  | {
      valid: false;
      error: string;
    } {
  const pw = rawPassword ?? '';
  if (pw.trim().length < 4) {
    return {
      valid: false,
      error: 'Das Passwort muss mindestens 4 Zeichen lang sein.',
    };
  }
  if (pw.length > 64) {
    return {
      valid: false,
      error: 'Das Passwort darf maximal 64 Zeichen lang sein.',
    };
  }
  return { valid: true, password: pw };
}

function toUtf8BinaryString(input: string): string {
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(input);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }
  return unescape(encodeURIComponent(input));
}

/**
 * Reine JS-SHA-256-Implementierung (funktioniert synchron und auch in lokalen HTTP-Umgebungen
 * ohne crypto.subtle).
 */
export function sha256Hex(input: string): string {
  const ascii = toUtf8BinaryString(input);
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  let padded = ascii + '\x80';
  while ((padded.length % 64) - 56 !== 0) {
    padded += '\x00';
  }
  for (let i = 0; i < padded.length; i++) {
    const j = padded.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);

      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function computeAccountPasswordHash(
  playerId: string,
  rawPassword: string
): string {
  const normalizedId = normalizeAccountId(playerId);
  return sha256Hex(`sardinen_81247_account_v1:${normalizedId}:${rawPassword}`);
}

export function verifyAccountPasswordHash(
  playerId: string,
  rawPassword: string,
  expectedHash: string | null | undefined
): boolean {
  if (!expectedHash || !rawPassword) return false;
  return computeAccountPasswordHash(playerId, rawPassword) === expectedHash;
}
