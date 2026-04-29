export type { IceTransport } from './index.js';

export function setupIceCandidates(
  pc: RTCPeerConnection,
  transport: import('./index.js').IceTransport,
): () => void;

export function drainIceCandidateQueue(pc: RTCPeerConnection): void;
