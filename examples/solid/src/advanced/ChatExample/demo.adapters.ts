import { joinP2PRoom } from '@kidlib/p2p';
import type { P2PRoomSignaling, RtcSignalingSource } from '@kidlib/p2p';
import type { CreatePrivateRoom } from './chat.types';
import type { IncomingMessage, MessageTransport } from './chat.transport';
import type { InvitationSignaling, InviteCallbacks } from './chat.signaling';

const STORAGE_PREFIX = 'kidlib:chat:';
const MESH_PREFIX = 'kidlib:p2p:mesh-room:';
const PRESENCE_TTL_MS = 12000;
const PRESENCE_SWEEP_MS = 3000;

type StoredMessage = IncomingMessage & { roomId: string };

function messagesKey(roomId: string) {
  return `${STORAGE_PREFIX}${roomId}:messages`;
}

function readStored(roomId: string): StoredMessage[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(messagesKey(roomId)) ?? '[]',
    );
    return Array.isArray(parsed) ? (parsed as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

export const localStorageTransport: MessageTransport = {
  loadMessages(roomId) {
    return readStored(roomId).map(({ id, text, senderId, createdAt }) => ({
      id,
      text,
      senderId,
      createdAt,
    }));
  },

  send(roomId, senderId, text) {
    const message: StoredMessage = {
      id: crypto.randomUUID(),
      roomId,
      text,
      senderId,
      createdAt: Date.now(),
    };
    const messages = readStored(roomId);
    messages.push(message);
    localStorage.setItem(messagesKey(roomId), JSON.stringify(messages));
    return { id: message.id, createdAt: message.createdAt };
  },

  clear(roomId) {
    localStorage.removeItem(messagesKey(roomId));
  },

  subscribe(roomId, myPeerId, onMessage) {
    const key = messagesKey(roomId);
    let knownCount = readStored(roomId).length;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const messages = readStored(roomId);
      const newMessages = messages.slice(knownCount);
      knownCount = messages.length;
      for (const msg of newMessages) {
        if (msg.senderId !== myPeerId) onMessage(msg);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },
};

function createLocalStorageInvitationSignaling(
  prefix: string,
): InvitationSignaling {
  const requestKey = (chatRoomId: string) => `${prefix}${chatRoomId}:request`;
  const responseKey = (chatRoomId: string) => `${prefix}${chatRoomId}:response`;

  return {
    send(chatRoomId, fromPeerId, roomId) {
      localStorage.setItem(
        requestKey(chatRoomId),
        JSON.stringify({ from: fromPeerId, roomId, at: Date.now() }),
      );
    },

    respond(chatRoomId, accepted) {
      localStorage.setItem(
        responseKey(chatRoomId),
        JSON.stringify({ accepted, at: Date.now() }),
      );
      localStorage.removeItem(requestKey(chatRoomId));
    },

    cancel(chatRoomId) {
      localStorage.removeItem(requestKey(chatRoomId));
      localStorage.removeItem(responseKey(chatRoomId));
    },

    subscribe(chatRoomId, myPeerId, callbacks: InviteCallbacks) {
      const reqKey = requestKey(chatRoomId);
      const resKey = responseKey(chatRoomId);

      const onStorage = (event: StorageEvent) => {
        if (event.key === reqKey && event.newValue) {
          try {
            const data = JSON.parse(event.newValue) as {
              from: string;
              roomId: string;
            };
            if (data.from !== myPeerId)
              callbacks.onRequest(data.from, data.roomId);
          } catch {
            return;
          }
        }
        if (
          event.key === reqKey &&
          event.newValue === null &&
          event.oldValue !== null
        ) {
          callbacks.onCancel?.();
        }
        if (event.key === resKey && event.newValue) {
          try {
            const data = JSON.parse(event.newValue) as { accepted: boolean };
            callbacks.onResponse(data.accepted);
            localStorage.removeItem(resKey);
          } catch {
            return;
          }
        }
      };

      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

export const localStoragePrivateSignaling =
  createLocalStorageInvitationSignaling('kidlib:chat:private-invite:');

export const localStorageCallSignaling = createLocalStorageInvitationSignaling(
  'kidlib:chat:call-invite:',
);

export function createWebSocketInvitationSignaling(options: {
  url: string;
  topic: string;
}): InvitationSignaling {
  const { url, topic } = options;
  const namespacedRoom = (chatRoomId: string) => `${topic}:${chatRoomId}`;

  let socket: WebSocket | null = null;
  let openPromise: Promise<void> | null = null;
  let activeChatRoomId: string | null = null;
  let myPeerId: string | null = null;
  let callbacks: InviteCallbacks | null = null;

  const ensureOpen = (chatRoomId: string, peerId: string) => {
    if (socket && activeChatRoomId === chatRoomId) return openPromise!;
    socket?.close();
    activeChatRoomId = chatRoomId;
    myPeerId = peerId;
    const ws = new WebSocket(url);
    socket = ws;
    openPromise = new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({
            type: 'join-room',
            roomId: namespacedRoom(chatRoomId),
            peerId,
          }),
        );
        resolve();
      });
      ws.addEventListener('error', (event) => reject(event));
    });
    ws.addEventListener('message', (event) => {
      let msg: {
        type?: string;
        roomId?: string;
        kind?: 'request' | 'response' | 'cancel';
        from?: string;
        privateRoomId?: string;
        accepted?: boolean;
      };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type !== 'invite' || msg.roomId !== namespacedRoom(chatRoomId)) {
        return;
      }
      if (!callbacks) return;
      if (
        msg.kind === 'request' &&
        msg.from &&
        msg.from !== myPeerId &&
        msg.privateRoomId
      ) {
        callbacks.onRequest(msg.from, msg.privateRoomId);
      } else if (msg.kind === 'response') {
        callbacks.onResponse(Boolean(msg.accepted));
      } else if (msg.kind === 'cancel') {
        callbacks.onCancel?.();
      }
    });
    return openPromise;
  };

  const sendInvite = async (
    chatRoomId: string,
    payload: Record<string, unknown>,
  ) => {
    if (!myPeerId) return;
    await ensureOpen(chatRoomId, myPeerId);
    socket?.send(
      JSON.stringify({
        type: 'invite',
        roomId: namespacedRoom(chatRoomId),
        ...payload,
      }),
    );
  };

  return {
    async subscribe(chatRoomId, peerId, cbs) {
      callbacks = cbs;
      await ensureOpen(chatRoomId, peerId);
      return () => {
        callbacks = null;
        socket?.close();
        socket = null;
        openPromise = null;
        activeChatRoomId = null;
      };
    },
    async send(chatRoomId, fromPeerId, privateRoomId) {
      myPeerId = fromPeerId;
      await sendInvite(chatRoomId, { kind: 'request', privateRoomId });
    },
    async respond(chatRoomId, accepted) {
      await sendInvite(chatRoomId, { kind: 'response', accepted });
    },
    async cancel(chatRoomId) {
      await sendInvite(chatRoomId, { kind: 'cancel' });
    },
  };
}

