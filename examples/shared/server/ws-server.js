// server.js
import { WebSocketServer } from 'ws';

const PORT = 8080;

const wss = new WebSocketServer({ port: PORT });

const sockets = new Map(); // ws -> { roomId, peerId }
const socketsByRoomPeer = new Map(); // `${roomId}:${peerId}` -> ws

const keyOf = (roomId, peerId) => `${roomId}:${peerId}`;

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastPeers(roomId) {
  const peerIds = [...sockets.values()]
    .filter((x) => x.roomId === roomId)
    .map((x) => x.peerId)
    .sort();

  for (const [ws, info] of sockets.entries()) {
    if (info.roomId === roomId) {
      send(ws, { type: 'peers', roomId, peerIds });
    }
  }
}

function removeSocket(ws) {
  const info = sockets.get(ws);
  if (!info) return;
  sockets.delete(ws);
  const key = keyOf(info.roomId, info.peerId);
  if (socketsByRoomPeer.get(key) === ws) {
    socketsByRoomPeer.delete(key);
  }
  broadcastPeers(info.roomId);
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'join-room') {
      sockets.set(ws, { roomId: msg.roomId, peerId: msg.peerId });
      socketsByRoomPeer.set(keyOf(msg.roomId, msg.peerId), ws);
      broadcastPeers(msg.roomId);
      return;
    }

    if (msg.type === 'leave-room') {
      removeSocket(ws);
      return;
    }

    if (msg.to) {
      const sender = sockets.get(ws);
      if (!sender) return;

      const target = socketsByRoomPeer.get(keyOf(sender.roomId, msg.to));
      if (target) {
        send(target, {
          ...msg,
          roomId: sender.roomId,
          from: sender.peerId,
        });
      }
      return;
    }

    if (msg.type === 'invite') {
      const sender = sockets.get(ws);
      if (!sender) return;
      for (const [peerWs, info] of sockets.entries()) {
        if (info.roomId === sender.roomId && peerWs !== ws) {
          send(peerWs, {
            ...msg,
            roomId: sender.roomId,
            from: sender.peerId,
          });
        }
      }
    }
  });

  ws.on('close', () => removeSocket(ws));
  ws.on('error', () => removeSocket(ws));
});
