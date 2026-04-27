import { createSignalingChannel } from '@kidlib/p2p';

const prefix = 'kidlib:p2p:browser-tab-room:';

export function createBrowserTabSignaling({ roomId, role }) {
  if (!roomId) {
    throw new Error('createBrowserTabSignaling: roomId is required');
  }
  if (role !== 'host' && role !== 'guest') {
    throw new Error('createBrowserTabSignaling: role must be host or guest');
  }

  const key = `${prefix}${roomId}`;
  const channelName = `${key}:events`;
  const keys = {
    offer: `${key}:offer`,
    answer: `${key}:answer`,
    hostCandidates: `${key}:host-candidates`,
    guestCandidates: `${key}:guest-candidates`,
  };
  const broadcast =
    'BroadcastChannel' in globalThis ? new BroadcastChannel(channelName) : null;
  const localCandidates =
    role === 'host' ? 'hostCandidates' : 'guestCandidates';
  const remoteCandidates =
    role === 'host' ? 'guestCandidates' : 'hostCandidates';
  let remoteCandidateIndex = 0;

  const readJson = (storageKey, fallback) => {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : fallback;
  };

  const writeJson = (storageKey, value) => {
    localStorage.setItem(storageKey, JSON.stringify(value));
    broadcast?.postMessage({ type: 'roomChanged' });
  };

  const readRoom = () => ({
    offer: readJson(keys.offer, null),
    answer: readJson(keys.answer, null),
    hostCandidates: readJson(keys.hostCandidates, []),
    guestCandidates: readJson(keys.guestCandidates, []),
  });

  const writeRoom = (nextRoom) => {
    writeJson(keys.offer, nextRoom.offer);
    writeJson(keys.answer, nextRoom.answer);
    writeJson(keys.hostCandidates, nextRoom.hostCandidates);
    writeJson(keys.guestCandidates, nextRoom.guestCandidates);
  };

  const appendCandidate = (storageKey, candidate) => {
    const candidates = readJson(storageKey, []);
    candidates.push(candidate);
    writeJson(storageKey, candidates);
  };

  const isRoomStorageKey = (storageKey) =>
    Object.values(keys).includes(storageKey);

  const readLegacyRoom = () => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : createEmptyRoom();
  };

  const updateRoom = (update) => {
    const nextRoom = { ...readLegacyRoom(), ...readRoom() };
    update(nextRoom);
    writeRoom(nextRoom);
  };

  const subscribe = (readValue, callback) => {
    let latestJson = JSON.stringify(readValue(readRoom()));

    const emitIfChanged = () => {
      const value = readValue(readRoom());
      const nextJson = JSON.stringify(value);
      if (nextJson === latestJson) return;
      latestJson = nextJson;
      if (value != null) callback(value);
    };

    const onStorage = (event) => {
      if (isRoomStorageKey(event.key) || event.key === key) {
        emitIfChanged();
      }
    };
    const onBroadcast = () => emitIfChanged();

    window.addEventListener('storage', onStorage);
    broadcast?.addEventListener('message', onBroadcast);
    queueMicrotask(() => {
      const value = readValue(readRoom());
      if (value != null) callback(value);
    });

    return () => {
      window.removeEventListener('storage', onStorage);
      broadcast?.removeEventListener('message', onBroadcast);
    };
  };

  const source = {
    sendOffer: async (offer) => {
      updateRoom((room) => {
        room.offer = offer;
      });
    },
    sendAnswer: async (answer) => {
      updateRoom((room) => {
        room.answer = answer;
      });
    },
    onOffer: (callback) => subscribe((room) => room.offer, callback),
    onAnswer: (callback) => subscribe((room) => room.answer, callback),
    sendCandidate: async (candidate) => {
      appendCandidate(keys[localCandidates], candidate);
    },
    onRemoteCandidate: (callback) =>
      subscribe(
        (room) => room[remoteCandidates],
        (candidates) => {
          for (const candidate of candidates.slice(remoteCandidateIndex)) {
            callback(candidate);
          }
          remoteCandidateIndex = candidates.length;
        },
      ),
  };

  const signaling = createSignalingChannel(source);
  const close = signaling.close;

  return {
    ...signaling,
    close() {
      close();
      broadcast?.close();
    },
  };
}

export function clearBrowserTabSignalingRoom(roomId) {
  const key = `${prefix}${roomId}`;
  localStorage.removeItem(key);
  localStorage.removeItem(`${key}:offer`);
  localStorage.removeItem(`${key}:answer`);
  localStorage.removeItem(`${key}:host-candidates`);
  localStorage.removeItem(`${key}:guest-candidates`);
}

function createEmptyRoom() {
  return {
    offer: null,
    answer: null,
    hostCandidates: [],
    guestCandidates: [],
  };
}
