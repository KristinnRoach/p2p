const prefix = 'kidlib:p2p:mesh-room:';

export function createBrowserMeshRoomSignaling(roomId) {
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const key = peersKey(roomId);

  return {
    join: async (peerId) => {
      const peers = readJson(key, []);
      writeJson(roomId, key, [...new Set([...peers, peerId])]);
    },
    leave: async (peerId) => {
      const peers = readJson(key, []);
      writeJson(
        roomId,
        key,
        peers.filter((id) => id !== peerId),
      );
    },
    onPeers: (callback) => {
      const emit = () => callback(readJson(key, []));
      const onStorage = (event) => {
        if (event.key === key) emit();
      };

      window.addEventListener('storage', onStorage);
      channel?.addEventListener('message', emit);
      queueMicrotask(emit);

      return () => {
        window.removeEventListener('storage', onStorage);
        channel?.removeEventListener('message', emit);
      };
    },
    createPeerSignaling: ({ localPeerId, remotePeerId }) =>
      createBrowserMeshPairSource({ roomId, localPeerId, remotePeerId }),
    close() {
      channel?.close();
    },
  };
}

export function clearBrowserMeshRoom(roomId) {
  const roomPrefix = `${prefix}${roomId}:`;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(roomPrefix)) localStorage.removeItem(key);
  }
}

function createBrowserMeshPairSource({ roomId, localPeerId, remotePeerId }) {
  const pair = pairId(localPeerId, remotePeerId);
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const keys = {
    offer: `${prefix}${roomId}:pair:${pair}:offer`,
    answer: `${prefix}${roomId}:pair:${pair}:answer`,
    localCandidates: `${prefix}${roomId}:pair:${pair}:candidates:${localPeerId}`,
    remoteCandidates: `${prefix}${roomId}:pair:${pair}:candidates:${remotePeerId}`,
  };
  let remoteCandidateIndex = 0;

  const subscribe = (key, callback) => {
    let latestJson = JSON.stringify(readJson(key, undefined));
    const emitIfChanged = () => {
      const value = readJson(key, undefined);
      const nextJson = JSON.stringify(value);
      if (nextJson === latestJson) return;
      latestJson = nextJson;
      if (value != null) callback(value);
    };
    const onStorage = (event) => {
      if (event.key === key) emitIfChanged();
    };
    const onBroadcast = () => emitIfChanged();

    window.addEventListener('storage', onStorage);
    channel?.addEventListener('message', onBroadcast);
    queueMicrotask(() => {
      const value = readJson(key, undefined);
      if (value != null) callback(value);
    });

    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onBroadcast);
    };
  };

  return {
    sendOffer: async (offer) => writeJson(roomId, keys.offer, offer),
    sendAnswer: async (answer) => writeJson(roomId, keys.answer, answer),
    onOffer: (callback) => subscribe(keys.offer, callback),
    onAnswer: (callback) => subscribe(keys.answer, callback),
    sendCandidate: async (candidate) => {
      const candidates = readJson(keys.localCandidates, []);
      candidates.push(candidate);
      writeJson(roomId, keys.localCandidates, candidates);
    },
    onRemoteCandidate: (callback) =>
      subscribe(keys.remoteCandidates, (candidates) => {
        for (const candidate of candidates.slice(remoteCandidateIndex)) {
          callback(candidate);
        }
        remoteCandidateIndex = candidates.length;
      }),
    close() {
      channel?.close();
    },
  };
}

function pairId(a, b) {
  return [a, b].sort().join(':');
}

function peersKey(roomId) {
  return `${prefix}${roomId}:peers`;
}

function roomChannelName(roomId) {
  return `${prefix}${roomId}:events`;
}

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function writeJson(roomId, key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  const channel = new BroadcastChannel(roomChannelName(roomId));
  channel.postMessage({ type: 'meshChanged' });
  channel.close();
}
