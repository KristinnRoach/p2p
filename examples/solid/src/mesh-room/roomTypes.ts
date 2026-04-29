import type { Accessor } from 'solid-js';
import type { CreateRoomSignalingOptions, P2PRoomSignaling } from '@kidlib/p2p';

export type RoomStatus =
  | 'idle'
  | 'joining'
  | 'joined'
  | 'leaving'
  | 'full'
  | 'error';

export type RoomPeer = {
  peerId: string;
};

export type RoomRemoteStream = {
  peerId: string;
  stream: MediaStream;
};

export type JoinRoomOptions = {
  roomId: string;
  resetRoom?: boolean;
  media?: MediaStreamConstraints;
};

export type CreateMeshRoomOptions = {
  peerId?: string;
  maxPeers?: number;
  createSignaling: (options: CreateRoomSignalingOptions) => P2PRoomSignaling;
  resetRoom?: (roomId: string) => void;
};

export type MeshRoomController = {
  peerId: string;
  status: Accessor<RoomStatus>;
  error: Accessor<string | undefined>;
  localStream: Accessor<MediaStream | undefined>;
  peers: Accessor<RoomPeer[]>;
  remoteStreams: Accessor<RoomRemoteStream[]>;
  isJoining: Accessor<boolean>;
  isJoined: Accessor<boolean>;
  isLeaving: Accessor<boolean>;
  join: (options: JoinRoomOptions) => Promise<void>;
  leave: () => Promise<void>;
  close: () => void;
  send: (peerId: string, data: unknown) => void;
  broadcast: (data: unknown) => number;
};
