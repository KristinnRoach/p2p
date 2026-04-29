// src/ice.js
//
// ICE candidate exchange helper. Signaling-agnostic: takes an IceTransport
// ({ sendCandidate, onRemoteCandidate }) and wires the peer connection to
// it. Queues inbound candidates until the remote description is applied,
// then drains them (auto-drain on signalingstatechange, or manually via
// drainIceCandidateQueue).

import { log } from './logger.js';

/** @typedef {import('./signaling.js').IceTransport} IceTransport */

// WeakMap of queued remote candidates keyed by peer connection.
const pendingRemoteCandidates = new WeakMap();

/**
 * Wire a peer connection's ICE candidate gathering + remote ingestion to a
 * signaling transport.
 *
 * @param {RTCPeerConnection} pc
 * @param {IceTransport} transport
 * @returns {() => void} cleanup function
 */
export function setupIceCandidates(pc, transport) {
  if (!pc) {
    throw new Error('setupIceCandidates: pc is required');
  }
  if (
    !transport ||
    typeof transport.sendCandidate !== 'function' ||
    typeof transport.onRemoteCandidate !== 'function'
  ) {
    throw new Error(
      'setupIceCandidates: transport must implement sendCandidate and onRemoteCandidate',
    );
  }

  if (!pendingRemoteCandidates.has(pc)) {
    pendingRemoteCandidates.set(pc, []);
  }

  const cleanupLocal = setupLocalCandidateSender(pc, transport);
  const cleanupRemote = setupRemoteCandidateListener(pc, transport);

  return () => {
    cleanupLocal();
    cleanupRemote();
  };
}

function setupLocalCandidateSender(pc, transport) {
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log('❄ Local ICE candidate');
      try {
        const result = transport.sendCandidate(event.candidate.toJSON());
        if (result && typeof result.catch === 'function') {
          result.catch((err) =>
            log('Failed to send ICE candidate:', err),
          );
        }
      } catch (err) {
        log('Failed to send ICE candidate:', err);
      }
    } else {
      log('❄ ICE gathering complete');
    }
  };

  return () => {
    if (pc.onicecandidate) {
      pc.onicecandidate = null;
    }
  };
}

function setupRemoteCandidateListener(pc, transport) {
  let drainListenerAttached = false;
  let autoDrainListener = null;
  const attachAutoDrain = () => {
    if (drainListenerAttached) return;
    drainListenerAttached = true;

    autoDrainListener = () => {
      if (pc.remoteDescription) {
        drainIceCandidateQueue(pc);
        pc.removeEventListener('signalingstatechange', autoDrainListener);
        autoDrainListener = null;
      }
    };

    pc.addEventListener('signalingstatechange', autoDrainListener);
  };

  const rawUnsubscribe = transport.onRemoteCandidate((candidate) => {
    log('❄ Remote ICE candidate added');

    if (!pc || pc.signalingState === 'closed') {
      log('Skipping ICE candidate: peer connection is closed');
      return;
    }

    if (!candidate) {
      return;
    }

    if (pc.remoteDescription) {
      try {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
          log('Error adding ICE candidate:', error);
        });
      } catch (error) {
        log('Error adding ICE candidate:', error);
      }
      return;
    }

    log('📥 Queuing ICE candidate (remote description not yet set)');
    const queue = pendingRemoteCandidates.get(pc);
    if (queue) {
      queue.push(candidate);
      if (queue.length === 1) {
        attachAutoDrain();
      }
    }
  });
  const unsubscribe =
    typeof rawUnsubscribe === 'function' ? rawUnsubscribe : () => {};

  return () => {
    unsubscribe();
    if (autoDrainListener) {
      pc.removeEventListener('signalingstatechange', autoDrainListener);
      autoDrainListener = null;
    }
  };
}

/**
 * Drain queued remote ICE candidates. Idempotent: safe to call repeatedly.
 * @param {RTCPeerConnection} pc
 */
export function drainIceCandidateQueue(pc) {
  if (!pc || !pendingRemoteCandidates.has(pc)) {
    return;
  }

  const queue = pendingRemoteCandidates.get(pc);
  if (queue.length === 0) {
    return;
  }

  log(`🔄 Draining ${queue.length} queued ICE candidate(s)`);

  for (const candidateInit of queue) {
    try {
      pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch((error) => {
        log('Error adding queued ICE candidate:', error);
      });
    } catch (error) {
      log('Error adding queued ICE candidate:', error);
    }
  }

  queue.length = 0;
}
