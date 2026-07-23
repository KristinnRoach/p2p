// createWebSocketRoomSignaling.js
import { createRelayPeerSignaling } from '@kidlib/p2p';

export function createWebSocketRoomSignaling({ url, roomId }) {
  const socket = new WebSocket(url);

  const peerListeners = new Set();
  const messageListeners = new Set();
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

  const emitPeers = (departed = []) => {
    const members = [...knownPeers]
      .sort()
      .map((memberId) => ({ memberId }));
    const snapshot = {
      members,
      ...(departed.length > 0 ? { departed } : {}),
    };
    for (const cb of peerListeners) cb(snapshot);
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
      emitPeers(msg.departed);
      return;
    }

    if (!msg.to || msg.to !== localPeerId || !msg.from) return;

    const envelope = toRelayEnvelope(msg);
    if (!envelope) return;

    for (const callback of messageListeners) callback(msg.from, envelope);
  });

  return {
    async join(peerId) {
      localPeerId = peerId;
      knownPeers.add(peerId);
      await send({ type: 'join-room', roomId, peerId });
    },

    async leave(peerId) {
      knownPeers.delete(peerId);
      emitPeers([{ memberId: peerId, reason: 'left' }]);
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
      return createRelayPeerSignaling({
        remotePeerId,
        send: (toPeerId, message) =>
          send({
            ...message,
            type: message.kind,
            roomId,
            from: localPeerId,
            to: toPeerId,
          }),
        onMessage(callback) {
          messageListeners.add(callback);
          return () => {
            messageListeners.delete(callback);
          };
        },
      });
    },

    cleanupSignaling() {
      manuallyClosed = true;
      peerListeners.clear();
      messageListeners.clear();
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    },
  };
}

function toRelayEnvelope(message) {
  if (message.type === 'offer') {
    return { kind: 'offer', offer: message.offer };
  }
  if (message.type === 'answer') {
    return { kind: 'answer', answer: message.answer };
  }
  if (message.type === 'candidate') {
    return { kind: 'candidate', candidate: message.candidate };
  }
  return null;
}
