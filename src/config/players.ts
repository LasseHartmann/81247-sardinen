export interface PresetPlayer {
  id: string;
  name: string;
  canUnlockAdmin: boolean;
  loginEmail: string;
}

/**
 * Exakte, abgeschlossene Spielerliste der Freundesgruppe (keine weiteren Namen erlaubt).
 * Alle 11 loggen sich direkt mit ihrem Vornamen ein.
 * Lasse und Linus sehen nach dem Login einen Button, um per Admin-Code ihre Admin-Rechte freizuschalten.
 */
export const PRESET_PLAYERS: PresetPlayer[] = [
  { id: 'lasse', name: 'Lasse', canUnlockAdmin: true, loginEmail: 'lasse@81247-sardinen.local' },
  { id: 'linus', name: 'Linus', canUnlockAdmin: true, loginEmail: 'linus@81247-sardinen.local' },
  { id: 'thomas', name: 'Thomas', canUnlockAdmin: false, loginEmail: 'thomas@81247-sardinen.local' },
  { id: 'robert', name: 'Robert', canUnlockAdmin: false, loginEmail: 'robert@81247-sardinen.local' },
  { id: 'nick', name: 'Nick', canUnlockAdmin: false, loginEmail: 'nick@81247-sardinen.local' },
  { id: 'eric', name: 'Eric', canUnlockAdmin: false, loginEmail: 'eric@81247-sardinen.local' },
  { id: 'jonah', name: 'Jonah', canUnlockAdmin: false, loginEmail: 'jonah@81247-sardinen.local' },
  { id: 'lorenzo', name: 'Lorenzo', canUnlockAdmin: false, loginEmail: 'lorenzo@81247-sardinen.local' },
  { id: 'louis', name: 'Louis', canUnlockAdmin: false, loginEmail: 'louis@81247-sardinen.local' },
  { id: 'max', name: 'Max', canUnlockAdmin: false, loginEmail: 'max@81247-sardinen.local' },
  { id: 'roman', name: 'Roman', canUnlockAdmin: false, loginEmail: 'roman@81247-sardinen.local' },
];

/**
 * SHA-256-Prüfsumme des gesalzenen Admin-Codes — der Klartext-Code steht nirgends im Quellcode,
 * und Firebase database.rules.json erzwingt exakt diesen Hash beim Freischalten von isHost: true.
 */
export const EXPECTED_ADMIN_AUTH_HASH =
  '72bfd4d0aec4a76c76188c955cdfedfb75abd34584490c5d8ede99e15f71a5ae';

/**
 * Reine JS-SHA-256-Implementierung (funktioniert synchron und auch in lokalen HTTP-Umgebungen
 * ohne crypto.subtle).
 */
export function sha256Hex(ascii: string): string {
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

export function computeAdminCodeHash(rawCode: string): string {
  // Akzeptiert sowohl den 4-stelligen Code direkt als auch mit vorangestelltem '#'
  const cleaned = rawCode.trim().replace(/^#/, '');
  return sha256Hex(`sardinen_81247_admin_code:${cleaned}`);
}

export function verifyAdminCode(rawCode: string): {
  valid: boolean;
  adminAuthHash?: string;
} {
  const hash = computeAdminCodeHash(rawCode);
  if (hash === EXPECTED_ADMIN_AUTH_HASH) {
    return { valid: true, adminAuthHash: hash };
  }
  return { valid: false };
}

/**
 * Prüft eine Namenseingabe (Groß-/Kleinschreibung egal, Leerzeichen werden ignoriert)
 * strikt gegen die 11 erlaubten Spielernamen — nicht mehr und nicht weniger.
 */
export function resolveAllowedPlayerByNameInput(
  rawName: string | null | undefined
): PresetPlayer | undefined {
  if (!rawName) return undefined;
  const normalized = rawName.trim().toLowerCase();
  if (!normalized) return undefined;
  return PRESET_PLAYERS.find((p) => p.name.toLowerCase() === normalized);
}

export function findPresetPlayerByEmail(
  email: string | null | undefined
): PresetPlayer | undefined {
  if (!email) return undefined;
  const normalized = email.trim().toLowerCase();
  return PRESET_PLAYERS.find((p) => p.loginEmail.toLowerCase() === normalized);
}

export function findPresetPlayerById(id: string): PresetPlayer | undefined {
  return PRESET_PLAYERS.find((p) => p.id === id);
}
