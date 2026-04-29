export function createRoomInvite() {
  function createRoom() {
    const roomId = crypto.randomUUID();
    return { roomId, joinUrl: createJoinUrl(roomId) };
  }

  function readJoinParams() {
    const url = new URL(window.location.href);
    const roomId = url.searchParams.get('room');
    if (!roomId) return null;
    return { roomId };
  }

  async function copyJoinUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch (err) {
      console.warn('Could not copy join URL to clipboard', err);
      return false;
    }
  }

  return {
    createRoom,
    readJoinParams,
    copyJoinUrl,
  };
}

function createJoinUrl(roomId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}
