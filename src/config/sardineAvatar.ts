import { normalizeAccountId } from './players';

export type SardineExclusiveTier =
  | 'PUBLIC'
  | 'FIRST_ROUND'
  | 'DEVELOPER'
  | 'OWNER';

export const OWNER_EXCLUSIVE_IDS: ReadonlySet<string> = new Set([
  'lasse',
  'linus',
]);

export const DEVELOPER_EXCLUSIVE_IDS: ReadonlySet<string> = new Set([
  'lasse',
  'linus',
  'thomas',
  'johna',
  'jonah',
]);

export const FIRST_ROUND_EXCLUSIVE_IDS: ReadonlySet<string> = new Set([
  'lasse',
  'linus',
  'thomas',
  'nick',
  'robert',
  'eric',
  'johna',
  'jonah',
  'lorenzo',
  'louis',
  'max',
  'roman',
  'theo',
]);

export type SardineColorId =
  | 'silver'
  | 'teal'
  | 'cobalt'
  | 'emerald'
  | 'coral'
  | 'violet'
  | 'orange'
  | 'midnight'
  | 'gold';

export type SardineHatId =
  | 'none'
  | 'fedora'
  | 'beanie'
  | 'tracht'
  | 'party'
  | 'captain'
  | 'ninja'
  | 'crown';

export type SardineGlassesId =
  | 'none'
  | 'diving'
  | 'eyepatch'
  | 'reading'
  | 'goggles'
  | 'shades'
  | 'monocle';

export type SardineExtraId =
  | 'none'
  | 'bowtie'
  | 'scarf'
  | 'pretzel'
  | 'cape'
  | 'chain'
  | 'mustache';

export interface SardineAvatarConfig {
  color: SardineColorId;
  hat: SardineHatId;
  glasses: SardineGlassesId;
  extra: SardineExtraId;
}

export interface SardineColorOption {
  id: SardineColorId;
  label: string;
  tier: SardineExclusiveTier;
  backFill: string;
  bellyFill: string;
  finFill: string;
  stripeFill: string;
  outlineStroke: string;
}

export interface SardineAccessoryOption<T extends string> {
  id: T;
  label: string;
  tier: SardineExclusiveTier;
}

export const DEFAULT_SARDINE_AVATAR: SardineAvatarConfig = {
  color: 'silver',
  hat: 'none',
  glasses: 'none',
  extra: 'none',
};

export const SARDINE_COLOR_OPTIONS: readonly SardineColorOption[] = [
  {
    id: 'silver',
    label: 'Klassik-Silber',
    tier: 'PUBLIC',
    backFill: '#475569',
    bellyFill: '#E2E8F0',
    finFill: '#64748B',
    stripeFill: '#94A3B8',
    outlineStroke: '#0F172A',
  },
  {
    id: 'teal',
    label: 'Tiefsee-Türkis',
    tier: 'PUBLIC',
    backFill: '#0D9488',
    bellyFill: '#CCFBF1',
    finFill: '#0F766E',
    stripeFill: '#2DD4BF',
    outlineStroke: '#042F2E',
  },
  {
    id: 'cobalt',
    label: 'Kobalt-Blau',
    tier: 'PUBLIC',
    backFill: '#2563EB',
    bellyFill: '#DBEAFE',
    finFill: '#1D4ED8',
    stripeFill: '#60A5FA',
    outlineStroke: '#172554',
  },
  {
    id: 'emerald',
    label: 'Smaragd-Grün',
    tier: 'PUBLIC',
    backFill: '#059669',
    bellyFill: '#D1FAE5',
    finFill: '#047857',
    stripeFill: '#34D399',
    outlineStroke: '#022C22',
  },
  {
    id: 'coral',
    label: 'Koralle-Pink',
    tier: 'PUBLIC',
    backFill: '#DB2777',
    bellyFill: '#FCE7F3',
    finFill: '#BE185D',
    stripeFill: '#F472B6',
    outlineStroke: '#500724',
  },
  {
    id: 'violet',
    label: 'Violett',
    tier: 'PUBLIC',
    backFill: '#7C3AED',
    bellyFill: '#EDE9FE',
    finFill: '#6D28D9',
    stripeFill: '#A78BFA',
    outlineStroke: '#2E1065',
  },
  {
    id: 'orange',
    label: 'CMF-Orange',
    tier: 'FIRST_ROUND',
    backFill: '#FF4D00',
    bellyFill: '#FFEDD5',
    finFill: '#C2410C',
    stripeFill: '#FB923C',
    outlineStroke: '#431407',
  },
  {
    id: 'midnight',
    label: 'Mitternacht',
    tier: 'DEVELOPER',
    backFill: '#18181B',
    bellyFill: '#52525B',
    finFill: '#09090B',
    stripeFill: '#38BDF8',
    outlineStroke: '#09090B',
  },
  {
    id: 'gold',
    label: 'Gold-Sardine',
    tier: 'OWNER',
    backFill: '#D97706',
    bellyFill: '#FEF08A',
    finFill: '#B45309',
    stripeFill: '#FACC15',
    outlineStroke: '#451A03',
  },
];

