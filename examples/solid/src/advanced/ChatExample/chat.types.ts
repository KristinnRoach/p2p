import type { P2PRoom, P2PRoomSignaling } from '@kidlib/p2p';
import type { InvitationSignaling } from './chat.signaling';
import type { MessageTransport } from './chat.transport';
import type { ChatDebugMode } from './chat.debug';

export type CreatePrivateRoom = (options: {
  roomId: string;
  peerId: string;
  createRtcSignaling?: (options: { roomId: string }) => P2PRoomSignaling;
}) => Promise<P2PRoom>;

export type CallChannelAdapter = {
  getPeerCount(): number;
  broadcast(data: string): void;
  onMessage(callback: (data: string) => void): () => void;
  onMemberJoined?: (
    callback: (detail: { memberId: string }) => void,
  ) => () => void;
  onMemberLeft?: (
    callback: (detail: {
      memberId: string;
      stream: MediaStream | null;
    }) => void,
  ) => () => void;
};

export type PrivateChatConfig = {
  signaling: InvitationSignaling;
  createRoom: CreatePrivateRoom;
};

export type ChatExampleConfig = {
  roomId: string;
  peerId: string;
  messageTransport: MessageTransport;
  privateChat?: PrivateChatConfig;
  callChannel?: CallChannelAdapter;
  debugMode?: ChatDebugMode;
  createRtcSignaling?: (options: { roomId: string }) => P2PRoomSignaling;
};
