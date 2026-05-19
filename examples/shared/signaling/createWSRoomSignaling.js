// createWebSocketRoomSignaling.js
export function createWebSocketRoomSignaling({ url, roomId }) {
  const socket = new WebSocket(url);

  const peerListeners = new Set();
  const pairBuckets = new Map();
  const knownPeers = new Set();

  let localPeerId = null;
  let manuallyClosed = false;
  let isOpen = false;
  let closedError = null;
  let openPromiseResolve;
  let openPromiseReject;

  const openPromise = new Promise((resolve, reject) => {
    openPromiseResolve = resolve;
    openPromiseReject = reject;
  });

  const waitForOpen = () => {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
    if (
      socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED
    ) {
      return Promise.reject(closedError ?? new Error('WebSocket is closed'));
    }
    return openPromise;
  };

  const send = async (message) => {
    await waitForOpen();
    if (socket.readyState !== WebSocket.OPEN) {
      throw closedError ?? new Error('WebSocket is closed');
    }
    socket.send(JSON.stringify(message));
  };

  const emitPeers = () => {
    const peerIds = [...knownPeers].filter((id) => id !== localPeerId).sort();
    for (const cb of peerListeners) cb(peerIds);
  };

  const pairKey = (localPeerId, remotePeerId) =>
    `${localPeerId}::${remotePeerId}`;

  const getBucket = (localPeerId, remotePeerId) => {
    const key = pairKey(localPeerId, remotePeerId);
    if (!pairBuckets.has(key)) {
      pairBuckets.set(key, {
        offer: new Set(),
        answer: new Set(),
        candidate: new Set(),
      });
    }
    return pairBuckets.get(key);
  };

  socket.addEventListener('open', () => {
    isOpen = true;
    openPromiseResolve();
  });

  socket.addEventListener('error', (error) => {
    closedError = error;
    if (!isOpen) openPromiseReject(error);
  });

  socket.addEventListener('close', () => {
    isOpen = false;
    closedError ??= new Error(
      manuallyClosed ? 'WebSocket was closed intentionally' : 'WebSocket closed',
    );
    openPromiseReject(closedError);
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (!msg || msg.roomId !== roomId) return;

    if (msg.type === 'peers') {
      knownPeers.clear();
      for (const peerId of msg.peerIds || []) knownPeers.add(peerId);
      emitPeers();
      return;
    }

    if (!msg.to || msg.to !== localPeerId || !msg.from) return;

    const bucket = pairBuckets.get(pairKey(localPeerId, msg.from));
    if (!bucket) return;

    if (msg.type === 'offer') {
      for (const cb of bucket.offer) cb(msg.offer);
    } else if (msg.type === 'answer') {
      for (const cb of bucket.answer) cb(msg.answer);
    } else if (msg.type === 'candidate') {
      for (const cb of bucket.candidate) cb(msg.candidate);
    }
  });

  return {
    async join(peerId) {
      localPeerId = peerId;
      knownPeers.add(peerId);
      await send({ type: 'join-room', roomId, peerId });
    },

    async leave(peerId) {
      knownPeers.delete(peerId);
      emitPeers();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'leave-room', roomId, peerId }));
      }
    },

    onPeers(callback) {
      peerListeners.add(callback);
      emitPeers();
      return () => {
        peerListeners.delete(callback);
      };
    },

    createPeerSignaling({ localPeerId, remotePeerId }) {
      const bucket = getBucket(localPeerId, remotePeerId);

      return {
        sendOffer(offer) {
          return send({
            type: 'offer',
            roomId,
            from: localPeerId,
            to: remotePeerId,
            offer,
          });
        },

        sendAnswer(answer) {
          return send({
            type: 'answer',
            roomId,
            from: localPeerId,
            to: remotePeerId,
            answer,
          });
        },

        onOffer(callback) {
          bucket.offer.add(callback);
          return () => bucket.offer.delete(callback);
        },

        onAnswer(callback) {
          bucket.answer.add(callback);
          return () => bucket.answer.delete(callback);
        },

        sendCandidate(candidate) {
          return send({
            type: 'candidate',
            roomId,
            from: localPeerId,
            to: remotePeerId,
            candidate,
          });
        },

        onRemoteCandidate(callback) {
          bucket.candidate.add(callback);
          return () => bucket.candidate.delete(callback);
        },
      };
    },

    cleanupSignaling() {
      manuallyClosed = true;
      peerListeners.clear();
      pairBuckets.clear();
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    },
  };
}