export const SARDINE_HAT_OPTIONS: readonly SardineAccessoryOption<SardineHatId>[] =
  [
    { id: 'none', label: 'Keine', tier: 'PUBLIC' },
    { id: 'fedora', label: 'Detektiv-Hut', tier: 'PUBLIC' },
    { id: 'beanie', label: 'Beanie', tier: 'PUBLIC' },
    { id: 'tracht', label: 'Trachtenhut', tier: 'PUBLIC' },
    { id: 'party', label: 'Partyhut', tier: 'PUBLIC' },
    { id: 'captain', label: 'Kapitän', tier: 'FIRST_ROUND' },
    { id: 'ninja', label: 'Ninja-Band', tier: 'DEVELOPER' },
    { id: 'crown', label: 'Krone', tier: 'OWNER' },
  ];

export const SARDINE_GLASSES_OPTIONS: readonly SardineAccessoryOption<SardineGlassesId>[] =
  [
    { id: 'none', label: 'Keine', tier: 'PUBLIC' },
    { id: 'diving', label: 'Taucherbrille', tier: 'PUBLIC' },
    { id: 'eyepatch', label: 'Augenklappe', tier: 'PUBLIC' },
    { id: 'reading', label: 'Runde Brille', tier: 'PUBLIC' },
    { id: 'goggles', label: 'Tactical Goggles', tier: 'FIRST_ROUND' },
    { id: 'shades', label: 'Sonnenbrille', tier: 'DEVELOPER' },
    { id: 'monocle', label: 'Monokel', tier: 'OWNER' },
  ];

export const SARDINE_EXTRA_OPTIONS: readonly SardineAccessoryOption<SardineExtraId>[] =
  [
    { id: 'none', label: 'Keins', tier: 'PUBLIC' },
    { id: 'bowtie', label: 'Fliege', tier: 'PUBLIC' },
    { id: 'scarf', label: 'Schal', tier: 'PUBLIC' },
    { id: 'pretzel', label: 'Brezn', tier: 'PUBLIC' },
    { id: 'cape', label: 'Superhelden-Cape', tier: 'FIRST_ROUND' },
    { id: 'chain', label: 'Goldkette', tier: 'DEVELOPER' },
    { id: 'mustache', label: 'Schnurrbart', tier: 'OWNER' },
  ];

const COLOR_MAP = new Map<string, SardineColorOption>(
  SARDINE_COLOR_OPTIONS.map((c) => [c.id, c])
);
const HAT_MAP = new Map<string, SardineAccessoryOption<SardineHatId>>(
  SARDINE_HAT_OPTIONS.map((h) => [h.id, h])
);
const GLASSES_MAP = new Map<string, SardineAccessoryOption<SardineGlassesId>>(
  SARDINE_GLASSES_OPTIONS.map((g) => [g.id, g])
);
const EXTRA_MAP = new Map<string, SardineAccessoryOption<SardineExtraId>>(
  SARDINE_EXTRA_OPTIONS.map((e) => [e.id, e])
);

export type PlayerIdentityInput =
  | string
  | { playerId?: string | null; name?: string | null }
  | null
  | undefined;

function extractCandidateAccountIds(identity: PlayerIdentityInput): string[] {
  if (!identity) return [];
  if (typeof identity === 'string') {
    const norm = normalizeAccountId(identity);
    return norm ? [norm] : [];
  }
  const out: string[] = [];
  if (identity.playerId) {
    const normPid = normalizeAccountId(identity.playerId);
    if (normPid) out.push(normPid);
  }
  if (identity.name) {
    const normName = normalizeAccountId(identity.name);
    if (normName && !out.includes(normName)) out.push(normName);
  }
  return out;
}

export function canPlayerUseExclusiveTier(
  tier: SardineExclusiveTier,
  identity?: PlayerIdentityInput
): boolean {
  if (tier === 'PUBLIC') return true;
  const candidateIds = extractCandidateAccountIds(identity);
  if (candidateIds.length === 0) return false;

  if (tier === 'OWNER') {
    return candidateIds.some((id) => OWNER_EXCLUSIVE_IDS.has(id));
  }
  if (tier === 'DEVELOPER') {
    return candidateIds.some((id) => DEVELOPER_EXCLUSIVE_IDS.has(id));
  }
  if (tier === 'FIRST_ROUND') {
    return candidateIds.some((id) => FIRST_ROUND_EXCLUSIVE_IDS.has(id));
  }
  return false;
}

