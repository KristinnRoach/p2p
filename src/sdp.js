// src/sdp.js
//
// Pure SDP helpers: offer/answer creation, remote-description setting with
// dedup + signaling-state validation. No I/O, no signaling, no app deps.

import { log } from './logger.js';

/**
 * Deduplication cache for applied SDP to prevent duplicate processing. Necessary
 * because signaling transports (e.g. Firebase RTDB) can deliver the same
 * payload more than once across reconnects.
 */
const sdpCache = new WeakMap(); // Map<RTCPeerConnection, { lastOffer?, lastAnswer? }>

/**
 * Check if we've already processed this SDP for this peer connection.
 * @param {RTCPeerConnection} pc
 * @param {string} type - 'offer' or 'answer'
 * @param {string} sdp
 * @returns {boolean} True if this is a duplicate.
 */
export function isDuplicateSdp(pc, type, sdp) {
  if (!sdpCache.has(pc)) {
    sdpCache.set(pc, {});
  }
  const cache = sdpCache.get(pc);
  const key = type === 'offer' ? 'lastOffer' : 'lastAnswer';

  return cache[key] === sdp;
}

/**
 * Mark an SDP as applied for this peer connection.
 * @param {RTCPeerConnection} pc
 * @param {string} type - 'offer' or 'answer'
 * @param {string} sdp
 */
export function markSdpApplied(pc, type, sdp) {
  if (!sdpCache.has(pc)) {
    sdpCache.set(pc, {});
  }
  const cache = sdpCache.get(pc);
  const key = type === 'offer' ? 'lastOffer' : 'lastAnswer';
  cache[key] = sdp;
}

/**
 * Validate that the peer connection is in an expected state before setting
 * a remote description of the given type.
 * @param {RTCPeerConnection} pc
 * @param {string} expectedType - 'offer' or 'answer'
 * @returns {boolean}
 */
export function isValidSignalingState(pc, expectedType) {
  if (!pc) return false;

  if (expectedType === 'offer') {
    // Joiner: should be 'stable' when receiving offer
    return pc.signalingState === 'stable';
  } else {
    // Initiator: answer is only valid while we still have a local offer pending.
    return pc.signalingState === 'have-local-offer';
  }
}

/**
 * Create and set a local SDP offer.
 * @param {RTCPeerConnection} pc
 * @returns {Promise<RTCSessionDescriptionInit>}
 */
export async function createOffer(pc) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return offer;
}

/**
 * Create and set a local SDP answer.
 * @param {RTCPeerConnection} pc
 * @returns {Promise<RTCSessionDescriptionInit>}
 */
export async function createAnswer(pc) {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return answer;
}

/**
 * Set remote SDP description with dedup + signaling-state validation.
 * Drains any queued remote ICE candidates after successfully applying.
 *
 * @param {RTCPeerConnection} pc
 * @param {RTCSessionDescriptionInit} sdp
 * @param {(pc: RTCPeerConnection) => void} drainQueue
 * @returns {Promise<boolean>} True if applied, false if skipped/failed.
 */
export async function setRemoteDescription(pc, sdp, drainQueue) {
  if (isDuplicateSdp(pc, sdp.type, sdp.sdp)) {
    log(`Ignoring duplicate ${sdp.type} - already processed`);
    return false;
  }

  if (!isValidSignalingState(pc, sdp.type)) {
    log(
      `Ignoring ${sdp.type} - unexpected signaling state:`,
      pc.signalingState,
    );
    return false;
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    markSdpApplied(pc, sdp.type, sdp.sdp);
    drainQueue(pc);
    log(`Remote description set (${sdp.type})`);
    return true;
  } catch (error) {
    log(`Failed to set remote description (${sdp.type}):`, error);
    return false;
  }
}
