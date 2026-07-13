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
