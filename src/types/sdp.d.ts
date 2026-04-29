export function isDuplicateSdp(
  pc: RTCPeerConnection,
  type: RTCSdpType,
  sdp: string | undefined,
): boolean;

export function markSdpApplied(
  pc: RTCPeerConnection,
  type: RTCSdpType,
  sdp: string | undefined,
): void;

export function isValidSignalingState(
  pc: RTCPeerConnection | null,
  expectedType: RTCSdpType,
): boolean;

export function createOffer(
  pc: RTCPeerConnection,
): Promise<RTCSessionDescriptionInit>;

export function createAnswer(
  pc: RTCPeerConnection,
): Promise<RTCSessionDescriptionInit>;

export function setRemoteDescription(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
  drainQueue: (pc: RTCPeerConnection) => void,
): Promise<boolean>;
