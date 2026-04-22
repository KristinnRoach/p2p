import { describe, expect, it, vi } from 'vitest';
import { attachRemoteStream } from '../src/remote-stream.js';

function createVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const stream = canvas.captureStream();
  return stream.getVideoTracks()[0];
}

describe('attachRemoteStream', () => {
  it('assembles a fallback MediaStream when track events do not include one', () => {
    const track = createVideoTrack();
    const peer = new EventTarget();
    const onStream = vi.fn();
    const onTrack = vi.fn();

    const detach = attachRemoteStream(peer, { onStream, onTrack });

    peer.dispatchEvent(new CustomEvent('track', { detail: { track, streams: [] } }));

    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream.mock.calls[0][0].stream).toBeInstanceOf(MediaStream);
    expect(onStream.mock.calls[0][0].stream.getTracks()).toContain(track);

    detach();
    track.stop();
  });

  it('prefers an existing stream from the track event', () => {
    const track = createVideoTrack();
    const stream = new MediaStream([track]);
    const peer = new EventTarget();
    const onStream = vi.fn();

    const detach = attachRemoteStream(peer, { onStream });

    peer.dispatchEvent(
      new CustomEvent('track', { detail: { track, streams: [stream] } }),
    );

    expect(onStream).toHaveBeenCalledWith(
      expect.objectContaining({ stream, track }),
    );

    detach();
    track.stop();
  });

  it('uses Peer-style on() subscriptions and detaches cleanly', () => {
    let listener;
    const unsubscribe = vi.fn();
    const peer = {
      on: vi.fn((type, callback) => {
        listener = callback;
        return unsubscribe;
      }),
    };
    const track = createVideoTrack();
    const onTrack = vi.fn();

    const detach = attachRemoteStream(peer, { onTrack });
    listener({ track, streams: [] }, new Event('track'));
    detach();
    listener({ track, streams: [] }, new Event('track'));

    expect(peer.on).toHaveBeenCalledWith('track', expect.any(Function));
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    track.stop();
  });

  it('throws when callbacks are not functions', () => {
    expect(() =>
      attachRemoteStream(new EventTarget(), { onTrack: 'not a function' }),
    ).toThrow(/onTrack must be a function/);
  });
});