export function getExclusiveTierBadgeLabel(
  tier: SardineExclusiveTier
): string | null {
  switch (tier) {
    case 'OWNER':
      return 'OWNER';
    case 'DEVELOPER':
      return 'HELPER';
    case 'FIRST_ROUND':
      return '1. RUNDE';
    default:
      return null;
  }
}

export function getExclusiveTierDescriptionDe(
  tier: SardineExclusiveTier
): string {
  switch (tier) {
    case 'OWNER':
      return 'Owner-Exklusiv (nur für Lasse & Linus)';
    case 'DEVELOPER':
      return 'Helper-Exklusiv (Lasse, Linus, Thomas & Johna)';
    case 'FIRST_ROUND':
      return 'Runde-1-Exklusiv (OG-Spieler der ersten Runde)';
    default:
      return 'Für alle Spieler verfügbar';
  }
}

export function sanitizeSardineAvatarForPlayer(
  config: SardineAvatarConfig,
  identity?: PlayerIdentityInput
): SardineAvatarConfig {
  const colorOpt = COLOR_MAP.get(config.color) ?? SARDINE_COLOR_OPTIONS[0];
  const hatOpt = HAT_MAP.get(config.hat) ?? SARDINE_HAT_OPTIONS[0];
  const glassesOpt =
    GLASSES_MAP.get(config.glasses) ?? SARDINE_GLASSES_OPTIONS[0];
  const extraOpt = EXTRA_MAP.get(config.extra) ?? SARDINE_EXTRA_OPTIONS[0];

  if (!identity) {
    return {
      color: colorOpt.id,
      hat: hatOpt.id,
      glasses: glassesOpt.id,
      extra: extraOpt.id,
    };
  }

  return {
    color: canPlayerUseExclusiveTier(colorOpt.tier, identity)
      ? colorOpt.id
      : 'silver',
    hat: canPlayerUseExclusiveTier(hatOpt.tier, identity) ? hatOpt.id : 'none',
    glasses: canPlayerUseExclusiveTier(glassesOpt.tier, identity)
      ? glassesOpt.id
      : 'none',
    extra: canPlayerUseExclusiveTier(extraOpt.tier, identity)
      ? extraOpt.id
      : 'none',
  };
}

export const SARDINE_AVATAR_PREFIX = 'sardine:v1:';
export const MATRIX_ADMIN_AVATAR_ID = 'sardine:matrix:admin';

export function isMatrixAdminIdentity(
  identity?: PlayerIdentityInput,
  rawAvatar?: string | null
): boolean {
  if (rawAvatar && rawAvatar.trim() === MATRIX_ADMIN_AVATAR_ID) {
    return true;
  }
  const candidateIds = extractCandidateAccountIds(identity);
  return candidateIds.some((id) => id === 'admin' || id === 'overview');
}

