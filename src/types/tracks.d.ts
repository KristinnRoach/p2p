export interface AddLocalTracksOptions {
  audioOnly?: boolean;
}

export interface AddLocalTracksResult {
  allHealthy: boolean;
  unhealthyKinds: string[];
}

export interface LocalTrackSlot {
  id: string;
  kind: 'audio' | 'video';
  track?: MediaStreamTrack | null;
}

export function normalizeLocalTrackSlots(
  slots: unknown,
  owner: string,
): Array<Required<LocalTrackSlot>>;

export function assertLocalTrackKind(
  slotId: string,
  kind: 'audio' | 'video',
  track: MediaStreamTrack | null,
  owner: string,
): void;

export function addLocalTracks(
  pc: RTCPeerConnection,
  localStream: MediaStream,
  options?: AddLocalTracksOptions,
): AddLocalTracksResult;
