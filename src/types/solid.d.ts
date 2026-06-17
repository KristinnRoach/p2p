import type { Accessor } from 'solid-js';
import type {
  P2PRoom,
  P2PRoomOptions,
  P2PRoomPresenceMember,
  P2PRoomState,
  RemoteMemberStream,
} from './index.js';

export { setLogger } from './index.js';

export type SolidP2PRoomState =
  | P2PRoomState
  | 'idle'
  | 'creating'
  | 'full'
  | 'error';

export type SolidP2PRoomErrorKind =
  | 'room'
  | 'room-full'
  | 'local-stream'
  | 'peer';

export interface SolidP2PRoom {
  readonly room: Accessor<P2PRoom | undefined>;
  readonly ready: Accessor<Promise<P2PRoom | undefined>>;
  readonly state: Accessor<SolidP2PRoomState>;
  readonly error: Accessor<unknown>;
  readonly errorKind: Accessor<SolidP2PRoomErrorKind | undefined>;
  readonly localStream: Accessor<MediaStream | undefined>;
  readonly remoteMemberStreams: Accessor<RemoteMemberStream[]>;
  readonly members: Accessor<string[]>;
  readonly memberPresence: Accessor<P2PRoomPresenceMember[]>;
  readonly memberCount: Accessor<number>;
  readonly memberCapacity: Accessor<number | undefined>;
  readonly isFull: Accessor<boolean>;
  readonly dataChannels: Accessor<Map<string, RTCDataChannel>>;
  watch(options: P2PRoomOptions): Promise<P2PRoom | undefined>;
  join(options: P2PRoomOptions): Promise<P2PRoom | undefined>;
  leave(): Promise<void>;
  close(): void;
  send(memberId: string, data: unknown): void;
  broadcast(data: unknown): number;
}

export interface AttachMediaStreamOptions {
  autoplay?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  onPlaybackBlocked?: (error: unknown) => void;
  onPlaybackStarted?: () => void;
}

export interface MediaStreamAttachment {
  readonly ready: Promise<boolean>;
  readonly playbackBlocked: unknown;
  resumePlayback(): Promise<boolean>;
  detach(): void;
}

export interface SolidMediaPlayback {
  readonly playbackBlocked: Accessor<boolean>;
  readonly playbackError: Accessor<unknown>;
  attach(
    video: HTMLVideoElement,
    stream: MediaStream | null | undefined,
    options?: AttachMediaStreamOptions,
  ): Promise<boolean>;
  resumePlayback(): Promise<boolean>;
  detach(): void;
}

export function attachMediaStream(
  video: HTMLVideoElement,
  stream: MediaStream | null | undefined,
  options?: AttachMediaStreamOptions,
): MediaStreamAttachment;

export function createMediaPlayback(
  options?: AttachMediaStreamOptions,
): SolidMediaPlayback;

export function useP2PRoom(): SolidP2PRoom;
