export interface AddLocalTracksOptions {
  audioOnly?: boolean;
}

export interface AddLocalTracksResult {
  allHealthy: boolean;
  unhealthyKinds: string[];
}

export function addLocalTracks(
  pc: RTCPeerConnection,
  localStream: MediaStream,
  options?: AddLocalTracksOptions,
): AddLocalTracksResult;
