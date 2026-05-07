// src/config.js

/**
 * Default RTCConfiguration with Google's public STUN server.
 * Consumers can override per session by passing rtcConfig into
 * startP2PSession / joinP2PSession / P2PRoom, or by constructing
 * RTCPeerConnection directly.
 */
export const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add TURN servers here if needed for restrictive NATs.
  ],
};
