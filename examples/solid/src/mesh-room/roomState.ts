import type { RoomPeer, RoomRemoteStream } from './roomTypes';

export function upsertPeer(peers: RoomPeer[], peerId: string): RoomPeer[] {
  if (peers.some((peer) => peer.peerId === peerId)) return peers;
  return [...peers, { peerId }].sort(comparePeer);
}

export function removePeer(peers: RoomPeer[], peerId: string): RoomPeer[] {
  return peers.filter((peer) => peer.peerId !== peerId);
}

export function upsertRemoteStream(
  streams: RoomRemoteStream[],
  peerId: string,
  stream: MediaStream,
): RoomRemoteStream[] {
  return [
    ...streams.filter((item) => item.peerId !== peerId),
    { peerId, stream },
  ].sort(comparePeer);
}

export function removeRemoteStream(
  streams: RoomRemoteStream[],
  peerId: string,
): RoomRemoteStream[] {
  return streams.filter((item) => item.peerId !== peerId);
}

function comparePeer(a: { peerId: string }, b: { peerId: string }) {
  return a.peerId.localeCompare(b.peerId);
}
