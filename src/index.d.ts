// Public TypeScript declarations for @kidlib/p2p

export interface IceTransport {
  sendCandidate(candidate: RTCIceCandidateInit): void | Promise<void>;
  onRemoteCandidate(
    callback: (candidate: RTCIceCandidateInit) => void,
  ): void | (() => void);
}

export interface DataSignalingChannel extends IceTransport {
  sendOffer(offer: RTCSessionDescriptionInit): void | Promise<void>;
  sendAnswer(answer: RTCSessionDescriptionInit): void | Promise<void>;
  onOffer(
    callback: (offer: RTCSessionDescriptionInit) => void,
  ): void | (() => void);
  onAnswer(
    callback: (answer: RTCSessionDescriptionInit) => void,
  ): void | (() => void);
  close?(): void;
}

export type PeerState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface RemoteStreamDetail {
  stream: MediaStream;
  track: MediaStreamTrack;
  event: RTCTrackEvent;
}

export interface StateChangeDetail {
  state: PeerState;
  previous: PeerState;
}

export interface ErrorDetail {
  error: Error;
  phase?: string;
}

export interface MessageDetail {
  data: unknown;
}

export interface DataChannelDetail {
  channel: RTCDataChannel;
}

export interface P2PSessionEvents {
  remoteStream: RemoteStreamDetail;
  remoteTrack: RemoteStreamDetail;
  statechange: StateChangeDetail;
  connected: Record<string, never>;
  disconnected: Record<string, never>;
  datachannel: DataChannelDetail;
  open: Record<string, never>;
  message: MessageDetail;
  close: Record<string, never>;
  error: ErrorDetail;
  track: { track: MediaStreamTrack; streams: MediaStream[] };
}

export interface P2PSession {
  readonly role: 'initiator' | 'joiner';
  readonly state: PeerState;
  readonly dataChannel: RTCDataChannel | null;
  readonly remoteStream: MediaStream | null;
  readonly ready: Promise<void>;

  on<K extends keyof P2PSessionEvents>(
    type: K,
    callback: (detail: P2PSessionEvents[K], event: CustomEvent) => void,
  ): () => void;
  on(
    type: string,
    callback: (detail: unknown, event: CustomEvent) => void,
  ): () => void;

  once<K extends keyof P2PSessionEvents>(
    type: K,
    callback: (detail: P2PSessionEvents[K], event: CustomEvent) => void,
  ): () => void;
  once(
    type: string,
    callback: (detail: unknown, event: CustomEvent) => void,
  ): () => void;

  off(type: string, callback: (...args: unknown[]) => void): void;
  send(data: unknown): void;
  close(): void;
}

export interface P2PSessionOptions {
  signaling: DataSignalingChannel;
  localStream?: MediaStream | null;
  audioOnly?: boolean;
  dataChannel?: boolean;
  dataChannelLabel?: string;
  rtcConfig?: RTCConfiguration;
  startTimeoutMs?: number;
  connectedTimeoutMs?: number;
  dataChannelOpenTimeoutMs?: number;
  signal?: AbortSignal | null;
  onRemoteStream?: (detail: RemoteStreamDetail, event: CustomEvent) => void;
  onRemoteTrack?: (detail: RemoteStreamDetail, event: CustomEvent) => void;
  onDataChannel?: (detail: DataChannelDetail, event: CustomEvent) => void;
}

export function startP2PSession(options: P2PSessionOptions): Promise<P2PSession>;
export function joinP2PSession(options: P2PSessionOptions): Promise<P2PSession>;

export interface P2PRoomPeerSignalingOptions {
  localPeerId: string;
  remotePeerId: string;
}

export interface P2PRoomSignaling {
  join(peerId: string): void | Promise<void>;
  leave(peerId: string): void | Promise<void>;
  onPeers(callback: (peerIds: string[]) => void): void | (() => void);
  createPeerSignaling(options: P2PRoomPeerSignalingOptions): DataSignalingChannel;
  close?(): void;
}

export interface PeerStreamDetail extends RemoteStreamDetail {
  peerId: string;
}

export interface PeerLeftDetail {
  peerId: string;
  stream: MediaStream | null;
}

export interface PeerErrorDetail {
  peerId: string;
  error: Error;
}

export interface RoomDataChannelDetail {
  peerId: string;
  channel: RTCDataChannel;
}

export interface RoomDataChannelMessageDetail extends RoomDataChannelDetail {
  data: unknown;
}

export interface P2PRoomEvents {
  peerJoined: { peerId: string };
  peerLeft: PeerLeftDetail;
  peerStream: PeerStreamDetail;
  peerTrack: PeerStreamDetail;
  dataChannel: RoomDataChannelDetail;
  dataChannelOpen: RoomDataChannelDetail;
  dataChannelMessage: RoomDataChannelMessageDetail;
  dataChannelClose: RoomDataChannelDetail;
  error: PeerErrorDetail;
}

