import { createSignal, onCleanup } from 'solid-js';
import {
  createSignalingChannel,
  joinP2PSession,
  startP2PSession,
} from '@kidlib/p2p';

export type CallRole = 'initiator' | 'joiner';

type P2PSession = Awaited<ReturnType<typeof startP2PSession>>;
type RemoteStream = { peerId: string; stream: MediaStream };

const prefix = 'kidlib:p2p:mesh-room:';

export function useP2PCall() {
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remoteStreams, setRemoteStreams] = createSignal<RemoteStream[]>([]);
  const [isStarting, setIsStarting] = createSignal(false);
  const [isInCall, setIsInCall] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const localPeerId = crypto.randomUUID();
  const sessions = new Map<string, P2PSession>();
  const sessionControllers = new Map<string, AbortController>();
  const signalings = new Map<
    string,
    ReturnType<typeof createMeshPairSignaling>
  >();
  let roomId: string | undefined;
  let local: MediaStream | undefined;
  let roomBroadcast: BroadcastChannel | undefined;
  let roomCleanup: (() => void) | undefined;

  async function start(nextRoomId: string, role: CallRole) {
    if (isStarting() || isInCall()) return;

    setIsStarting(true);
    setError(undefined);
    roomId = nextRoomId;

    if (role === 'initiator') clearMeshRoom(nextRoomId);

    try {
      local = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(local);
      setIsInCall(true);

      roomBroadcast =
        'BroadcastChannel' in globalThis
          ? new BroadcastChannel(roomChannelName(nextRoomId))
          : undefined;
      roomCleanup = watchPeers(nextRoomId, (peerIds) => {
        for (const peerId of peerIds) {
          if (peerId !== localPeerId) connectPeer(peerId);
        }
        for (const peerId of sessions.keys()) {
          if (!peerIds.includes(peerId)) closePeer(peerId);
        }
      });
      addPeer(nextRoomId, localPeerId);
    } catch (err) {
      console.error(err);
      setError('Could not start room.');
      stop();
    } finally {
      setIsStarting(false);
    }
  }

  function connectPeer(remotePeerId: string) {
    if (
      !roomId ||
      !local ||
      sessions.has(remotePeerId) ||
      sessionControllers.has(remotePeerId)
    ) {
      return;
    }

    const controller = new AbortController();
    const signaling = createMeshPairSignaling({
      roomId,
      localPeerId,
      remotePeerId,
    });
    const createSession =
      localPeerId < remotePeerId ? startP2PSession : joinP2PSession;

    sessionControllers.set(remotePeerId, controller);
    signalings.set(remotePeerId, signaling);

    createSession({
      signaling,
      localStream: local,
      dataChannel: false,
      startTimeoutMs: 8000,
      signal: controller.signal,
      onRemoteStream: ({ stream }) => {
        setRemoteStreams((items) => [
          ...items.filter((item) => item.peerId !== remotePeerId),
          { peerId: remotePeerId, stream },
        ]);
      },
    })
      .then((session) => {
        if (controller.signal.aborted) {
          session.close();
          signaling.close();
          return;
        }
        sessions.set(remotePeerId, session);
        sessionControllers.delete(remotePeerId);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.warn('Could not connect peer', remotePeerId, err);
        }
        closePeer(remotePeerId);
      });
  }

  function closePeer(peerId: string) {
    sessionControllers.get(peerId)?.abort();
    sessionControllers.delete(peerId);
    sessions.get(peerId)?.close();
    sessions.delete(peerId);
    signalings.get(peerId)?.close();
    signalings.delete(peerId);
    setRemoteStreams((items) => items.filter((item) => item.peerId !== peerId));
  }

  function stop() {
    roomCleanup?.();
    roomCleanup = undefined;
    if (roomId) removePeer(roomId, localPeerId);
    roomBroadcast?.close();
    roomBroadcast = undefined;

    for (const controller of sessionControllers.values()) controller.abort();
    sessionControllers.clear();
    for (const session of sessions.values()) session.close();
    sessions.clear();
    for (const signaling of signalings.values()) signaling.close();
    signalings.clear();

    stopStream(local);
    local = undefined;
    for (const { stream } of remoteStreams()) stopStream(stream);

    setLocalStream(undefined);
    setRemoteStreams([]);
    setIsStarting(false);
    setIsInCall(false);
  }

  onCleanup(stop);

  return {
    localPeerId,
    localStream,
    remoteStreams,
    isStarting,
    error,
    start,
    stop,
    isInCall,
  };
}

