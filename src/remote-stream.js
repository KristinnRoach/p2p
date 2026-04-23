/**
 * Assemble a remote MediaStream from `track` events on a Peer or
 * RTCPeerConnection.
 *
 * @param {EventTarget|{ on?: Function, pc?: RTCPeerConnection }} peerOrPc
 * @param {Object} [options]
 * @param {({ stream: MediaStream, track: MediaStreamTrack, event: Event }) => void} [options.onStream]
 * @param {({ stream: MediaStream, track: MediaStreamTrack, event: Event }) => void} [options.onTrack]
 * @returns {() => void} cleanup function
 */
export function attachRemoteStream(peerOrPc, options = {}) {
  const { onStream = () => {}, onTrack = () => {} } = options;
  const target = resolveTrackTarget(peerOrPc);

  if (!target) {
    throw new Error('attachRemoteStream: peer or peer connection is required');
  }
  if (typeof onStream !== 'function') {
    throw new TypeError('attachRemoteStream: onStream must be a function');
  }
  if (typeof onTrack !== 'function') {
    throw new TypeError('attachRemoteStream: onTrack must be a function');
  }

  let remoteStream = null;
  let closed = false;

  const handleTrack = (payload, event) => {
    if (closed) return;

    const { track, streams } = normalizeTrackPayload(payload, event);
    if (!track) return;

    const nextStream = streams?.[0] ?? remoteStream ?? new MediaStream();
    if (!nextStream.getTracks().includes(track)) {
      nextStream.addTrack(track);
    }

    const streamChanged = remoteStream !== nextStream;
    remoteStream = nextStream;

    const detail = { stream: remoteStream, track, event };
    onTrack(detail);
    if (streamChanged) {
      onStream(detail);
    }
  };

  return attachTrackListener(target, handleTrack, () => {
    closed = true;
  });
}

function resolveTrackTarget(peerOrPc) {
  if (!peerOrPc) return null;
  if (
    typeof peerOrPc.addEventListener === 'function' ||
    typeof peerOrPc.on === 'function'
  ) {
    return peerOrPc;
  }
  return peerOrPc.pc ?? null;
}

function attachTrackListener(target, handleTrack, onCleanup) {
  let detached = false;

  if (typeof target.on === 'function') {
    const rawUnsubscribe = target.on('track', handleTrack);
    const unsubscribe =
      typeof rawUnsubscribe === 'function' ? rawUnsubscribe : () => {};

    return () => {
      if (detached) return;
      detached = true;
      onCleanup();
      unsubscribe();
    };
  }

  const listener = (event) => handleTrack(event, event);
  target.addEventListener('track', listener);

  return () => {
    if (detached) return;
    detached = true;
    onCleanup();
    target.removeEventListener('track', listener);
  };
}

function normalizeTrackPayload(payload, event) {
  if (payload?.detail) {
    return {
      track: payload.detail.track,
      streams: payload.detail.streams,
    };
  }
  if (payload?.track) {
    return {
      track: payload.track,
      streams: payload.streams,
    };
  }
  return {
    track: event?.track,
    streams: event?.streams,
  };
}
