const prefix = 'kidlib:p2p:mesh-room:';
const presenceTtlMs = 12000;
const presenceSweepMs = 3000;

export function createBroadcastRoomSignaling(roomId) {
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const key = peersKey(roomId);

  return {
    join: async (peerId, data) => {
      await refreshPresence(roomId, key, peerId, data);
    },
    leave: async (peerId) => {
      await updatePresence(
        roomId,
        key,
        (peers) => peers.filter((entry) => entry.peerId !== peerId),
        [{ memberId: peerId, reason: 'left' }],
      );
    },
    refreshPresence: async (peerId, data) => {
      await refreshPresence(roomId, key, peerId, data);
    },
    updatePresenceData: async (peerId, data) => {
      await updatePresenceData(roomId, key, peerId, data);
    },
    onPeers: (callback) => {
      const emitCurrentPresence = () =>
        callback(readActivePresence(roomId, key));
      const emitPresenceTransition = (storedState) =>
        callback(
          readActivePresence(
            roomId,
            key,
            normalizePresenceState(storedState),
          ),
        );
      const onStorage = (event) => {
        if (event.key !== key) return;
        emitPresenceTransition(parseJson(event.newValue, { members: [] }));
      };
      const onBroadcast = (event) => {
        const message = event.data;
        if (message?.type !== 'meshChanged' || message.key !== key) return;
        emitPresenceTransition(message.value);
      };

      if (channel) channel.addEventListener('message', onBroadcast);
      else window.addEventListener('storage', onStorage);
      const sweep = setInterval(emitCurrentPresence, presenceSweepMs);
      queueMicrotask(emitCurrentPresence);

      return () => {
        if (channel) channel.removeEventListener('message', onBroadcast);
        else window.removeEventListener('storage', onStorage);
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

export function clearBroadcastRoomSignaling(roomId) {
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
  const subscribe = (key, callback) => {
    let latestJson = JSON.stringify(readJson(key, undefined));
    let hasEmitted = false;
    const emitIfChanged = () => {
      const value = readJson(key, undefined);
      const nextJson = JSON.stringify(value);
      if (nextJson === latestJson) return;
      latestJson = nextJson;
      if (value != null) {
        hasEmitted = true;
        callback(value);
      }
    };
    const onStorage = (event) => {
      if (event.key === key) emitIfChanged();
    };
    const onBroadcast = () => emitIfChanged();

    window.addEventListener('storage', onStorage);
    channel?.addEventListener('message', onBroadcast);
    queueMicrotask(() => {
      const value = readJson(key, undefined);
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
    onOffer: (callback) => subscribe(keys.offer, callback),
    onAnswer: (callback) => subscribe(keys.answer, callback),
    sendCandidate: async (candidate) => {
      const candidates = readJson(keys.localCandidates, []);
      candidates.push(candidate);
      writeJson(roomId, keys.localCandidates, candidates);
    },
    onRemoteCandidate: (callback) => {
      let remoteCandidateIndex = 0;
      return subscribe(keys.remoteCandidates, (candidates) => {
        for (const candidate of candidates.slice(remoteCandidateIndex)) {
          callback(candidate);
        }
        remoteCandidateIndex = candidates.length;
      });
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

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readPresenceState(key) {
  return normalizePresenceState(readJson(key, { members: [] }));
}

function normalizePresenceState(stored) {
  const rawPeers = Array.isArray(stored) ? stored : stored?.members;
  if (!Array.isArray(rawPeers)) return { members: [], departed: [] };
  const members = rawPeers
    .map((entry) => {
      if (typeof entry === 'string') return { peerId: entry, lastSeen: 0 };
      if (entry && typeof entry.peerId === 'string') {
        const normalized = {
          peerId: entry.peerId,
          lastSeen: Number(entry.lastSeen) || 0,
        };
        if (isPresenceData(entry.data)) normalized.data = entry.data;
        return normalized;
      }
      return null;
    })
    .filter(Boolean);
  const departed = Array.isArray(stored?.departed) ? stored.departed : [];
  return { members, departed };
}

function readActivePresence(roomId, key, state = readPresenceState(key)) {
  const now = Date.now();
  const peers = state.members;
  const active = peers.filter((entry) => now - entry.lastSeen < presenceTtlMs);
  if (active.length !== peers.length) {
    void updatePresence(roomId, key, (latestPeers) =>
      latestPeers.filter((entry) => now - entry.lastSeen < presenceTtlMs),
    );
    return { members: toPresenceMembers(active) };
  }
  return {
    members: toPresenceMembers(active),
    ...(state.departed.length > 0 ? { departed: state.departed } : {}),
  };
}

function refreshPresence(roomId, key, peerId, data) {
  const now = Date.now();
  return updatePresence(roomId, key, (peers) => {
    let found = false;
    const activePeers = peers
      .filter(
        (entry) =>
          entry.peerId === peerId || now - entry.lastSeen < presenceTtlMs,
      )
      .map((entry) => {
        if (entry.peerId !== peerId) return entry;
        found = true;
        return data === undefined
          ? { ...entry, lastSeen: now }
          : { peerId, lastSeen: now, data };
      });

    if (!found) {
      activePeers.push(
        data === undefined
          ? { peerId, lastSeen: now }
          : { peerId, lastSeen: now, data },
      );
    }
    return activePeers;
  });
}

function updatePresenceData(roomId, key, peerId, data) {
  return updatePresence(roomId, key, (peers) =>
    peers.map((entry) =>
      entry.peerId === peerId ? { ...entry, data } : entry,
    ),
  );
}

async function updatePresence(roomId, key, updater, departed = []) {
  return withPresenceLock(roomId, () => {
    const members = updater(readPresenceState(key).members);
    writeJson(roomId, key, {
      members,
      ...(departed.length > 0 ? { departed } : {}),
    });
  });
}

function withPresenceLock(roomId, callback) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === 'function') {
    return locks.request(`${prefix}${roomId}:presence`, callback);
  }
  return callback();
}

function writeJson(roomId, key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if ('BroadcastChannel' in globalThis) {
    const channel = new BroadcastChannel(roomChannelName(roomId));
    channel.postMessage({ type: 'meshChanged', key, value });
    channel.close();
  }
}

function toPresenceMembers(peers) {
  return peers.map((entry) =>
    entry.data === undefined
      ? { memberId: entry.peerId }
      : { memberId: entry.peerId, data: entry.data },
  );
}

function isPresenceData(data) {
  return data != null && typeof data === 'object' && !Array.isArray(data);
}