export const createBrowserMeshPrivateRoom: CreatePrivateRoom = ({
  roomId,
  peerId,
  createRtcSignaling,
}) =>
  joinP2PRoom({
    roomId,
    peerId,
    createSignaling:
      createRtcSignaling ??
      (({ roomId }) => createBrowserMeshRoomSignaling(roomId)),
    dataChannel: true,
    memberCapacity: 6,
  });

export function createBrowserMeshRoomSignaling(
  roomId: string,
): P2PRoomSignaling {
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const key = peersKey(roomId);

  return {
    join: async (peerId) => {
      await refreshPresence(roomId, key, peerId);
    },
    leave: async (peerId) => {
      await updatePresence(roomId, key, (peers) =>
        peers.filter((entry) => entry.peerId !== peerId),
      );
    },
    refreshPresence: async (peerId) => {
      await refreshPresence(roomId, key, peerId);
    },
    onPeers: (callback) => {
      const emit = () => callback(readActivePeerIds(roomId, key));
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) emit();
      };

      window.addEventListener('storage', onStorage);
      channel?.addEventListener('message', emit);
      const sweep = setInterval(emit, PRESENCE_SWEEP_MS);
      queueMicrotask(emit);

      return () => {
        window.removeEventListener('storage', onStorage);
        channel?.removeEventListener('message', emit);
        clearInterval(sweep);
      };
    },
    createPeerSignaling: ({ localPeerId, remotePeerId }) =>
      createBrowserMeshPairSource({ roomId, localPeerId, remotePeerId }),
    cleanupSignaling() {
      channel?.close();
    },
  };
}

type PresenceEntry = {
  peerId: string;
  lastSeen: number;
};

