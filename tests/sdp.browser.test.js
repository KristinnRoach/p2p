import { describe, expect, it } from 'vitest';
import {
  isDuplicateSdp,
  markSdpApplied,
  setRemoteDescription,
} from '../src/sdp.js';

function createPeerConnection({
  signalingState = 'stable',
  setRemoteDescription = async () => {},
} = {}) {
  return {
    signalingState,
    setRemoteDescription,
  };
}

describe('SDP helpers', () => {
  it('does not mark SDP as duplicate until it is explicitly applied', () => {
    const pc = createPeerConnection();

    expect(isDuplicateSdp(pc, 'offer', 'offer-sdp')).toBe(false);
    expect(isDuplicateSdp(pc, 'offer', 'offer-sdp')).toBe(false);

    markSdpApplied(pc, 'offer', 'offer-sdp');

    expect(isDuplicateSdp(pc, 'offer', 'offer-sdp')).toBe(true);
  });

  it('allows retrying the same SDP after an unexpected signaling state', async () => {
    const sdp = { type: 'offer', sdp: 'offer-sdp' };
    const pc = createPeerConnection({ signalingState: 'have-local-offer' });

    await expect(setRemoteDescription(pc, sdp, () => {})).resolves.toBe(false);

    pc.signalingState = 'stable';
    pc.setRemoteDescription = async (description) => {
      pc.remoteDescription = description;
      pc.signalingState = 'have-remote-offer';
    };

    await expect(setRemoteDescription(pc, sdp, () => {})).resolves.toBe(true);
    expect(pc.remoteDescription.type).toBe(sdp.type);
    expect(pc.remoteDescription.sdp).toBe(sdp.sdp);
  });

  it('allows retrying the same SDP after setRemoteDescription fails', async () => {
    const sdp = { type: 'answer', sdp: 'answer-sdp' };
    const pc = createPeerConnection({
      signalingState: 'have-local-offer',
      setRemoteDescription: async () => {
        throw new Error('transient apply failure');
      },
    });

    await expect(setRemoteDescription(pc, sdp, () => {})).resolves.toBe(false);

    pc.setRemoteDescription = async (description) => {
      pc.remoteDescription = description;
      pc.signalingState = 'stable';
    };

    await expect(setRemoteDescription(pc, sdp, () => {})).resolves.toBe(true);
    expect(pc.remoteDescription.type).toBe(sdp.type);
    expect(pc.remoteDescription.sdp).toBe(sdp.sdp);
  });
});