export function renderMatrixAdminSardineSvgMarkup(): {
  viewBox: string;
  innerHtml: string;
} {
  const innerHtml = `
    <!-- Matrix Terminal-Hintergrund mit abgerundetem Cyber-Rahmen -->
    <rect x="2" y="2" width="60" height="60" rx="14" fill="#020804" stroke="#00FF41" stroke-width="2" />
    <rect x="4.5" y="4.5" width="55" height="55" rx="11.5" fill="none" stroke="#15803D" stroke-width="0.9" stroke-dasharray="3 2" opacity="0.7" />

    <!-- Fallender Matrix-Binärcode im Hintergrund -->
    <g opacity="0.55" fill="#00FF41" font-family="'JetBrains Mono', monospace" font-size="6.5" font-weight="800">
      <text x="8" y="13">1</text>
      <text x="8" y="21" fill="#15803D">0</text>
      <text x="8" y="29">1</text>
      <text x="17" y="11" fill="#15803D">0</text>
      <text x="17" y="19">1</text>
      <text x="27" y="13">1</text>
      <text x="27" y="21" fill="#86EFAC">0</text>
      <text x="38" y="12" fill="#15803D">1</text>
      <text x="49" y="14">0</text>
      <text x="49" y="22" fill="#86EFAC">1</text>
      <text x="12" y="54" fill="#15803D">0</text>
      <text x="24" y="56">1</text>
      <text x="37" y="54" fill="#86EFAC">1</text>
      <text x="50" y="55" fill="#15803D">0</text>
    </g>

    <!-- Neo Trenchcoat-Kragen / Cyber-Cape im Hintergrund -->
    <path d="M39 27 C28 25 16 29 8 41 C14 43 20 45 25 49 C31 43 36 37 41 34 Z" fill="#052E16" stroke="#00FF41" stroke-width="1.6" stroke-linejoin="round" />

    <!-- Rücken-, Bauch- & Schwanzflosse im Matrix-Wireframe-Stil -->
    <path d="M25 24 L31 16.5 L36 22.5 Z" fill="#052E16" stroke="#00FF41" stroke-width="1.5" stroke-linejoin="round" />
    <path d="M28 41.5 L33 47 L36.5 41.5 Z" fill="#052E16" stroke="#00FF41" stroke-width="1.5" stroke-linejoin="round" />
    <path d="M16 33 L5.5 22.5 L9.5 33 L5.5 43.5 Z" fill="#052E16" stroke="#00FF41" stroke-width="1.6" stroke-linejoin="round" />

    <!-- Cyber-Sardinen-Körper -->
    <path d="M14.5 33 C20 21.5 42 20 58.5 32.5 C43 45.5 20 44.5 14.5 33 Z" fill="#041E0C" stroke="#00FF41" stroke-width="1.9" stroke-linejoin="round" />
    <path d="M16.5 34.2 C23 39.5 41 40.5 56.5 33.3 C42.5 43.5 22 42.8 16.5 34.2 Z" fill="#052E16" />

    <!-- Leuchtende Matrix-Datenlinien & Schuppen-Circuit -->
    <path d="M18 33 C28 31.2 41 31.2 53 32.8" fill="none" stroke="#00FF41" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2.5 1.5" />
    <path d="M24 29.5 C25.8 31 25.8 33 24 34.5" fill="none" stroke="#4ADE80" stroke-width="1.2" stroke-linecap="round" />
    <path d="M30 28.8 C31.8 30.5 31.8 32.8 30 34.5" fill="none" stroke="#4ADE80" stroke-width="1.2" stroke-linecap="round" />
    <path d="M36 28.8 C37.8 30.5 37.8 32.8 36 34.5" fill="none" stroke="#4ADE80" stroke-width="1.2" stroke-linecap="round" />
    <path d="M43 26.8 C41 30.8 41.2 35.2 43.5 38.5" fill="none" stroke="#00FF41" stroke-width="1.5" stroke-linecap="round" />

    <!-- Ikonische randlose Matrix-Sonnenbrille (Neo / Agent Smith) mit grünem Code-Glanz -->
    <path d="M35 29.2 L42.5 29.5" stroke="#00FF41" stroke-width="1.5" stroke-linecap="round" />
    <ellipse cx="46.5" cy="30.5" rx="4.2" ry="2.7" transform="rotate(-8 46.5 30.5)" fill="#020617" stroke="#00FF41" stroke-width="1.4" />
    <ellipse cx="54.2" cy="30.2" rx="3.8" ry="2.5" transform="rotate(6 54.2 30.2)" fill="#020617" stroke="#00FF41" stroke-width="1.4" />
    <path d="M50.3 30.2 L51 30.2" stroke="#00FF41" stroke-width="1.4" />
    <path d="M44.8 29.2 L47.2 31.5" stroke="#86EFAC" stroke-width="1.1" stroke-linecap="round" />
    <path d="M52.8 29 L55 31.2" stroke="#86EFAC" stroke-width="1.1" stroke-linecap="round" />
  `;

  return {
    viewBox: '0 0 64 64',
    innerHtml,
  };
}

export function serializeSardineAvatar(config: SardineAvatarConfig): string {
  return `${SARDINE_AVATAR_PREFIX}${config.color}:${config.hat}:${config.glasses}:${config.extra}`;
}

export function parseSardineAvatar(
  raw?: string | null,
  identity?: PlayerIdentityInput
): SardineAvatarConfig {
  if (!raw || typeof raw !== 'string') {
    return { ...DEFAULT_SARDINE_AVATAR };
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith(SARDINE_AVATAR_PREFIX)) {
    return { ...DEFAULT_SARDINE_AVATAR };
  }
  const parts = trimmed.slice(SARDINE_AVATAR_PREFIX.length).split(':');
  const rawColor = (parts[0] ?? 'silver') as SardineColorId;
  const rawHat = (parts[1] ?? 'none') as SardineHatId;
  const rawGlasses = (parts[2] ?? 'none') as SardineGlassesId;
  const rawExtra = (parts[3] ?? 'none') as SardineExtraId;

  return sanitizeSardineAvatarForPlayer(
    {
      color: COLOR_MAP.has(rawColor) ? rawColor : 'silver',
      hat: HAT_MAP.has(rawHat) ? rawHat : 'none',
      glasses: GLASSES_MAP.has(rawGlasses) ? rawGlasses : 'none',
      extra: EXTRA_MAP.has(rawExtra) ? rawExtra : 'none',
    },
    identity
  );
}

