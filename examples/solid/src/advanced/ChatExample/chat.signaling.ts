export type InviteCallbacks = {
  onRequest: (fromPeerId: string, roomId: string) => void;
  onResponse: (accepted: boolean) => void;
  onCancel?: () => void;
};

export type InvitationSignaling = {
  send(chatRoomId: string, fromPeerId: string, roomId: string): void | Promise<void>;
  respond(chatRoomId: string, accepted: boolean): void | Promise<void>;
  cancel(chatRoomId: string): void | Promise<void>;
  subscribe(
    chatRoomId: string,
    myPeerId: string,
    callbacks: InviteCallbacks,
  ): (() => void) | Promise<() => void>;
};
