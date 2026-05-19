export type P2PChatEnvelope = {
  type: 'chat';
  id: string;
  text: string;
  senderId: string;
  createdAt: number;
};

export type IncomingMessage = {
  id: string;
  text: string;
  senderId: string;
  createdAt: number;
};

export type MessageTransport = {
  loadMessages(roomId: string): IncomingMessage[] | Promise<IncomingMessage[]>;
  send(
    roomId: string,
    senderId: string,
    text: string,
  ): { id: string; createdAt: number } | Promise<{ id: string; createdAt: number }>;
  subscribe(
    roomId: string,
    myPeerId: string,
    onMessage: (msg: IncomingMessage) => void,
  ): (() => void) | Promise<() => void>;
  clear(roomId: string): void | Promise<void>;
};
