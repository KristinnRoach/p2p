import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIceServersManager } from '../src/ice-servers.js';
import { Peer } from '../src/peer.js';

const servers = (host) => [
  { urls: `turn:${host}`, username: 'u', credential: 'p' },
];

describe('ICE servers manager', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves and clones static RTC configuration', async () => {
    const rtcConfig = {
      iceServers: servers('static.example'),
      iceTransportPolicy: 'relay',
    };
    const manager = createIceServersManager({ rtcConfig });

    await manager.ensureFresh('initial');
    const result = manager.getRtcConfig();
    result.iceServers.push({ urls: 'stun:changed.example' });

    expect(manager.getRtcConfig()).toEqual(rtcConfig);
    expect(rtcConfig.iceServers).toHaveLength(1);
    manager.dispose();
  });

  it('coalesces initial requests and replaces only iceServers', async () => {
    let resolveProvider;
    const provider = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
    );
    const manager = createIceServersManager({
      rtcConfig: {
        iceServers: servers('static.example'),
        iceTransportPolicy: 'relay',
      },
      provider,
    });

    const first = manager.ensureFresh('initial');
    const second = manager.ensureFresh('initial');
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    resolveProvider({ iceServers: servers('fresh.example') });
    await Promise.all([first, second]);

    expect(manager.getRtcConfig()).toEqual({
      iceServers: servers('fresh.example'),
      iceTransportPolicy: 'relay',
    });
    expect(provider.mock.calls[0][0].reason).toBe('initial');
    manager.dispose();
  });

  it.each([
    [{}, /iceServers/],
    [{ iceServers: [] }, /iceServers/],
    [{ iceServers: servers('turn.example'), expiresAt: 1 }, /expiresAt/],
  ])('rejects malformed provider result %#', async (result, message) => {
    const manager = createIceServersManager({
      provider: async () => result,
    });
    await expect(manager.ensureFresh('initial')).rejects.toThrow(message);
    manager.dispose();
  });

  it('refreshes before expiry and updates each live connection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const provider = vi
      .fn()
      .mockResolvedValueOnce({
        iceServers: servers('first.example'),
        expiresAt: 11000,
      })
      .mockResolvedValueOnce({
        iceServers: servers('second.example'),
      });
    const manager = createIceServersManager({ provider });
    const firstPc = { setConfiguration: vi.fn() };
    const secondPc = { setConfiguration: vi.fn() };

    await manager.ensureFresh('initial');
    manager.addPeerConnection(firstPc);
    manager.addPeerConnection(secondPc);
    await vi.advanceTimersByTimeAsync(9000);

    expect(provider.mock.calls[1][0].reason).toBe('scheduled-refresh');
    expect(firstPc.setConfiguration).toHaveBeenCalledWith({
      iceServers: servers('second.example'),
    });
    expect(secondPc.setConfiguration).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('isolates failing and removed peer connections', async () => {
    const onError = vi.fn();
    const provider = vi
      .fn()
      .mockResolvedValueOnce({ iceServers: servers('first.example') })
      .mockResolvedValueOnce({ iceServers: servers('second.example') });
    const manager = createIceServersManager({ provider, onError });
    const failingPc = {
      setConfiguration: vi.fn(() => {
        throw new Error('closed');
      }),
    };
    const removedPc = { setConfiguration: vi.fn() };
    const healthyPc = { setConfiguration: vi.fn() };

    await manager.ensureFresh('initial');
    manager.addPeerConnection(failingPc);
    manager.addPeerConnection(removedPc);
    manager.addPeerConnection(healthyPc);
    manager.removePeerConnection(removedPc);
    await manager.ensureFresh('scheduled-refresh');

    expect(onError).toHaveBeenCalledOnce();
    expect(removedPc.setConfiguration).not.toHaveBeenCalled();
    expect(healthyPc.setConfiguration).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('keeps unexpired credentials and retries a failed refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const onError = vi.fn();
    const provider = vi
      .fn()
      .mockResolvedValueOnce({
        iceServers: servers('current.example'),
        expiresAt: 11000,
      })
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ iceServers: servers('recovered.example') });
    const manager = createIceServersManager({
      provider,
      refreshMarginMs: 2000,
      onError,
    });

    await manager.ensureFresh('initial');
    await vi.advanceTimersByTimeAsync(8000);
    expect(manager.getRtcConfig().iceServers).toEqual(
      servers('current.example'),
    );
    expect(onError).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getRtcConfig().iceServers).toEqual(
      servers('recovered.example'),
    );
    manager.dispose();
  });

  it('aborts an active provider on disposal', async () => {
    let signal;
    const manager = createIceServersManager({
      provider: ({ signal: providerSignal }) => {
        signal = providerSignal;
        return new Promise(() => {});
      },
    });

    void manager.ensureFresh('initial');
    await vi.waitFor(() => expect(signal).toBeDefined());
    manager.dispose();

    expect(signal.aborted).toBe(true);
  });
});

describe('Peer ICE server lifecycle', () => {
  it('waits for initial credentials before constructing the connection', async () => {
    let resolveProvider;
    const peer = new Peer({
      role: 'initiator',
      signaling: createSignaling(),
      iceServersProvider: () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
    });

    const started = peer.start();
    await vi.waitFor(() => expect(resolveProvider).toBeDefined());
    expect(peer.pc).toBeNull();
    resolveProvider({ iceServers: servers('initial.example') });
    await started;
    expect(peer.pc.getConfiguration().iceServers[0].urls).toContain(
      'turn:initial.example',
    );
    peer.dispose();
  });

  it('reports initial provider failures with the credential phase', async () => {
    const peer = new Peer({
      role: 'initiator',
      signaling: createSignaling(),
      iceServersProvider: async () => {
        throw new Error('backend unavailable');
      },
    });
    const onError = vi.fn();
    peer.on('error', onError);

    await expect(peer.start()).rejects.toThrow('backend unavailable');
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(onError.mock.calls[0][0].phase).toBe('ice-servers-initial');
    peer.dispose();
  });
});

function createSignaling() {
  return {
    sendOffer: vi.fn(),
    sendAnswer: vi.fn(),
    onOffer: vi.fn(),
    onAnswer: vi.fn(),
    sendCandidate: vi.fn(),
    onRemoteCandidate: vi.fn(),
  };
}
