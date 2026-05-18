import type {
  CreateRoomSignalingOptions,
  P2PRoom,
  P2PRoomOptions,
  P2PRoomSignaling,
  RemoteMemberStream,
} from '../types/index.js';

export interface P2PComponentsOptions {
  createSignaling?: (
    options: CreateRoomSignalingOptions,
  ) => P2PRoomSignaling | Promise<P2PRoomSignaling>;
  getLocalStream?: () => MediaStream | Promise<MediaStream | null> | null;
  roomOptions?: Partial<P2PRoomOptions>;
}

export interface P2PRoomSnapshot {
  room: P2PRoom | null;
  roomId: string;
  peerId: string;
  state: 'idle' | P2PRoom['state'];
  error: string;
  memberCount: number;
  memberCapacity: number;
  localStream: MediaStream | null;
  remoteStreams: RemoteMemberStream[];
  openDataChannels: number;
}

export interface P2PChatMessage {
  type: string;
  id: string;
  text: string;
  senderId: string;
  createdAt: number;
  memberId?: string;
  local?: boolean;
}

export function configureP2PComponents(options?: P2PComponentsOptions): void;
export function defineP2PComponents(options?: P2PComponentsOptions): void;
export function defineP2PRoom(): void;
export function defineP2PRoomControls(): void;
export function defineP2PRoomStatus(): void;
export function defineP2PVideoGrid(): void;
export function defineP2PChat(): void;

export declare class P2PRoomElement extends HTMLElement {
  room: P2PRoom | null;
  peerId: string;
  createSignaling: P2PComponentsOptions['createSignaling'] | null;
  getLocalStream: P2PComponentsOptions['getLocalStream'] | null;
  roomOptions: Partial<P2PRoomOptions> | null;
  state: P2PRoomSnapshot['state'];
  error: string;
  localStream: MediaStream | null;
  remoteStreams: RemoteMemberStream[];

  roomId: string;
  memberCapacity: number;

  subscribe(callback: (snapshot: P2PRoomSnapshot) => void): () => void;
  addChatListener(): void;
  removeChatListener(): void;
  join(): Promise<void>;
  leave(): void;
  sendChat(text: string): number;
  syncFromRoom(): void;
  snapshot(): P2PRoomSnapshot;
  notify(): void;
  setError(message: string): void;
}

export declare class P2PRoomControlsElement extends HTMLElement {}
export declare class P2PRoomStatusElement extends HTMLElement {}
export declare class P2PVideoGridElement extends HTMLElement {}
export declare class P2PChatElement extends HTMLElement {
  maxMessages: number;
}
