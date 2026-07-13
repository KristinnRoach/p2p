// src/tracks.js

import { log } from './logger.js';

/**
 * Validate and copy caller-defined local publication slots.
 *
 * @param {unknown} slots
 * @param {string} owner
 * @returns {Array<{id: string, kind: 'audio'|'video', track: MediaStreamTrack|null}>}
 */
export function normalizeLocalTrackSlots(slots, owner) {
  if (slots == null) return [];
  if (!Array.isArray(slots)) {
    throw new TypeError(`${owner}: localTrackSlots must be an array`);
  }

  const ids = new Set();
  return slots.map((slot, index) => {
    const prefix = `${owner}: localTrackSlots[${index}]`;
    if (!slot || typeof slot !== 'object') {
      throw new TypeError(`${prefix} must be an object`);
    }
    if (typeof slot.id !== 'string' || slot.id.length === 0) {
      throw new TypeError(`${prefix}.id must be a non-empty string`);
    }
    if (ids.has(slot.id)) {
      throw new Error(`${owner}: duplicate local track slot "${slot.id}"`);
    }
    ids.add(slot.id);
    if (slot.kind !== 'audio' && slot.kind !== 'video') {
      throw new TypeError(`${prefix}.kind must be "audio" or "video"`);
    }

    const track = slot.track ?? null;
    assertLocalTrackKind(slot.id, slot.kind, track, owner);
    return { id: slot.id, kind: slot.kind, track };
  });
}

/**
 * @param {string} slotId
 * @param {'audio'|'video'} kind
 * @param {MediaStreamTrack|null} track
 * @param {string} owner
 */
export function assertLocalTrackKind(slotId, kind, track, owner) {
  if (track !== null && track?.kind !== kind) {
    throw new TypeError(
      `${owner}: track for slot "${slotId}" must be ${kind}, got ${track?.kind ?? typeof track}`,
    );
  }
}

/**
 * Add local media tracks to a peer connection. Skips tracks that are not
 * live to avoid permanently silent/black senders.
 *
 * @param {RTCPeerConnection} pc
 * @param {MediaStream} localStream
 * @param {Object} [options]
 * @param {boolean} [options.audioOnly=false] - Only add audio tracks.
 * @returns {{ allHealthy: boolean, unhealthyKinds: string[] }}
 */
export function addLocalTracks(pc, localStream, { audioOnly = false } = {}) {
  if (!pc || typeof pc.addTrack !== 'function') {
    throw new TypeError(
      'addLocalTracks: pc must be an RTCPeerConnection-like object with addTrack()',
    );
  }
  if (!localStream) {
    throw new TypeError(
      'addLocalTracks: localStream must be a MediaStream-like object',
    );
  }
  if (audioOnly) {
    if (typeof localStream.getAudioTracks !== 'function') {
      throw new TypeError(
        'addLocalTracks: localStream must implement getAudioTracks() when audioOnly=true',
      );
    }
  } else if (typeof localStream.getTracks !== 'function') {
    throw new TypeError(
      'addLocalTracks: localStream must implement getTracks()',
    );
  }

  const unhealthyKinds = [];

  const tracks = audioOnly
    ? localStream.getAudioTracks()
    : localStream.getTracks();

  tracks.forEach((track) => {
    if (track.readyState !== 'live') {
      log(
        `[WebRTC] ${track.kind} track is not live at addLocalTracks:`,
        track.readyState,
      );
      unhealthyKinds.push(track.kind);
      return;
    }
    pc.addTrack(track, localStream);
  });

  return {
    allHealthy: unhealthyKinds.length === 0,
    unhealthyKinds,
  };
}