export function createRandomSardineAvatar(
  identity?: PlayerIdentityInput,
  rng: () => number = Math.random
): SardineAvatarConfig {
  const unlockedColors = SARDINE_COLOR_OPTIONS.filter((c) =>
    canPlayerUseExclusiveTier(c.tier, identity)
  );
  const unlockedHats = SARDINE_HAT_OPTIONS.filter((h) =>
    canPlayerUseExclusiveTier(h.tier, identity)
  );
  const unlockedGlasses = SARDINE_GLASSES_OPTIONS.filter((g) =>
    canPlayerUseExclusiveTier(g.tier, identity)
  );
  const unlockedExtras = SARDINE_EXTRA_OPTIONS.filter((e) =>
    canPlayerUseExclusiveTier(e.tier, identity)
  );

  const pick = <T,>(arr: readonly T[]): T =>
    arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

  return {
    color: pick(unlockedColors).id,
    hat: pick(unlockedHats).id,
    glasses: pick(unlockedGlasses).id,
    extra: pick(unlockedExtras).id,
  };
}

function renderCapeBackSvg(extra: SardineExtraId): string {
  if (extra !== 'cape') return '';
  return `
    <g>
      <path d="M40 28 C29 25 17 29 7 42 C13 44 19 46 25 51 C31 44 36 38 41 34 Z" fill="#DC2626" stroke="#450A0A" stroke-width="1.8" stroke-linejoin="round" />
      <path d="M39 29 C30 28 21 31 12 41 C16 42 20 44 24 47 C30 41 35 36 40 33 Z" fill="#EF4444" opacity="0.7" />
    </g>
  `;
}

function renderHatSvg(hat: SardineHatId): string {
  // Die Kopflinie der Sardine fällt von (40, 23.2) nach (53, 28.2) um ca. +21° ab.
  // Durch die Transformation sitzt jede Kopfbedeckung geneigt & bündig direkt auf dem Fischkopf.
  const headTransform = 'translate(46.5, 25.6) rotate(21)';

  switch (hat) {
    case 'crown':
      return `
        <g transform="${headTransform}">
          <path d="M-7.5 0.6 L-9 -10 L-2.5 -5 L0 -12.5 L2.5 -5 L9 -10 L7.5 0.6 Z" fill="#FACC15" stroke="#713F12" stroke-width="1.5" stroke-linejoin="round" />
          <rect x="-7.8" y="-1.6" width="15.6" height="2.8" rx="1" fill="#EAB308" stroke="#713F12" stroke-width="1.2" />
          <circle cx="-4.2" cy="-3.8" r="1.25" fill="#EF4444" />
          <circle cx="0" cy="-5" r="1.45" fill="#0D9488" />
          <circle cx="4.2" cy="-3.8" r="1.25" fill="#EF4444" />
        </g>
      `;
    case 'ninja':
      return `
        <g transform="${headTransform}">
          <path d="M-7.5 -0.5 C-13.5 -4.5 -19 -5 -24 -2 C-19 -0.5 -13.5 -0.2 -7.5 1.8 Z" fill="#18181B" stroke="#09090B" stroke-width="1.2" />
          <path d="M-7.5 1.2 C-13.5 1.5 -18.5 3.5 -22.5 7 C-17.5 6.5 -12.5 4.2 -7 2.8 Z" fill="#27272A" stroke="#09090B" stroke-width="1.2" />
          <path d="M-8.5 -0.8 C-3 -2.2 3.5 -2.2 8.5 -0.5 L7.8 2.6 C3 1.2 -3 1.2 -8.2 2.4 Z" fill="#18181B" stroke="#09090B" stroke-width="1.35" />
          <rect x="-1.5" y="-1.3" width="6.5" height="3.3" rx="0.9" fill="#E2E8F0" stroke="#0F172A" stroke-width="1.05" />
        </g>
      `;
    case 'captain':
      return `
        <g transform="${headTransform}">
          <path d="M-8.5 -0.8 C-9 -8.2 8.5 -8.8 9 -1.2 L7 0.8 L-7 0.8 Z" fill="#F8FAFC" stroke="#0F172A" stroke-width="1.5" stroke-linejoin="round" />
          <rect x="-7.5" y="-1.8" width="15" height="2.8" rx="0.9" fill="#1E293B" stroke="#0F172A" stroke-width="1.1" />
          <path d="M-7 -0.4 L7 -0.4" stroke="#FACC15" stroke-width="1.3" />
          <path d="M1.5 0.5 L11.5 1.2 C10 3.2 5.2 3.2 1.2 1.8 Z" fill="#0F172A" />
          <circle cx="0.5" cy="-4.6" r="1.7" fill="#FACC15" stroke="#713F12" stroke-width="0.8" />
        </g>
      `;
    case 'fedora':
      return `
        <g transform="${headTransform}">
          <ellipse cx="0" cy="0.4" rx="11.8" ry="2.4" fill="#78350F" stroke="#292524" stroke-width="1.35" />
          <path d="M-7.2 0 L-5 -8.5 C-2 -9.6 2 -9.5 5 -8.2 L7.2 0 Z" fill="#92400E" stroke="#292524" stroke-width="1.35" stroke-linejoin="round" />
          <path d="M-6.8 -1.8 L6.8 -1.8" stroke="#1C1917" stroke-width="2.1" />
        </g>
      `;
    case 'beanie':
      return `
        <g transform="${headTransform}">
          <circle cx="0" cy="-10.5" r="2.6" fill="#F97316" stroke="#431407" stroke-width="1.25" />
          <path d="M-8 0.4 C-8 -7.8 8 -7.8 8 0.4 Z" fill="#EA580C" stroke="#431407" stroke-width="1.45" />
          <rect x="-8.8" y="-1.6" width="17.6" height="3.5" rx="1.7" fill="#FB923C" stroke="#431407" stroke-width="1.25" />
        </g>
      `;
    case 'tracht':
      return `
        <g transform="${headTransform}">
          <ellipse cx="0" cy="0.4" rx="11.2" ry="2.3" fill="#166534" stroke="#052E16" stroke-width="1.35" />
          <path d="M-6.8 0 L-4.2 -8.5 C-1 -9.5 2 -9 4.5 -7.5 L6.8 0 Z" fill="#15803D" stroke="#052E16" stroke-width="1.35" />
          <path d="M-6.4 -1.6 L6.4 -1.6" stroke="#FEF08A" stroke-width="1.5" />
          <path d="M-4.5 -2 C-8.2 -6.8 -9.2 -10.5 -6.5 -12 C-4.5 -10 -3.5 -6 -3.3 -2 Z" fill="#F8FAFC" stroke="#0F172A" stroke-width="1" />
        </g>
      `;
    case 'party':
      return `
        <g transform="${headTransform}">
          <path d="M-6.8 0.6 L0 -12.2 L6.8 0.6 Z" fill="#EC4899" stroke="#500724" stroke-width="1.45" stroke-linejoin="round" />
          <path d="M-4.5 -3.6 L4.5 -3.6" stroke="#FACC15" stroke-width="1.7" />
          <path d="M-2.4 -7.5 L2.4 -7.5" stroke="#38BDF8" stroke-width="1.7" />
          <circle cx="0" cy="-12.8" r="2.2" fill="#FACC15" stroke="#500724" stroke-width="1.05" />
        </g>
      `;
    default:
      return '';
  }
}

