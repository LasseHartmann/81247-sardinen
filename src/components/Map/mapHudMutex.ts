import type { MapClickInteractionMode } from './GameMap';

export type MapBottomSlotKind =
  | 'PHOTO_REQUEST_MODAL'
  | 'CIRCLE_EDITOR'
  | 'LOBBY_RULE_PREVIEW'
  | 'CLICK_PROMPT'
  | 'CLUE_PREVIEW'
  | 'HIDER_LOCK_ANCHOR'
  | 'LOBBY_RETURN'
  | 'HIDER_REHIDE'
  | 'MANHUNT_GPS_FALLBACK'
  | 'NONE';

export interface ResolveMapBottomSlotInput {
  hasOpenHiderPhotoModal: boolean;
  isEditingCircleOnMap: boolean;
  isEditingLobbyRuleOnMap?: boolean;
  clickModeKind: MapClickInteractionMode['kind'];
  hasCluePreviewOrThermo: boolean;
  showHiderAnchorPanel: boolean;
  isLobbyStatus: boolean;
  showHiderRehidePill: boolean;
  showManhuntGpsFallback: boolean;
}

/**
 * Strikter Single-Owner-Mutex für den unteren Karten-Slot:
 * Garantiert konstruktionsbedingt, dass NIEMALS zwei Karten-Leisten oder Bottom-Sheets
 * gleichzeitig übereinander oder untereinander auf der Karte gestapelt werden.
 */
export function resolveActiveMapBottomSlotKind(
  input: ResolveMapBottomSlotInput
): MapBottomSlotKind {
  if (input.hasOpenHiderPhotoModal) return 'PHOTO_REQUEST_MODAL';
  if (input.isEditingCircleOnMap) return 'CIRCLE_EDITOR';
  if (input.isEditingLobbyRuleOnMap) return 'LOBBY_RULE_PREVIEW';
  if (
    input.clickModeKind === 'TEST_LOCATION' ||
    input.clickModeKind === 'PICK_ANCHOR_POINT'
  ) {
    return 'CLICK_PROMPT';
  }
  if (input.hasCluePreviewOrThermo) return 'CLUE_PREVIEW';
  if (input.showHiderAnchorPanel) return 'HIDER_LOCK_ANCHOR';
  if (input.isLobbyStatus) return 'LOBBY_RETURN';
  if (input.showHiderRehidePill) return 'HIDER_REHIDE';
  if (input.showManhuntGpsFallback) return 'MANHUNT_GPS_FALLBACK';
  return 'NONE';
}