export interface P2PRoomOptions {
  signaling: P2PRoomSignaling;
  peerId: string;
  localStream?: MediaStream | null;
  audioOnly?: boolean;
  dataChannel?: boolean;
  dataChannelLabel?: string;
  dataChannelOpenTimeoutMs?: number;
  rtcConfig?: RTCConfiguration;
  startTimeoutMs?: number;
  signal?: AbortSignal | null;
  onPeerStream?: (detail: PeerStreamDetail, event: CustomEvent) => void;
  onPeerTrack?: (detail: PeerStreamDetail, event: CustomEvent) => void;
  onPeerJoined?: (detail: { peerId: string }, event: CustomEvent) => void;
  onPeerLeft?: (detail: PeerLeftDetail, event: CustomEvent) => void;
  onDataChannel?: (detail: RoomDataChannelDetail, event: CustomEvent) => void;
  onDataChannelOpen?: (detail: RoomDataChannelDetail, event: CustomEvent) => void;
  onDataChannelMessage?: (
    detail: RoomDataChannelMessageDetail,
    event: CustomEvent,
  ) => void;
  onDataChannelClose?: (detail: RoomDataChannelDetail, event: CustomEvent) => void;
}

export interface P2PRoom {
  readonly peerId: string;
  readonly localStream: MediaStream | null;
  readonly pairs: Map<string, P2PSession>;
  readonly remoteStreams: Map<string, MediaStream>;
  readonly dataChannels: Map<string, RTCDataChannel>;
  readonly ready: Promise<void>;

  on<K extends keyof P2PRoomEvents>(
    type: K,
    callback: (detail: P2PRoomEvents[K], event: CustomEvent) => void,
  ): () => void;
  on(
    type: string,
    callback: (detail: unknown, event: CustomEvent) => void,
  ): () => void;
  off(type: string, callback: (...args: unknown[]) => void): void;
  send(peerId: string, data: unknown): void;
  broadcast(data: unknown): number;
  close(): void;
}

export function joinP2PRoom(options: P2PRoomOptions): Promise<P2PRoom>;

export interface PairSignalingWithClose extends DataSignalingChannel {
  close(): void;
}

export function createPairSignaling(
  source: DataSignalingChannel,
): PairSignalingWithClose;

export interface RoomSignalingWithClose extends P2PRoomSignaling {
  createPeerSignaling(options: P2PRoomPeerSignalingOptions): PairSignalingWithClose;
  close(): void;
}

export function createRoomSignaling(
  source: P2PRoomSignaling,
): RoomSignalingWithClose;

export interface AttachRemoteStreamOptions {
  onStream?: (detail: RemoteStreamDetail) => void;
  onTrack?: (detail: RemoteStreamDetail) => void;
}

export function attachRemoteStream(
  peerOrPc: EventTarget | { on?: (...args: unknown[]) => unknown; pc?: RTCPeerConnection },
  options?: AttachRemoteStreamOptions,
): () => void;

export interface DataChannelOptions {
  label?: string;
  rtcConfig?: RTCConfiguration;
  monitorRtt?: boolean;
  rttLabel?: string;
  dataChannelTimeoutMs?: number;
}

export interface DataChannelResult {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
}

export function createDataChannel(
  signaling: DataSignalingChannel,
  options?: DataChannelOptions,
): Promise<DataChannelResult>;

export function joinDataChannel(
  signaling: DataSignalingChannel,
  options?: DataChannelOptions,
): Promise<DataChannelResult>;

export function closeDataConnection(pc: RTCPeerConnection | null): void;

export declare const PEER_STATES: Readonly<{
  IDLE: 'idle';
  CONNECTING: 'connecting';
  CONNECTED: 'connected';
  DISCONNECTED: 'disconnected';
  FAILED: 'failed';
  CLOSED: 'closed';
}>;

export interface PeerEvents {
  statechange: StateChangeDetail;
  connected: Record<string, never>;
  disconnected: Record<string, never>;
  datachannel: DataChannelDetail;
  open: Record<string, never>;
  message: MessageDetail;
  close: Record<string, never>;
  error: ErrorDetail;
  track: { track: MediaStreamTrack; streams: MediaStream[] };
}

export declare class Peer extends EventTarget {
  constructor(options: {
    role: 'initiator' | 'joiner';
    signaling: DataSignalingChannel;
    localStream?: MediaStream | null;
    audioOnly?: boolean;
    dataChannel?: boolean;
    dataChannelLabel?: string;
    rtcConfig?: RTCConfiguration;
  });

  readonly role: 'initiator' | 'joiner';
  readonly state: PeerState;
  readonly pc: RTCPeerConnection | null;
  readonly dataChannel: RTCDataChannel | null;

  on<K extends keyof PeerEvents>(
    type: K,
    callback: (detail: PeerEvents[K], event: CustomEvent) => void,
  ): () => void;
  on(
    type: string,
    callback: (detail: unknown, event: CustomEvent) => void,
  ): () => void;

  once<K extends keyof PeerEvents>(
    type: K,
    callback: (detail: PeerEvents[K], event: CustomEvent) => void,
  ): () => void;

  off(type: string, callback: (...args: unknown[]) => void): void;
  send(data: unknown): void;
  close(): void;

  start(options?: {
    startTimeoutMs?: number;
    connectedTimeoutMs?: number;
    dataChannelOpenTimeoutMs?: number;
    signal?: AbortSignal | null;
  }): Promise<void>;
}

export function setLogger(fn: (...args: unknown[]) => void): void;
