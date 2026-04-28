import { Peer, PEER_STATES } from './peer.js';
import { attachRemoteStream } from './remote-stream.js';

/**
 * Start a new initiator-side P2P session.
 *
 * @param {Object} options
 * @returns {Promise<P2PSession>}
 */
export function startP2PSession(options = {}) {
  return createP2PSession('initiator', options);
}

/**
 * Join an existing P2P session.
 *
 * @param {Object} options
 * @returns {Promise<P2PSession>}
 */
export function joinP2PSession(options = {}) {
  return createP2PSession('joiner', options);
}

async function createP2PSession(role, options) {
  const session = new P2PSession(role, options);
  try {
    await session.ready;
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

class P2PSession extends EventTarget {
  constructor(role, options = {}) {
    super();
    const {
      signaling,
      localStream = null,
      audioOnly = false,
      dataChannel = false,
      dataChannelLabel = 'data',
      rtcConfig,
      startTimeoutMs = 0,
      connectedTimeoutMs = 0,
      dataChannelOpenTimeoutMs = dataChannel ? 10000 : 0,
      signal = null,
    } = options;

    this.peer = new Peer({
      role,
      signaling,
      localStream,
      audioOnly,
      dataChannel,
      dataChannelLabel,
      rtcConfig,
    });
    this._remoteStream = null;
    this._cleanups = [];
    this._listenerMap = new Map();

    this._bindPeerEvents();
    this._cleanups.push(
      attachRemoteStream(this.peer, {
        onStream: ({ stream, track, event }) => {
          this._remoteStream = stream;
          this._emit('remoteStream', { stream, track, event });
        },
        onTrack: ({ stream, track, event }) => {
          this._emit('remoteTrack', { stream, track, event });
        },
      }),
    );

    this.ready = this._start({
      startTimeoutMs,
      connectedTimeoutMs,
      dataChannelOpenTimeoutMs,
      signal,
    });
  }

  get role() {
    return this.peer.role;
  }

  get state() {
    return this.peer.state;
  }

  get dataChannel() {
    return this.peer.dataChannel;
  }

  get remoteStream() {
    return this._remoteStream;
  }

  send(data) {
    this.peer.send(data);
  }

  close() {
    this.peer.close();
    for (const cleanup of this._cleanups.splice(0)) {
      cleanup();
    }
  }

  on(type, callback) {
    if (type === 'remoteStream' && this._remoteStream) {
      callback({ stream: this._remoteStream, track: null, event: null });
    }
    const handler = (event) => callback(event.detail, event);
    this._trackListener(type, callback, handler);
    this.addEventListener(type, handler);
    return () => {
      this.removeEventListener(type, handler);
      this._forgetListener(type, callback, handler);
    };
  }

  once(type, callback) {
    const handler = (event) => {
      this.removeEventListener(type, handler);
      this._forgetListener(type, callback, handler);
      callback(event.detail, event);
    };
    this._trackListener(type, callback, handler);
    this.addEventListener(type, handler);
    return () => {
      this.removeEventListener(type, handler);
      this._forgetListener(type, callback, handler);
    };
  }

  off(type, callback) {
    const handlers = this._listenerMap.get(type)?.get(callback);
    if (handlers) {
      for (const handler of handlers) {
        this.removeEventListener(type, handler);
      }
      this._listenerMap.get(type)?.delete(callback);
      return;
    }
    this.removeEventListener(type, callback);
  }

  _bindPeerEvents() {
    for (const type of [
      'statechange',
      'connected',
      'disconnected',
      'datachannel',
      'open',
      'message',
      'close',
      'error',
      'track',
    ]) {
      this._cleanups.push(
        this.peer.on(type, (detail, event) => {
          this._emit(type, { ...detail, event });
        }),
      );
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async _start(options) {
    await this.peer.start(options);
    if (options.dataChannelOpenTimeoutMs > 0) {
      await this._waitForDataChannelOpen(
        options.dataChannelOpenTimeoutMs,
        options.signal,
      );
    }
  }

  _waitForDataChannelOpen(timeoutMs, signal = null) {
    const readyState = this.peer.dataChannel?.readyState;
    if (readyState === 'open') {
      return Promise.resolve();
    }
    if (readyState === 'closing' || readyState === 'closed') {
      return Promise.reject(
        new Error('P2PSession: data channel closed before open'),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    const terminalError = getTerminalPeerError(this.peer.state);
    if (terminalError) {
      return Promise.reject(terminalError);
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      let offOpen = () => {};
      let offClose = () => {};
      let offError = () => {};
      let offState = () => {};
      let abortCleanup = () => {};

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        offOpen();
        offClose();
        offError();
        offState();
        abortCleanup();
      };
      const fail = (error) => {
        cleanup();
        reject(error);
      };

      offOpen = this.once('open', () => {
        cleanup();
        resolve();
      });
      offClose = this.once('close', () => {
        fail(new Error('P2PSession: data channel closed before open'));
      });
      offError = this.once('error', ({ error }) => {
        fail(error);
      });
      offState = this.on('statechange', ({ state }) => {
        const error = getTerminalPeerError(state);
        if (error) {
          fail(error);
        }
      });
      if (signal) {
        const abortHandler = () => {
          fail(createAbortError());
        };
        signal.addEventListener('abort', abortHandler, { once: true });
        abortCleanup = () => {
          signal.removeEventListener('abort', abortHandler);
        };
      }
      timer = setTimeout(() => {
        fail(
          new Error(
            `P2PSession: data channel open timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
  }

  _trackListener(type, callback, handler) {
    if (!this._listenerMap.has(type)) {
      this._listenerMap.set(type, new Map());
    }
    const callbacks = this._listenerMap.get(type);
    if (!callbacks.has(callback)) {
      callbacks.set(callback, new Set());
    }
    callbacks.get(callback).add(handler);
  }

  _forgetListener(type, callback, handler) {
    const handlers = this._listenerMap.get(type)?.get(callback);
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      this._listenerMap.get(type)?.delete(callback);
    }
  }
}

function createAbortError() {
  try {
    return new DOMException('P2PSession: aborted', 'AbortError');
  } catch (_) {
    const error = new Error('P2PSession: aborted');
    error.name = 'AbortError';
    return error;
  }
}

function getTerminalPeerError(state) {
  if (state === PEER_STATES.FAILED || state === PEER_STATES.CLOSED) {
    return new Error(
      `P2PSession: peer ${state} before data channel open`,
    );
  }
  return null;
}
