export function getRTT(pc: RTCPeerConnection): Promise<number | null>;

export function checkAndWarnRTT(
  pc: RTCPeerConnection,
  label?: string,
  thresholdMs?: number,
): Promise<number | null>;