function renderGlassesSvg(glasses: SardineGlassesId): string {
  switch (glasses) {
    case 'shades':
      return `
        <g>
          <path d="M41 28.5 L55.5 28.5 L54.5 33.8 C53.5 35 49 35 48 33.2 L47 33.2 C46 34.8 42.5 34.5 41.8 32.5 Z" fill="#09090B" stroke="#F8FAFC" stroke-width="1.1" stroke-linejoin="round" />
          <path d="M49.5 29.5 L52.5 33" stroke="#F8FAFC" stroke-width="1.2" stroke-linecap="round" opacity="0.85" />
          <path d="M36 29.5 L42 29.5" stroke="#09090B" stroke-width="1.6" stroke-linecap="round" />
        </g>
      `;
    case 'monocle':
      return `
        <g>
          <circle cx="49.5" cy="30.8" r="4.3" fill="#FEF9C3" fill-opacity="0.32" stroke="#FACC15" stroke-width="1.8" />
          <path d="M46.2 33.5 C44.5 37.5 43.5 40.5 41.5 42.5" fill="none" stroke="#FACC15" stroke-width="1.3" stroke-dasharray="1.5 1.2" />
          <path d="M48 28.8 L51 31.8" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round" opacity="0.85" />
        </g>
      `;
    case 'goggles':
      return `
        <g>
          <path d="M34 29.5 L45 29.8" stroke="#18181B" stroke-width="2.4" stroke-linecap="round" />
          <rect x="44" y="26.8" width="11.5" height="7.2" rx="3.2" fill="#18181B" stroke="#09090B" stroke-width="1.4" />
          <circle cx="47.5" cy="30.4" r="2.3" fill="#4ADE80" stroke="#14532D" stroke-width="0.9" />
          <circle cx="52.5" cy="30.4" r="2.3" fill="#4ADE80" stroke="#14532D" stroke-width="0.9" />
          <circle cx="47" cy="29.7" r="0.7" fill="#DCFCE7" />
          <circle cx="52" cy="29.7" r="0.7" fill="#DCFCE7" />
        </g>
      `;
    case 'diving':
      return `
        <g>
          <rect x="43.5" y="26.5" width="12" height="8" rx="3.5" fill="#38BDF8" fill-opacity="0.55" stroke="#EA580C" stroke-width="1.8" />
          <path d="M41.5 35.5 L41.5 18.5 C41.5 16.5 43 15.5 44.5 15.5" fill="none" stroke="#F97316" stroke-width="2.3" stroke-linecap="round" />
          <path d="M46.5 28.5 L50 32" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.85" />
        </g>
      `;
    case 'eyepatch':
      return `
        <g>
          <path d="M36 25.5 L55.5 33.5" stroke="#09090B" stroke-width="1.7" />
          <ellipse cx="49.5" cy="30.8" rx="3.8" ry="3.4" fill="#09090B" stroke="#3F3F46" stroke-width="1" />
        </g>
      `;
    case 'reading':
      return `
        <g>
          <circle cx="49.5" cy="30.8" r="4" fill="#FFFFFF" fill-opacity="0.22" stroke="#334155" stroke-width="1.6" />
          <path d="M38 29.8 L45.5 30.5" stroke="#334155" stroke-width="1.4" stroke-linecap="round" />
        </g>
      `;
    default:
      return '';
  }
}

