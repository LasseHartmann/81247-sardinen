import type { Feature, FeatureCollection, Polygon } from 'geojson';

export type PlayerSide = 'HIDER' | 'SEEKER' | 'UNASSIGNED';

export type GameStatus =
  | 'LOBBY'
  | 'RUNNING'
  | 'PAUSED'
  | 'FINISHED'
  | 'EMERGENCY_STOP';

export type GamePhase =
  | 'LOBBY'
  | 'HIDING'
  | 'OPEN_SEARCH'
  | 'RADAR_1'
  | 'RADAR_2'
  | 'RADAR_3'
  | 'RADAR_4'
  | 'ENDGAME';

export type TeamStatus = 'ACTIVE' | 'JOINED_SARDINES';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoFix extends LatLng {
  accuracy: number;
  timestamp: number;
}

export interface TeamLocation extends GeoFix {
  updatedByUid: string;
  activeContributorCount?: number;
  memberFixes?: Record<string, GeoFix>;
}

export interface PlayerSeatClaim {
  uid: string;
  tabId: string;
  heartbeatAt: number;
}

export interface AnchorPoint extends LatLng {
  accuracy: number;
  lockedAt: number;
  lockedByUid: string;
}

export interface MemberRecord {
  uid: string;
  playerId: string;
  name: string;
  isHost: boolean;
  enabled: boolean;
  side: PlayerSide;
  teamId: string | null;
  adminAuthHash?: string;
}

export interface JoinRequest {
  uid: string;
  playerId: string;
  name: string;
  requestedAt: number;
}

export interface PresenceSession {
  online: boolean;
  lastSeen: number;
  deviceInfo?: string;
  kind?:
    | 'TAB'
    | 'EMERGENCY_ALERT'
    | 'READY_STATE'
    | 'HIDER_PW_LOCK'
    | 'ROUND_START_META';
  playerId?: string;
  senderName?: string;
  emergencyText?: string;
  readyToken?: string;
  sessionId?: string;
  passwordHash?: string;
  hiderPlayerIds?: string[];
  logoutGen?: string;
  gameStartTimestamp?: number;
  activeTeamIds?: string[];
}

export interface EmergencyMessage {
  uid: string;
  playerId: string;
  senderName: string;
  text: string;
  createdAt: number;
}

export interface HiderLoginLock {
  sessionId: string;
  passwordHash: string;
  hiderPlayerIds: string[];
  logoutGen: string;
  setAt: number;
}

export interface TeamPublic {
  id: string;
  name: string;
  color: string;
  memberPlayerIds: string[];
  beaconPlayerId: string | null;
  status: TeamStatus;
  penaltyMs: number;
  catchTimestampMs: number | null;
  clueCount: number;
}

export type RadarStageId = 1 | 2 | 3 | 4 | 5;

export interface RadarStageSecret {
  stage: RadarStageId;
  radiusMeters: number;
  center: LatLng;
  triggerElapsedMs: number;
}

export interface PublishedRadarCircle {
  stage: RadarStageId;
  radiusMeters: number;
  center: LatLng;
  publishedAt?: number;
}

export interface PlayAreaState {
  polygon: Feature<Polygon>;
  confirmed: boolean;
  confirmedAt: number | null;
  confirmedByUid: string | null;
  name: string;
}

export interface SafetyPoint {
  name: string;
  description: string;
  lat: number;
  lng: number;
}

export interface RadarSchedule {
  hidingDurationMs: number;
  stage1Ms: number;
  stage2Ms: number;
  stage3Ms: number;
  stage4Ms: number;
  stage5Ms: number;
}

export interface PublicGameState {
  status: GameStatus;
  currentPhase: GamePhase;
  gameStartTimestamp: number | null;
  searchStartTimestamp: number | null;
  pausedAt: number | null;
  totalPausedMs: number;
  pausedBeforeSearchMs: number;
  sessionId: string;
  anchorLocked: boolean;
  radarCircle: PublishedRadarCircle | null;
  radarSchedule: RadarSchedule;
  playArea: PlayAreaState;
  safetyPoint: SafetyPoint;
  emergencyStopReason: string | null;
  allowTestClicks: boolean;
  leashAlertActive: boolean;
  activeTeamIds: string[];
  hiderLock?: HiderLoginLock | null;
}

