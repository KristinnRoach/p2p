const prefix = 'kidlib:p2p:mesh-room:';
const presenceTtlMs = 12000;
const presenceSweepMs = 3000;

export function createBrowserMeshRoomSignaling(roomId) {
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const key = peersKey(roomId);

  return {
    join: async (peerId) => {
      refreshPresence(roomId, key, peerId);
    },
    leave: async (peerId) => {
      writeJson(
        roomId,
        key,
        readPresence(key).filter((entry) => entry.peerId !== peerId),
      );
    },
    refreshPresence: async (peerId) => {
      refreshPresence(roomId, key, peerId);
    },
    onPeers: (callback) => {
      const emit = () => callback(readActivePeerIds(roomId, key));
      const onStorage = (event) => {
        if (event.key === key) emit();
      };

      window.addEventListener('storage', onStorage);
      channel?.addEventListener('message', emit);
      const sweep = setInterval(emit, presenceSweepMs);
      queueMicrotask(emit);

      return () => {
        window.removeEventListener('storage', onStorage);
        channel?.removeEventListener('message', emit);
        clearInterval(sweep);
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

function readPresence(key) {
  const rawPeers = readJson(key, []);
  if (!Array.isArray(rawPeers)) return [];
  return rawPeers
    .map((entry) => {
      if (typeof entry === 'string') return { peerId: entry, lastSeen: 0 };
      if (entry && typeof entry.peerId === 'string') {
        return {
          peerId: entry.peerId,
          lastSeen: Number(entry.lastSeen) || 0,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function readActivePeerIds(roomId, key) {
  const now = Date.now();
  const peers = readPresence(key);
  const active = peers.filter((entry) => now - entry.lastSeen < presenceTtlMs);
  const activePeerIds = active.map((entry) => entry.peerId);
  if (active.length !== peers.length) {
    writeJson(roomId, key, active);
  }
  return activePeerIds;
}

function refreshPresence(roomId, key, peerId) {
  const now = Date.now();
  const peers = readPresence(key).filter(
    (entry) => entry.peerId !== peerId && now - entry.lastSeen < presenceTtlMs,
  );
  writeJson(roomId, key, [...peers, { peerId, lastSeen: now }]);
}

function writeJson(roomId, key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  const channel = new BroadcastChannel(roomChannelName(roomId));
  channel.postMessage({ type: 'meshChanged' });
  channel.close();
}
