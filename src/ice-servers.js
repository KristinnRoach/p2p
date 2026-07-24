const REFRESH_RETRY_DELAYS_MS = [1000, 5000, 15000, 30000];

export function createIceServersManager({
  rtcConfig = {},
  provider,
  refreshMarginMs,
  onError = () => {},
} = {}) {
  if (provider !== undefined && typeof provider !== 'function') {
    throw new TypeError('iceServersProvider must be a function');
  }
  if (
    refreshMarginMs !== undefined &&
    (!Number.isFinite(refreshMarginMs) || refreshMarginMs < 0)
  ) {
    throw new TypeError(
      'iceServersRefreshMarginMs must be finite and non-negative',
    );
  }

  const baseRtcConfig = {
    ...rtcConfig,
    ...(rtcConfig.iceServers
      ? { iceServers: [...rtcConfig.iceServers] }
      : {}),
  };
  const controller = new AbortController();
  const peerConnections = new Set();
  let current = null;
  let inFlight = null;
  let refreshTimer = null;
  let retryTimer = null;
  let retryIndex = 0;
  let disposed = false;

  const clearTimers = () => {
    clearTimeout(refreshTimer);
    clearTimeout(retryTimer);
    refreshTimer = retryTimer = null;
  };

  const getRtcConfig = () => ({
    ...baseRtcConfig,
    ...(current
      ? { iceServers: current.iceServers.map((server) => ({ ...server })) }
      : baseRtcConfig.iceServers
        ? {
            iceServers: baseRtcConfig.iceServers.map((server) => ({
              ...server,
            })),
          }
        : {}),
  });

  const report = (error) => {
    if (!disposed) onError(error);
  };

  const scheduleRetry = () => {
    if (disposed || !current?.expiresAt) return;
    const remaining = current.expiresAt - Date.now();
    if (remaining <= 0) {
      retryIndex = 0;
      report(new Error('ICE server credentials expired'));
      return;
    }
    const delay =
      REFRESH_RETRY_DELAYS_MS[
        Math.min(retryIndex++, REFRESH_RETRY_DELAYS_MS.length - 1)
      ];
    retryTimer = setTimeout(
      () => {
        retryTimer = null;
        ensureFresh('scheduled-refresh').catch(() => scheduleRetry());
      },
      Math.min(delay, remaining),
    );
  };

  const scheduleRefresh = (fetchedAt) => {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (!current?.expiresAt || disposed) return;
    const lifetime = current.expiresAt - fetchedAt;
    const requestedMargin =
      refreshMarginMs === undefined
        ? Math.min(60000, lifetime * 0.1)
        : refreshMarginMs;
    // Keep at least 10% of the observed lifetime between successful fetches.
    const margin = Math.min(requestedMargin, lifetime * 0.9);
    refreshTimer = setTimeout(
      () => {
        refreshTimer = null;
        ensureFresh('scheduled-refresh').catch(() => scheduleRetry());
      },
      Math.max(0, current.expiresAt - margin - Date.now()),
    );
  };

  const applyConfiguration = () => {
    const config = getRtcConfig();
    for (const pc of peerConnections) {
      try {
        pc.setConfiguration(config);
      } catch (error) {
        report(error);
      }
    }
  };

  const ensureFresh = (reason = 'manual') => {
    if (!provider) return Promise.resolve();
    if (disposed) return Promise.reject(createAbortError());
    const now = Date.now();
    if (
      reason !== 'scheduled-refresh' &&
      current &&
      (!current.expiresAt || current.expiresAt > now)
    ) {
      return Promise.resolve();
    }
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => provider({ reason, signal: controller.signal }))
      .then((result) => {
        if (disposed) throw createAbortError();
        const fetchedAt = Date.now();
        validateResult(result, fetchedAt);
        current = {
          iceServers: result.iceServers.map((server) => ({ ...server })),
          expiresAt: result.expiresAt,
        };
        retryIndex = 0;
        clearTimeout(retryTimer);
        retryTimer = null;
        if (reason !== 'initial') applyConfiguration();
        scheduleRefresh(fetchedAt);
      })
      .catch((error) => {
        if (!disposed && reason === 'scheduled-refresh') report(error);
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    hasProvider: Boolean(provider),
    ensureFresh,
    getRtcConfig,
    addPeerConnection(pc) {
      if (!disposed) peerConnections.add(pc);
    },
    removePeerConnection(pc) {
      peerConnections.delete(pc);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      peerConnections.clear();
      controller.abort();
    },
  };
}

function validateResult(result, fetchedAt) {
  if (!Array.isArray(result?.iceServers)) {
    throw new TypeError('iceServers must be an array');
  }
  if (result.iceServers.length === 0) {
    throw new TypeError('iceServers must contain at least one ICE server');
  }
  if (
    result.expiresAt !== undefined &&
    (!Number.isFinite(result.expiresAt) || result.expiresAt <= fetchedAt)
  ) {
    throw new TypeError(
      'expiresAt must be a finite epoch-millisecond value in the future',
    );
  }
}

function createAbortError() {
  try {
    return new DOMException('ICE servers lifecycle disposed', 'AbortError');
  } catch (_) {
    const error = new Error('ICE servers lifecycle disposed');
    error.name = 'AbortError';
    return error;
  }
}