function createBrowserMeshPairSource(options: {
  roomId: string;
  localPeerId: string;
  remotePeerId: string;
}): RtcSignalingSource {
  const { roomId, localPeerId, remotePeerId } = options;
  const pair = pairId(localPeerId, remotePeerId);
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const keys = {
    offer: `${MESH_PREFIX}${roomId}:pair:${pair}:offer`,
    answer: `${MESH_PREFIX}${roomId}:pair:${pair}:answer`,
    localCandidates: `${MESH_PREFIX}${roomId}:pair:${pair}:candidates:${localPeerId}`,
    remoteCandidates: `${MESH_PREFIX}${roomId}:pair:${pair}:candidates:${remotePeerId}`,
  };

  const subscribe = <T>(key: string, callback: (value: T) => void) => {
    let latestJson = JSON.stringify(readJson<T | undefined>(key, undefined));
    let hasEmitted = false;
    const emitIfChanged = () => {
      const value = readJson<T | undefined>(key, undefined);
      const nextJson = JSON.stringify(value);
      if (nextJson === latestJson) return;
      latestJson = nextJson;
      if (value != null) {
        hasEmitted = true;
        callback(value);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) emitIfChanged();
    };
    const onBroadcast = () => emitIfChanged();

    window.addEventListener('storage', onStorage);
    channel?.addEventListener('message', onBroadcast);
    queueMicrotask(() => {
      const value = readJson<T | undefined>(key, undefined);
      latestJson = JSON.stringify(value);
      if (value != null && !hasEmitted) {
        hasEmitted = true;
        callback(value);
      }
    });

    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onBroadcast);
    };
  };

  return {
    sendOffer: async (offer) => writeJson(roomId, keys.offer, offer),
    sendAnswer: async (answer) => writeJson(roomId, keys.answer, answer),
    onOffer: (callback) =>
      subscribe<RTCSessionDescriptionInit>(keys.offer, callback),
    onAnswer: (callback) =>
      subscribe<RTCSessionDescriptionInit>(keys.answer, callback),
    sendCandidate: async (candidate) => {
      const candidates = readJson<RTCIceCandidateInit[]>(
        keys.localCandidates,
        [],
      );
      candidates.push(candidate);
      writeJson(roomId, keys.localCandidates, candidates);
    },
    onRemoteCandidate: (callback) => {
      let remoteCandidateIndex = 0;
      return subscribe<RTCIceCandidateInit[]>(
        keys.remoteCandidates,
        (candidates) => {
          for (const candidate of candidates.slice(remoteCandidateIndex)) {
            callback(candidate);
          }
          remoteCandidateIndex = candidates.length;
        },
      );
    },
  };
}

function pairId(a: string, b: string) {
  return [a, b].sort().join(':');
}

function peersKey(roomId: string) {
  return `${MESH_PREFIX}${roomId}:peers`;
}

function roomChannelName(roomId: string) {
  return `${MESH_PREFIX}${roomId}:events`;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function readPresence(key: string): PresenceEntry[] {
  const rawPeers = readJson<unknown[]>(key, []);
  if (!Array.isArray(rawPeers)) return [];
  return rawPeers
    .map((entry) => {
      if (typeof entry === 'string') return { peerId: entry, lastSeen: 0 };
      if (
        entry &&
        typeof entry === 'object' &&
        'peerId' in entry &&
        typeof entry.peerId === 'string'
      ) {
        return {
          peerId: entry.peerId,
          lastSeen:
            'lastSeen' in entry && typeof entry.lastSeen === 'number'
              ? entry.lastSeen
              : 0,
        };
      }
      return null;
    })
    .filter((entry): entry is PresenceEntry => entry != null);
}

function readActivePeerIds(roomId: string, key: string) {
  const now = Date.now();
  const peers = readPresence(key);
  const active = peers.filter(
    (entry) => now - entry.lastSeen < PRESENCE_TTL_MS,
  );
  const activePeerIds = active.map((entry) => entry.peerId);
  if (active.length !== peers.length) {
    void updatePresence(roomId, key, (latestPeers) =>
      latestPeers.filter((entry) => now - entry.lastSeen < PRESENCE_TTL_MS),
    );
  }
  return activePeerIds;
}

function refreshPresence(roomId: string, key: string, peerId: string) {
  const now = Date.now();
  return updatePresence(roomId, key, (peers) => [
    ...peers.filter(
      (entry) =>
        entry.peerId !== peerId && now - entry.lastSeen < PRESENCE_TTL_MS,
    ),
    { peerId, lastSeen: now },
  ]);
}

async function updatePresence(
  roomId: string,
  key: string,
  updater: (peers: PresenceEntry[]) => PresenceEntry[],
) {
  return withPresenceLock(roomId, () => {
    writeJson(roomId, key, updater(readPresence(key)));
  });
}

function withPresenceLock(roomId: string, callback: () => void) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === 'function') {
    return locks.request(`${MESH_PREFIX}${roomId}:presence`, callback);
  }
  return callback();
}

function writeJson(roomId: string, key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  if ('BroadcastChannel' in globalThis) {
    const channel = new BroadcastChannel(roomChannelName(roomId));
    channel.postMessage({ type: 'meshChanged' });
    channel.close();
  }
}