function renderExtraFrontSvg(extra: SardineExtraId): string {
  switch (extra) {
    case 'mustache':
      return `
        <g>
          <path d="M53 35.2 C50.5 33.8 47.5 34.5 45.5 36.8 C44.2 38.2 42.5 37.8 42.2 36.3 C41.2 38.8 44 40.5 47.2 39 C49.5 38 51.5 36.8 53 36.5 C54.5 36.8 56.5 38 58.5 38.8 C61 39.8 62.8 38.2 62 36 C61.5 37.3 60.2 37.5 59 36.3 C57.2 34.5 55 33.8 53 35.2 Z" fill="#451A03" stroke="#1C1917" stroke-width="1" stroke-linejoin="round" />
        </g>
      `;
    case 'chain':
      return `
        <g>
          <path d="M40.5 27 C39 33 40.5 39 43.5 42.5" fill="none" stroke="#FACC15" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="2.2 1.2" />
          <circle cx="44" cy="44" r="3.2" fill="#FACC15" stroke="#854D0E" stroke-width="1.2" />
          <circle cx="44" cy="44" r="1.2" fill="#FEF08A" />
        </g>
      `;
    case 'cape':
      return `
        <g>
          <path d="M39.5 27.5 C40.5 31.5 41.5 35.5 43 39.5" fill="none" stroke="#B91C1C" stroke-width="2.4" stroke-linecap="round" />
          <circle cx="41" cy="33.5" r="2.4" fill="#FACC15" stroke="#713F12" stroke-width="1.1" />
        </g>
      `;
    case 'bowtie':
      return `
        <g>
          <polygon points="38,37.5 43,40.5 38,43.5" fill="#E11D48" stroke="#4C0519" stroke-width="1.1" stroke-linejoin="round" />
          <polygon points="48,37.5 43,40.5 48,43.5" fill="#E11D48" stroke="#4C0519" stroke-width="1.1" stroke-linejoin="round" />
          <circle cx="43" cy="40.5" r="1.6" fill="#FB7185" stroke="#4C0519" stroke-width="1" />
        </g>
      `;
    case 'scarf':
      return `
        <g>
          <path d="M38.5 26.5 C38 33 39.5 39 42.5 42.5" fill="none" stroke="#0D9488" stroke-width="4.2" stroke-linecap="round" />
          <path d="M38.5 26.5 C38 33 39.5 39 42.5 42.5" fill="none" stroke="#FACC15" stroke-width="4.2" stroke-dasharray="2.5 2.5" />
          <path d="M40.5 40 L37.5 48.5 L42 49 L43.5 41 Z" fill="#0D9488" stroke="#042F2E" stroke-width="1.1" stroke-linejoin="round" />
        </g>
      `;
    case 'pretzel':
      return `
        <g transform="translate(32, 37) scale(0.85)">
          <path d="M4 9 C1 5 4 1 8 3 C10 4 11 6 12 8 C13 6 14 4 16 3 C20 1 23 5 20 9 C17 13 10 14 6 12" fill="none" stroke="#B45309" stroke-width="3.2" stroke-linecap="round" />
          <path d="M6 12 C9 15 15 15 18 12" fill="none" stroke="#92400E" stroke-width="3" stroke-linecap="round" />
          <circle cx="7" cy="4" r="0.8" fill="#FFFFFF" />
          <circle cx="17" cy="4" r="0.8" fill="#FFFFFF" />
          <circle cx="12" cy="13" r="0.8" fill="#FFFFFF" />
        </g>
      `;
    default:
      return '';
  }
}

