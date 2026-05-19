// adapters/mock/chat-repo.ts

export type ChatRepoMessage = {
  id: string;
  roomId: string;
  text: string;
  senderId: string;
  createdAt: number;
};

type SendMessageInput = {
  roomId: string;
  text: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const db: ChatRepoMessage[] = [
  {
    id: crypto.randomUUID(),
    roomId: 'general',
    text: 'Hey, this is a dummy message.',
    senderId: 'alice',
    createdAt: Date.now() - 1000 * 60 * 3,
  },
  {
    id: crypto.randomUUID(),
    roomId: 'general',
    text: 'Nice — the PoC is working.',
    senderId: 'bob',
    createdAt: Date.now() - 1000 * 60,
  },
];

export const chatRepo = {
  async getMessages(roomId: string): Promise<ChatRepoMessage[]> {
    await wait(250);

    return db
      .filter((message) => message.roomId === roomId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((message) => ({ ...message }));
  },

  async sendMessage(input: SendMessageInput): Promise<ChatRepoMessage> {
    await wait(500);

    const message: ChatRepoMessage = {
      id: crypto.randomUUID(),
      roomId: input.roomId,
      text: input.text,
      senderId: 'me',
      createdAt: Date.now(),
    };

    db.push(message);

    return { ...message };
  },
};
