import React, { useEffect, useMemo, useRef, useState } from 'react';
import { joinP2PSession, startP2PSession } from '@kidlib/p2p';
import {
  clearBrowserTabSignalingRoom,
  createBrowserTabSignaling,
} from '../../shared/createBrowserTabSignaling.js';

const rtcConfig = { iceServers: [] };
const mediaConstraints = { video: true, audio: false };

export function App() {
  const initialRoomId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || createRoomId();
  }, []);
  const initialRole = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('role') === 'guest' ? 'guest' : 'host';
  }, []);

  const signalingRef = useRef(null);
  const sessionRef = useRef(null);
  const localStreamRef = useRef(null);
  const isStartingRef = useRef(false);
  const [session, setSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [role, setRole] = useState(initialRole);
  const [roomId, setRoomId] = useState(initialRoomId);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);
  const [message, setMessage] = useState('hello from React');
  const [log, setLog] = useState([]);

  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(
    roomId,
  )}&role=guest`;

  async function start(roleToStart) {
    if (isStartingRef.current || sessionRef.current) return;
    isStartingRef.current = true;
    setIsStarting(true);
    setLog((items) => [...items, 'requesting camera']);

    let stream = null;
    let signaling = null;

    try {
      closeCurrentSession({
        session: sessionRef.current,
        signaling: signalingRef.current,
        localStream: localStreamRef.current,
      });

      if (roleToStart === 'host') {
        clearBrowserTabSignalingRoom(roomId);
      }

      stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      signaling = createBrowserTabSignaling({
        roomId,
        role: roleToStart,
      });

      const createSession =
        roleToStart === 'host' ? startP2PSession : joinP2PSession;

      const nextSession = await createSession({
        signaling,
        localStream: stream,
        dataChannel: true,
        dataChannelOpenTimeoutMs: 0,
        rtcConfig,
        onRemoteStream: ({ stream }) => {
          setRemoteStream(stream);
          setLog((items) => [...items, 'received remote video']);
        },
      });

      nextSession.on('open', () => {
        setDataChannelOpen(true);
        setLog((items) => [...items, 'data channel open']);
      });
      nextSession.on('message', ({ data }) => {
        setLog((items) => [...items, `received: ${data}`]);
      });
      nextSession.on('close', () => {
        setDataChannelOpen(false);
      });

      signalingRef.current = signaling;
      sessionRef.current = nextSession;
      localStreamRef.current = stream;
      setSession(nextSession);
      setRole(roleToStart);
      setLocalStream(stream);
      setRemoteStream(nextSession.remoteStream);
      setDataChannelOpen(nextSession.dataChannel?.readyState === 'open');
      setLog((items) => [
        ...items,
        roleToStart === 'host'
          ? `created room ${roomId}`
          : `joined room ${roomId}`,
      ]);
      window.history.replaceState(
        null,
        '',
        `?room=${roomId}&role=${roleToStart}`,
      );
    } catch (error) {
      closeCurrentSession({ session: null, signaling, localStream: stream });
      setLog((items) => [...items, `start failed: ${error.message}`]);
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  }

  function send() {
    session.send(message);
    setLog((items) => [...items, `sent: ${message}`]);
  }

  function disconnect() {
    closeCurrentSession({
      session: sessionRef.current,
      signaling: signalingRef.current,
      localStream: localStreamRef.current,
    });
    signalingRef.current = null;
    sessionRef.current = null;
    localStreamRef.current = null;
    setSession(null);
    setLocalStream(null);
    setRemoteStream(null);
    setDataChannelOpen(false);
    setLog((items) => [...items, 'closed']);
  }

  useEffect(
    () => () => {
      closeCurrentSession({
        session: sessionRef.current,
        signaling: signalingRef.current,
        localStream: localStreamRef.current,
      });
    },
    [],
  );

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 760 }}>
      <h1>@kidlib/p2p React video call</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label='Room id'
          value={roomId}
          disabled={Boolean(session) || isStarting}
          onChange={(event) => setRoomId(event.target.value)}
        />
        <button
          onClick={() => start('host')}
          disabled={Boolean(session) || isStarting}
        >
          Create room
        </button>
        <button
          onClick={() => start('guest')}
          disabled={Boolean(session) || isStarting}
        >
          Join room
        </button>
        <button onClick={disconnect} disabled={!session}>
          Disconnect
        </button>
      </div>

      <p>
        Role: {role}. Guest link:{' '}
        <a href={joinUrl} target='_blank' rel='noreferrer'>
          open another tab
        </a>
      </p>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Video title='Local camera' stream={localStream} muted />
        <Video title='Remote video' stream={remoteStream} />
      </section>

      <div style={{ marginTop: 16 }}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />

        <button onClick={send} disabled={!dataChannelOpen}>
          Send
        </button>
      </div>

      <pre>{log.join('\n')}</pre>
    </main>
  );
}

function Video({ title, stream, muted = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ marginBottom: 4 }}>{title}</div>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#111',
          borderRadius: 6,
        }}
      />
    </label>
  );
}

function closeCurrentSession({ session, signaling, localStream }) {
  session?.close();
  signaling?.close();
  stopStream(localStream);
}

function stopStream(stream) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 8);
}