export function renderSardineSvgMarkup(
  config: SardineAvatarConfig,
  identity?: PlayerIdentityInput,
  rawAvatar?: string | null
): {
  viewBox: string;
  innerHtml: string;
} {
  if (isMatrixAdminIdentity(identity, rawAvatar)) {
    return renderMatrixAdminSardineSvgMarkup();
  }
  const palette = COLOR_MAP.get(config.color) ?? SARDINE_COLOR_OPTIONS[0];
  const hideNaturalEye =
    config.glasses === 'shades' ||
    config.glasses === 'goggles' ||
    config.glasses === 'eyepatch';

  const goldSparkles =
    config.color === 'gold'
      ? `
        <path d="M23 19 L24 21.5 L26.5 22.5 L24 23.5 L23 26 L22 23.5 L19.5 22.5 L22 21.5 Z" fill="#FEF08A" />
        <circle cx="31" cy="17" r="1.1" fill="#FEF08A" />
      `
      : '';

  const innerHtml = `
    ${renderCapeBackSvg(config.extra)}
    <!-- Rücken- & Bauchflossen -->
    <path d="M25 24 L31 16.5 L36 22.5 Z" fill="${palette.finFill}" stroke="${palette.outlineStroke}" stroke-width="1.6" stroke-linejoin="round" />
    <path d="M28 41.5 L33 47 L36.5 41.5 Z" fill="${palette.finFill}" stroke="${palette.outlineStroke}" stroke-width="1.5" stroke-linejoin="round" />

    <!-- Gegabelte Sardinen-Schwanzflosse -->
    <path d="M16 33 L5.5 22.5 L9.5 33 L5.5 43.5 Z" fill="${palette.finFill}" stroke="${palette.outlineStroke}" stroke-width="1.7" stroke-linejoin="round" />

    <!-- Sardinen-Hauptkörper (Torpedo-Silhouette) -->
    <path d="M14.5 33 C20 21.5 42 20 58.5 32.5 C43 45.5 20 44.5 14.5 33 Z" fill="${palette.backFill}" stroke="${palette.outlineStroke}" stroke-width="1.8" stroke-linejoin="round" />

    <!-- Silberner Sardinen-Bauch -->
    <path d="M16.5 34.2 C23 39.5 41 40.5 56.5 33.3 C42.5 43.5 22 42.8 16.5 34.2 Z" fill="${palette.bellyFill}" />

    <!-- Charakteristischer Seitenstreifen & Sardinen-Schuppen -->
    <path d="M18 33 C28 31.2 41 31.2 53 32.8" fill="none" stroke="${palette.stripeFill}" stroke-width="1.6" stroke-linecap="round" opacity="0.9" />
    <path d="M24 29.5 C25.8 31 25.8 33 24 34.5" fill="none" stroke="${palette.bellyFill}" stroke-width="1.2" stroke-linecap="round" opacity="0.65" />
    <path d="M30 28.8 C31.8 30.5 31.8 32.8 30 34.5" fill="none" stroke="${palette.bellyFill}" stroke-width="1.2" stroke-linecap="round" opacity="0.65" />
    <path d="M36 28.8 C37.8 30.5 37.8 32.8 36 34.5" fill="none" stroke="${palette.bellyFill}" stroke-width="1.2" stroke-linecap="round" opacity="0.65" />

    <!-- Kiemenbogen & freundliches Lächeln -->
    <path d="M43 26.8 C41 30.8 41.2 35.2 43.5 38.5" fill="none" stroke="${palette.outlineStroke}" stroke-width="1.5" stroke-linecap="round" opacity="0.75" />
    <path d="M52.5 35.5 C54.2 36.2 55.8 35.8 57 34.5" fill="none" stroke="${palette.outlineStroke}" stroke-width="1.4" stroke-linecap="round" />

    ${
      hideNaturalEye
        ? ''
        : `
      <circle cx="49.5" cy="30.5" r="3.1" fill="#FFFFFF" stroke="${palette.outlineStroke}" stroke-width="1.3" />
      <circle cx="50.3" cy="30.5" r="1.6" fill="#0F172A" />
      <circle cx="49.6" cy="29.7" r="0.65" fill="#FFFFFF" />
    `
    }

    ${goldSparkles}
    ${renderExtraFrontSvg(config.extra)}
    ${renderGlassesSvg(config.glasses)}
    ${renderHatSvg(config.hat)}
  `;

  return {
    viewBox: '0 0 64 64',
    innerHtml,
  };
}

export function renderCompleteSardineSvgString(
  config: SardineAvatarConfig,
  sizePx = 24,
  identity?: PlayerIdentityInput,
  rawAvatar?: string | null
): string {
  const { viewBox, innerHtml } = renderSardineSvgMarkup(
    config,
    identity,
    rawAvatar
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${sizePx}" height="${sizePx}" style="display:block;flex-shrink:0;overflow:visible;">${innerHtml}</svg>`;
}
