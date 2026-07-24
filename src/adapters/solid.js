import { createSignal, onCleanup } from 'solid-js';
import { isLocalStreamError, isRoomFullError, watchP2PRoom } from '../room.js';
import { log, setLogger } from '../logger.js';

export { setLogger };

function noopBroadcast() {
  return 0;
}

function logTeardown(cause) {
  log('useP2PRoom: superseded room teardown failed', cause);
}

export function attachMediaStream(video, stream, options = {}) {
  const {
    autoplay = true,
    muted,
    playsInline,
    onPlaybackBlocked,
    onPlaybackStarted,
  } = options;
  let blockedError;
  let disposed = false;

  if (!video) {
    throw new Error('attachMediaStream: video element is required');
  }
  if (muted !== undefined) video.muted = muted;
  if (playsInline !== undefined) video.playsInline = playsInline;
  if (video.srcObject !== stream) video.srcObject = stream ?? null;

  const resumePlayback = async () => {
    if (disposed || !video.srcObject) return false;
    try {
      await Promise.resolve(video.play());
      blockedError = undefined;
      onPlaybackStarted?.();
      return true;
    } catch (error) {
      blockedError = error;
      onPlaybackBlocked?.(error);
      return false;
    }
  };

  return {
    ready: autoplay ? resumePlayback() : Promise.resolve(false),
    resumePlayback,
    get playbackBlocked() {
      return blockedError;
    },
    detach() {
      disposed = true;
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}

export function createMediaPlayback(options = {}) {
  const [playbackBlocked, setPlaybackBlocked] = createSignal(false);
  const [playbackError, setPlaybackError] = createSignal();
  let controller = null;

  const attach = (video, stream, attachOptions = {}) => {
    controller?.detach();
    setPlaybackBlocked(false);
    setPlaybackError(undefined);
    controller = attachMediaStream(video, stream, {
      ...options,
      ...attachOptions,
      onPlaybackBlocked(error) {
        setPlaybackBlocked(true);
        setPlaybackError(error);
        options.onPlaybackBlocked?.(error);
        attachOptions.onPlaybackBlocked?.(error);
      },
      onPlaybackStarted() {
        setPlaybackBlocked(false);
        setPlaybackError(undefined);
        options.onPlaybackStarted?.();
        attachOptions.onPlaybackStarted?.();
      },
    });
    return controller.ready;
  };

  const detach = () => {
    controller?.detach();
    controller = null;
    setPlaybackBlocked(false);
    setPlaybackError(undefined);
  };

  onCleanup(detach);

  return {
    playbackBlocked,
    playbackError,
    attach,
    resumePlayback: () => controller?.resumePlayback() ?? Promise.resolve(false),
    detach,
  };
}

export function useP2PRoom() {
  const [room, setRoom] = createSignal();
  const [ready, setReady] = createSignal(Promise.resolve(undefined), {
    equals: false,
  });
  const [state, setState] = createSignal('idle');
  const [error, setError] = createSignal();
  const [errorKind, setErrorKind] = createSignal();
  const [localStream, setLocalStream] = createSignal(undefined, {
    equals: false,
  });
  const [remoteMemberStreams, setRemoteMemberStreams] = createSignal([]);
  const [members, setMembers] = createSignal([]);
  const [memberPresence, setMemberPresence] = createSignal([]);
  const [memberCount, setMemberCount] = createSignal(0);
  const [memberCapacity, setMemberCapacity] = createSignal();
  const [isFull, setIsFull] = createSignal(false);
  const [dataChannels, setDataChannels] = createSignal(new Map());
  let listenerCleanup = null;
  let currentRunId = 0;
  // the room signal is cleared before teardown settles, so lifecycle ownership
  // is tracked here instead
  let activeRoom = null;
  // lifecycle transitions run one at a time: each completes its creation and
  // teardown before the next starts
  let transitions = Promise.resolve();

  function enqueue(transition) {
    const result = transitions.then(transition);
    // a rejected transition must not poison the ones queued behind it
    transitions = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  function setRoomError(cause) {
    const roomFull = isRoomFullError(cause);
    setError(cause);
    setErrorKind(
      roomFull
        ? 'room-full'
        : isLocalStreamError(cause)
          ? 'local-stream'
          : 'room',
    );
    setIsFull(roomFull);
    if (roomFull) {
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
    setMemberPresence([]);
    setMemberCount(0);
    setMemberCapacity(undefined);
    setIsFull(false);
    setDataChannels(new Map());
  }

  function disposeCurrentRoom(nextState = 'idle') {
    currentRunId += 1;
    clearListenerCleanup();
    // a creation still in flight is now stale; its own transition disposes the
    // room it produces, and this transition is queued behind it
    const disposingRoom = activeRoom;
    activeRoom = null;
    setReady(Promise.resolve(undefined));
    resetRoomSignals(nextState);
    return enqueue(() => disposingRoom?.dispose());
  }

  function syncRoomSignals(nextRoom) {
    setLocalStream(nextRoom.localStream ?? undefined);
    setRemoteMemberStreams(nextRoom.remoteMemberStreams);
    setMembers(nextRoom.members);
    setMemberPresence(nextRoom.memberPresence);
    setMemberCount(nextRoom.memberCount);
    setMemberCapacity(nextRoom.memberCapacity);
    setIsFull(nextRoom.isFull);
    setDataChannels(new Map(nextRoom.dataChannels));
  }

  function updateMembership(nextRoom) {
    setRemoteMemberStreams(nextRoom.remoteMemberStreams);
    setMembers(nextRoom.members);
    setMemberPresence(nextRoom.memberPresence);
    setMemberCount(nextRoom.memberCount);
    setMemberCapacity(nextRoom.memberCapacity);
    setIsFull(nextRoom.isFull);
  }

  function bindRoomEvents(nextRoom) {
    const updateRemoteStreams = () =>
      setRemoteMemberStreams(nextRoom.remoteMemberStreams);

    const cleanups = [
      nextRoom.on('statechange', ({ state }) => setState(state)),
      nextRoom.on('localStream', ({ stream }) => setLocalStream(stream)),
      nextRoom.on('memberStream', updateRemoteStreams),
      nextRoom.on('memberStreamRemoved', updateRemoteStreams),
      nextRoom.on('memberLeft', updateMembership.bind(null, nextRoom)),
      nextRoom.on('membersChanged', updateMembership.bind(null, nextRoom)),
      nextRoom.on('full', () => {
        updateMembership(nextRoom);
        setError(undefined);
        setErrorKind('room-full');
        setState('full');
      }),
      nextRoom.on('error', ({ error }) => {
        setError(error);
        setErrorKind('peer');
      }),
      nextRoom.on('dataChannel', () =>
        setDataChannels(new Map(nextRoom.dataChannels)),
      ),
      nextRoom.on('dataChannelClose', ({ memberId }) =>
        setDataChannels((prev) => {
          const next = new Map(prev);
          next.delete(memberId);
          return next;
        }),
      ),
      nextRoom.on('memberLeft', () =>
        setDataChannels(new Map(nextRoom.dataChannels)),
      ),
    ];

    return () => cleanups.forEach((cleanup) => cleanup());
  }

  function watchRoom(roomOptions) {
    currentRunId += 1;
    const runId = currentRunId;

    clearListenerCleanup();
    const supersededRoom = activeRoom;
    activeRoom = null;
    resetRoomSignals('creating');

    const roomPromise = enqueue(async () => {
      // a room torn down by supersession was never explicitly disposed by
      // anyone, so its failure has no caller to reject and must not fail this
      // watch; log it so a stuck teardown stays diagnosable
      if (supersededRoom) await supersededRoom.dispose().catch(logTeardown);
      if (runId !== currentRunId) return undefined;

      let createdRoom;
      try {
        createdRoom = await watchP2PRoom(roomOptions);
      } catch (cause) {
        if (runId === currentRunId) setRoomError(cause);
        return undefined;
      }

      // superseded while creating: never publish it, and finish its teardown
      // before the next transition starts
      if (runId !== currentRunId) {
        await createdRoom.dispose().catch(logTeardown);
        return undefined;
      }

      activeRoom = createdRoom;
      setRoom(createdRoom);
      setState(createdRoom.state);
      syncRoomSignals(createdRoom);
      listenerCleanup = bindRoomEvents(createdRoom);

      return createdRoom;
    });

    setReady(roomPromise);
    return roomPromise;
  }

  onCleanup(() => {
    void disposeCurrentRoom().catch(() => {});
  });

  async function join(options) {
    const currentRoom = await watchRoom(options);
    if (!currentRoom) return undefined;
    const runId = currentRunId;

    try {
      setError(undefined);
      setErrorKind(undefined);
      await currentRoom.join();
      if (runId !== currentRunId || activeRoom !== currentRoom) return undefined;
      syncRoomSignals(currentRoom);
      return currentRoom;
    } catch (cause) {
      if (runId !== currentRunId || activeRoom !== currentRoom) return undefined;
      setRoomError(cause);
      if (isLocalStreamError(cause)) {
        void disposeCurrentRoom('error').catch(() => {});
      }
      throw cause;
    }
  }

  async function leave() {
    const currentRoom = activeRoom;
    if (!currentRoom) return;
    await currentRoom.leave();
    // a watch() may have superseded this room while leave() was in flight
    if (activeRoom !== currentRoom) return;
    syncRoomSignals(currentRoom);
  }

  function dispose() {
    return disposeCurrentRoom();
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
    memberPresence,
    memberCount,
    memberCapacity,
    isFull,
    join,
    leave,
    dispose,
    dataChannels,
    watch: (options) => watchRoom(options),
    send: (memberId, data) => room()?.send(memberId, data),
    broadcast: (data) => room()?.broadcast(data) ?? noopBroadcast(),
  };
}