function createMeshPairSignaling({
  roomId,
  localPeerId,
  remotePeerId,
}: {
  roomId: string;
  localPeerId: string;
  remotePeerId: string;
}) {
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

  const subscribe = <T,>(key: string, callback: (value: T) => void) => {
    let latestJson = JSON.stringify(readJson(key, undefined));
    const emitIfChanged = () => {
      const value = readJson<T | undefined>(key, undefined);
      const nextJson = JSON.stringify(value);
      if (nextJson === latestJson) return;
      latestJson = nextJson;
      if (value != null) callback(value);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) emitIfChanged();
    };
    const onBroadcast = () => emitIfChanged();

    window.addEventListener('storage', onStorage);
    channel?.addEventListener('message', onBroadcast);
    queueMicrotask(() => {
      const value = readJson<T | undefined>(key, undefined);
      if (value != null) callback(value);
    });

    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onBroadcast);
    };
  };

  const signaling = createSignalingChannel({
    sendOffer: async (offer) => writeJson(keys.offer, offer),
    sendAnswer: async (answer) => writeJson(keys.answer, answer),
    onOffer: (callback) => subscribe(keys.offer, callback),
    onAnswer: (callback) => subscribe(keys.answer, callback),
    sendCandidate: async (candidate) => {
      const candidates = readJson<RTCIceCandidateInit[]>(
        keys.localCandidates,
        [],
      );
      candidates.push(candidate);
      writeJson(keys.localCandidates, candidates);
    },
    onRemoteCandidate: (callback) =>
      subscribe<RTCIceCandidateInit[]>(keys.remoteCandidates, (candidates) => {
        for (const candidate of candidates.slice(remoteCandidateIndex)) {
          callback(candidate);
        }
        remoteCandidateIndex = candidates.length;
      }),
  });
  const close = signaling.close;

  return {
    ...signaling,
    close() {
      close();
      channel?.close();
    },
  };
}

function watchPeers(roomId: string, callback: (peerIds: string[]) => void) {
  const channel =
    'BroadcastChannel' in globalThis
      ? new BroadcastChannel(roomChannelName(roomId))
      : undefined;
  const key = peersKey(roomId);
  const emit = () => callback(readJson<string[]>(key, []));
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) emit();
  };

  window.addEventListener('storage', onStorage);
  channel?.addEventListener('message', emit);
  queueMicrotask(emit);

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.removeEventListener('message', emit);
    channel?.close();
  };
}

function addPeer(roomId: string, peerId: string) {
  const peers = readJson<string[]>(peersKey(roomId), []);
  writeJson(peersKey(roomId), [...new Set([...peers, peerId])]);
}

function removePeer(roomId: string, peerId: string) {
  const peers = readJson<string[]>(peersKey(roomId), []);
  writeJson(
    peersKey(roomId),
    peers.filter((id) => id !== peerId),
  );
}

function clearMeshRoom(roomId: string) {
  const roomPrefix = `${prefix}${roomId}:`;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(roomPrefix)) localStorage.removeItem(key);
  }
}

function pairId(a: string, b: string) {
  return [a, b].sort().join(':');
}

function peersKey(roomId: string) {
  return `${prefix}${roomId}:peers`;
}

function roomChannelName(roomId: string) {
  return `${prefix}${roomId}:events`;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  const roomId = key.slice(prefix.length).split(':')[0];
  if (roomId) {
    const channel = new BroadcastChannel(roomChannelName(roomId));
    channel.postMessage({ type: 'meshChanged' });
    channel.close();
  }
}

function stopStream(stream: MediaStream | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}
