import type { Accessor } from 'solid-js';
import type {
  P2PRoom,
  P2PRoomOptions,
  P2PRoomState,
  RemoteMemberStream,
} from './index.js';

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
  readonly memberCount: Accessor<number>;
  readonly memberCapacity: Accessor<number | undefined>;
  readonly isFull: Accessor<boolean>;
  join(options: P2PRoomOptions): Promise<P2PRoom | undefined>;
  leave(): Promise<void>;
  close(): void;
  send(memberId: string, data: unknown): void;
  broadcast(data: unknown): number;
}

export function useP2PRoom(): SolidP2PRoom;
