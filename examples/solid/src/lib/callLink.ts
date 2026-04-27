export type CallRole = 'initiator' | 'joiner';

export function createRoomId() {
  return crypto.randomUUID();
}

export function createJoinUrl(roomId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('role', 'joiner');
  return url.toString();
}

export function readJoinParams(): { roomId: string; role: CallRole } | null {
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get('room');
  const role = url.searchParams.get('role');

  if (!roomId || role !== 'joiner') return null;

  return { roomId, role };
}