export interface ControllerLease {
  controllerUid: string;
  heartbeatAt: number;
  leaseExpiresAt: number;
  sessionId: string;
}

export interface HiderPrivateState {
  anchorPoint: AnchorPoint | null;
  radarStages: RadarStageSecret[];
  qrSecret: string;
  shortCode: string;
}

export type QuestionType =
  | 'SPLIT_NS'
  | 'SPLIT_EW'
  | 'THERMOMETER'
  | 'CONE_45'
  | 'OSM_TRANSIT'
  | 'OSM_GREEN'
  | 'RADIUS_RADAR'
  | 'DONUT_RING'
  | 'MEDIA_SKY'
  | 'MEDIA_GROUND'
  | 'MEDIA_AUDIO';

export type RadiusOptionMeters = 50 | 100 | 250 | 500 | 1000;

export type DonutBandLabel =
  | '0–200 m'
  | '200–400 m'
  | '400–600 m'
  | '600–800 m'
  | '800–1000 m'
  | '1000 m+';

export interface QuestionParams {
  splitPoint?: LatLng;
  pointA?: LatLng;
  pointB?: LatLng;
  bearingDeg?: number;
  radiusMeters?: RadiusOptionMeters;
}

export type ClueRequestStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AWAITING_HIDER_MEDIA'
  | 'EXPIRED_PROCESSING'
  | 'ANSWERED'
  | 'EXPIRED'
  | 'REJECTED';

export interface SnapshotLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface ClueRequest {
  id: string;
  teamId: string;
  requestedByUid: string;
  sessionId: string;
  questionType: QuestionType;
  category: 1 | 2 | 3 | 4;
  params: QuestionParams;
  status: ClueRequestStatus;
  penaltyMs: number;
  penaltyApplied: boolean;
  refundedMs: number;
  createdAt: number;
  netElapsedAtRequestMs?: number;
  mediaDeadlineNetElapsedMs?: number;
  processedAt?: number;
  requesterSnapshotLocation: SnapshotLocation;
  mediaBase64?: string;
  mediaMimeType?: string;
  mediaSynthetic?: boolean;
  mediaAcknowledgedAt?: number;
  usedOfflineOsmFallback?: boolean;
  rejectionReason?: string;
}

export type ClueOverlayStyle =
  | 'EXCLUDED_AREA'
  | 'HIT_AREA'
  | 'RING_BAND'
  | 'TRANSIT_BUFFERS'
  | 'GREEN_AREAS'
  | 'INFO_CIRCLE';

export interface ClueRecord {
  id: string;
  requestId: string;
  teamId: string;
  sessionId: string;
  questionType: QuestionType;
  category: 1 | 2 | 3 | 4;
  title: string;
  answerText: string;
  detailText?: string;
  isPositiveHit?: boolean;
  penaltyMs: number;
  refundedMs?: number;
  createdAt: number;
  overlayGeoJson?: FeatureCollection | Feature | null;
  overlayStyle?: ClueOverlayStyle;
  hasMedia?: boolean;
  mediaKind?: 'IMAGE' | 'AUDIO';
  usedOfflineOsmFallback?: boolean;
  isFallbackCompensation?: boolean;
}

export type CatchRequestStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'INVALID'
  | 'ALREADY_CAUGHT';

export interface CatchRequest {
  id: string;
  teamId: string;
  submittedByUid: string;
  sessionId: string;
  codeOrSecret: string;
  status: CatchRequestStatus;
  createdAt: number;
  processedAt?: number;
  errorMessage?: string;
}

export interface LeaderboardEntry {
  teamId: string;
  teamName: string;
  color: string;
  status: TeamStatus;
  searchTimeMs: number;
  penaltyMs: number;
  totalTimeMs: number;
  clueCount: number;
  caughtAt: number;
}

export interface QrCatchPayload {
  gameId: '81247';
  sessionId: string;
  secret: string;
  shortCode: string;
}

export interface AuthUserSummary {
  uid: string;
  email: string | null;
}

export type BottomNavTab =
  | 'MAP'
  | 'QUESTIONS'
  | 'QR'
  | 'LEADERBOARD'
  | 'HOST';

export type DemoRoleId =
  | 'HOST'
  | 'HIDER'
  | 'TEAM_1'
  | 'TEAM_2'
  | 'TEAM_3'
  | 'TEAM_4';
