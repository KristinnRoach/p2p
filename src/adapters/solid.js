import { createSignal, onCleanup } from 'solid-js';
import { isLocalStreamError, isRoomFullError, watchP2PRoom } from '../room.js';

function noopBroadcast() {
  return 0;
}

function reconcileRemoteMemberStreams(previous, next) {
  const nextByMemberId = new Map(
    next.map((remoteStream) => [remoteStream.memberId, remoteStream]),
  );
  const previousMemberIds = new Set();
  const reconciled = [];

  for (const previousStream of previous) {
    const nextStream = nextByMemberId.get(previousStream.memberId);
    if (!nextStream) continue;

    previousMemberIds.add(previousStream.memberId);
    reconciled.push(
      previousStream.stream === nextStream.stream ? previousStream : nextStream,
    );
  }

  for (const nextStream of next) {
    if (!previousMemberIds.has(nextStream.memberId)) {
      reconciled.push(nextStream);
    }
  }

  return reconciled;
}

export function useP2PRoom() {
  const [room, setRoom] = createSignal();
  const [ready, setReady] = createSignal(Promise.resolve(undefined), {
    equals: false,
  });
  const [state, setState] = createSignal('idle');
  const [error, setError] = createSignal();
  const [errorKind, setErrorKind] = createSignal();
  const [localStream, setLocalStream] = createSignal();
  const [remoteMemberStreams, setRemoteMemberStreams] = createSignal([]);
  const [members, setMembers] = createSignal([]);
  const [memberCount, setMemberCount] = createSignal(0);
  const [memberCapacity, setMemberCapacity] = createSignal();
  const [isFull, setIsFull] = createSignal(false);
  let listenerCleanup = null;
  let currentRunId = 0;

  function setRoomError(cause) {
    setError(cause);
    setErrorKind(
      isRoomFullError(cause)
        ? 'room-full'
        : isLocalStreamError(cause)
          ? 'local-stream'
          : 'room',
    );
    if (isRoomFullError(cause)) {
      setState('full');
    } else {
      setState('error');
    }
  }

  function clearListenerCleanup() {
    listenerCleanup?.();
    listenerCleanup = null;
  }

  function resetRoomSignals(nextState = 'idle') {
    setRoom(undefined);
    setState(nextState);
    if (nextState !== 'error') {
      setError(undefined);
      setErrorKind(undefined);
    }
    setLocalStream(undefined);
    setRemoteMemberStreams([]);
    setMembers([]);
    setMemberCount(0);
    setMemberCapacity(undefined);
    setIsFull(false);
  }

  function closeCurrentRoom(nextState = 'idle') {
    currentRunId += 1;
    clearListenerCleanup();
    room()?.close();
    setReady(Promise.resolve(undefined));
    resetRoomSignals(nextState);
  }

  function syncRoomSignals(nextRoom) {
    setLocalStream(nextRoom.localStream ?? undefined);
    setRemoteMemberStreams((previous) =>
      reconcileRemoteMemberStreams(previous, nextRoom.remoteMemberStreams),
    );
    setMembers(nextRoom.members);
    setMemberCount(nextRoom.memberCount);
    setMemberCapacity(nextRoom.memberCapacity);
    setIsFull(nextRoom.isFull);
  }

  function updateMembership(nextRoom) {
    setRemoteMemberStreams((previous) =>
      reconcileRemoteMemberStreams(previous, nextRoom.remoteMemberStreams),
    );
    setMembers(nextRoom.members);
    setMemberCount(nextRoom.memberCount);
    setMemberCapacity(nextRoom.memberCapacity);
    setIsFull(nextRoom.isFull);
  }

  function bindRoomEvents(nextRoom) {
    const updateRemoteStreams = () =>
      setRemoteMemberStreams((previous) =>
        reconcileRemoteMemberStreams(previous, nextRoom.remoteMemberStreams),
      );

    const cleanups = [
      nextRoom.on('statechange', ({ state }) => setState(state)),
      nextRoom.on('localStream', ({ stream }) => setLocalStream(stream)),
      nextRoom.on('memberStream', updateRemoteStreams),
      nextRoom.on('memberLeft', updateMembership.bind(null, nextRoom)),
      nextRoom.on('membersChanged', updateMembership.bind(null, nextRoom)),
      nextRoom.on('full', () => {
        updateMembership(nextRoom);
        setErrorKind('room-full');
        setState('full');
      }),
      nextRoom.on('error', ({ error }) => {
        setError(error);
        setErrorKind('peer');
      }),
    ];

    return () => cleanups.forEach((cleanup) => cleanup());
  }

  function watchRoom(roomOptions) {
    currentRunId += 1;
    const runId = currentRunId;

    clearListenerCleanup();
    room()?.close();
    resetRoomSignals('creating');
    setError(undefined);
    setErrorKind(undefined);

    const roomPromise = watchP2PRoom(roomOptions)
      .then((createdRoom) => {
        if (runId !== currentRunId) {
          createdRoom.close();
          return undefined;
        }

        setRoom(createdRoom);
        setState(createdRoom.state);
        syncRoomSignals(createdRoom);
        listenerCleanup = bindRoomEvents(createdRoom);

        return createdRoom;
      })
      .catch((cause) => {
        if (runId !== currentRunId) return undefined;
        setRoomError(cause);
        return undefined;
      });

    setReady(roomPromise);
    return roomPromise;
  }

  onCleanup(closeCurrentRoom);

  async function join(options) {
    const currentRoom = await watchRoom(options);
    if (!currentRoom) return undefined;

    try {
      setError(undefined);
      setErrorKind(undefined);
      await currentRoom.join();
      syncRoomSignals(currentRoom);
      return currentRoom;
    } catch (cause) {
      setRoomError(cause);
      if (isLocalStreamError(cause)) closeCurrentRoom('error');
      return undefined;
    }
  }

  async function leave() {
    const currentRoom = room();
    if (!currentRoom) return;
    await currentRoom.leave();
    syncRoomSignals(currentRoom);
  }

  function close() {
    closeCurrentRoom();
  }

  return {
    room,
    ready,
    state,
    error,
    errorKind,
    localStream,
    remoteMemberStreams,
    members,
    memberCount,
    memberCapacity,
    isFull,
    join,
    leave,
    close,
    send: (memberId, data) => room()?.send(memberId, data),
    broadcast: (data) => room()?.broadcast(data) ?? noopBroadcast(),
  };
}
