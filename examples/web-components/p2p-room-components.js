import { joinP2PRoom } from '../../src/index.js';
import { createBrowserMeshRoomSignaling } from '../shared/index.js';

const CHAT_TYPE = 'kidlib:p2p:web-components:chat';
const DEFAULT_CAPACITY = 6;

export class P2PRoomElement extends HTMLElement {
  static get observedAttributes() {
    return ['room-id', 'member-capacity'];
  }

  constructor() {
    super();
    this.room = null;
    this.peerId = crypto.randomUUID();
    this.state = 'idle';
    this.error = '';
    this.localStream = null;
    this.remoteStreams = [];
    this.subscribers = new Set();
  }

  connectedCallback() {
    this.notify();
  }

  disconnectedCallback() {
    this.leave();
  }

  attributeChangedCallback() {
    this.notify();
  }

  get roomId() {
    return this.getAttribute('room-id') || 'demo-room';
  }

  set roomId(value) {
    this.setAttribute('room-id', value || 'demo-room');
  }

  get memberCapacity() {
    const value = Number(this.getAttribute('member-capacity'));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPACITY;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.snapshot());
    return () => this.subscribers.delete(callback);
  }

  async join() {
    if (this.room || this.state === 'joining') return;
    const roomId = this.roomId.trim();
    if (!roomId) return;

    this.state = 'joining';
    this.error = '';
    this.notify();

    try {
      const room = await joinP2PRoom({
        roomId,
        peerId: this.peerId,
        createSignaling: createBrowserMeshRoomSignaling,
        getLocalStream: () =>
          navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          }),
        memberCapacity: this.memberCapacity,
        dataChannel: true,
        dataChannelOpenTimeoutMs: 0,
        rtcConfig: { iceServers: [] },
        onLocalStream: ({ stream }) => {
          this.localStream = stream;
          this.notify();
        },
        onMemberStream: () => this.syncFromRoom(),
        onMemberLeft: () => this.syncFromRoom(),
        onMembersChanged: () => this.syncFromRoom(),
        onStateChange: ({ state }) => {
          this.state = state;
          this.notify();
        },
        onDataChannelOpen: () => this.notify(),
        onDataChannelClose: () => this.notify(),
        onDataChannelMessage: ({ memberId, data }) => {
          const message = parseChatMessage(data);
          if (!message) return;
          this.dispatchEvent(
            new CustomEvent('p2p-chat-message', {
              detail: { ...message, memberId },
              bubbles: true,
            }),
          );
        },
        onError: ({ error }) => {
          this.error = error?.message || String(error);
          this.notify();
        },
      });

      this.room = room;
      this.syncFromRoom();
    } catch (error) {
      this.leave();
      this.state = 'idle';
      this.error = error?.message || String(error);
      this.notify();
    }
  }

  leave() {
    this.room?.close();
    this.room = null;
    this.localStream = null;
    this.remoteStreams = [];
    this.state = 'idle';
    this.notify();
  }

  sendChat(text) {
    const message = {
      type: CHAT_TYPE,
      id: crypto.randomUUID(),
      text,
      senderId: this.peerId,
      createdAt: Date.now(),
    };
    const sent = this.room?.broadcast(JSON.stringify(message)) ?? 0;
    this.dispatchEvent(
      new CustomEvent('p2p-chat-message', {
        detail: { ...message, memberId: this.peerId, local: true },
        bubbles: true,
      }),
    );
    return sent;
  }

  syncFromRoom() {
    if (!this.room) return;
    this.state = this.room.state;
    this.localStream = this.room.localStream;
    this.remoteStreams = this.room.remoteMemberStreams;
    this.notify();
  }

  snapshot() {
    const room = this.room;
    return {
      room,
      roomId: this.roomId,
      peerId: this.peerId,
      state: this.state,
      error: this.error,
      memberCount: room?.memberCount ?? 0,
      memberCapacity: this.memberCapacity,
      localStream: this.localStream,
      remoteStreams: this.remoteStreams,
      openDataChannels: countOpenDataChannels(room),
    };
  }

  notify() {
    const detail = this.snapshot();
    for (const subscriber of this.subscribers) subscriber(detail);
    this.dispatchEvent(
      new CustomEvent('p2p-room-change', { detail, bubbles: true }),
    );
  }
}

export class P2PRoomControlsElement extends HTMLElement {
  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.unsubscribe = this.roomElement?.subscribe((state) =>
      this.render(state),
    );
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render(state) {
    if (!this.shadowRoot) return;
    const isJoined = state.state === 'joined';
    const isJoining = state.state === 'joining';
    this.shadowRoot.innerHTML = `
      <style>
        form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
        input, button { font: inherit; padding: 0.55rem 0.7rem; border: 1px solid #c9ced6; border-radius: 6px; }
        input { min-width: 12rem; }
        button { cursor: pointer; background: white; }
        button.primary { color: white; background: #1455d9; border-color: #1455d9; }
        button:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
      </style>
      <form>
        <input name="roomId" aria-label="Room ID" value="${escapeHtml(
          state.roomId,
        )}" ${isJoined || isJoining ? 'disabled' : ''}>
        <button class="primary" type="submit" ${
          isJoined || isJoining ? 'disabled' : ''
        }>${isJoining ? 'Joining...' : 'Join room'}</button>
        <button name="leave" type="button" ${!isJoined ? 'disabled' : ''}>Leave</button>
      </form>
    `;

    const form = this.shadowRoot.querySelector('form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.roomElement.roomId = form.elements.roomId.value.trim();
      this.roomElement.join();
    });
    form.elements.leave.addEventListener('click', () =>
      this.roomElement.leave(),
    );
  }
}

export class P2PRoomStatusElement extends HTMLElement {
  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.unsubscribe = this.roomElement?.subscribe((state) =>
      this.render(state),
    );
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render(state) {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; color: #354052; }
        p { margin: 0.35rem 0; }
        .error { color: #b42318; }
      </style>
      <p>Status: ${escapeHtml(state.state)}</p>
      <p>Members: ${state.memberCount} / ${state.memberCapacity}</p>
      ${state.error ? `<p class="error">Error: ${escapeHtml(state.error)}</p>` : ''}
    `;
  }
}

export class P2PVideoGridElement extends HTMLElement {
  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
        figure { margin: 0; }
        video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #111; border-radius: 6px; object-fit: cover; }
        figcaption { margin-top: 0.35rem; color: #354052; font-size: 0.9rem; }
        .empty { min-height: 8rem; display: grid; place-items: center; border: 1px dashed #c9ced6; border-radius: 6px; color: #667085; }
        [hidden] { display: none !important; }
      </style>
      <div class="grid" hidden></div>
      <div class="empty">Join a room to start video</div>
    `;
    this.unsubscribe = this.roomElement?.subscribe((state) =>
      this.render(state),
    );
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render(state) {
    if (!this.shadowRoot) return;
    const grid = this.shadowRoot.querySelector('.grid');
    const empty = this.shadowRoot.querySelector('.empty');
    const streams = [
      state.localStream && {
        id: 'local',
        title: 'Local',
        stream: state.localStream,
        muted: true,
      },
      ...state.remoteStreams.map(({ memberId, stream }) => ({
        id: memberId,
        title: `Remote ${memberId.slice(0, 8)}`,
        stream,
        muted: false,
      })),
    ].filter(Boolean);

    grid.hidden = streams.length === 0;
    empty.hidden = streams.length > 0;

    const liveIds = new Set(streams.map((item) => item.id));
    for (const item of streams) {
      const figure = getOrCreateVideoFigure(grid, item.id);
      const video = figure.querySelector('video');
      const caption = figure.querySelector('figcaption');

      caption.textContent = item.title;
      video.muted = item.muted;
      if (video.srcObject !== item.stream) {
        video.srcObject = item.stream;
        video.play().catch(() => {});
      }
      grid.append(figure);
    }

    for (const figure of [...grid.querySelectorAll('figure[data-stream-id]')]) {
      if (liveIds.has(figure.dataset.streamId)) continue;
      const video = figure.querySelector('video');
      video.srcObject = null;
      figure.remove();
    }
  }
}

export class P2PTextChatElement extends HTMLElement {
  constructor() {
    super();
    this.messages = [];
  }

  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.unsubscribe = this.roomElement?.subscribe((state) => {
      this.state = state;
      this.render();
    });
    this.onMessage = (event) => {
      this.messages = [...this.messages, event.detail].slice(-50);
      this.render();
    };
    this.roomElement?.addEventListener('p2p-chat-message', this.onMessage);
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.roomElement?.removeEventListener('p2p-chat-message', this.onMessage);
  }

  render() {
    if (!this.shadowRoot) return;
    const state = this.state || {};
    const canSend = state.state === 'joined' && state.openDataChannels > 0;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .messages { min-height: 8rem; max-height: 16rem; overflow: auto; padding: 0.75rem; border: 1px solid #d7dce3; border-radius: 6px; background: #fff; }
        .message + .message { margin-top: 0.55rem; }
        .meta { color: #667085; font-size: 0.8rem; }
        .text { margin-top: 0.1rem; white-space: pre-wrap; overflow-wrap: anywhere; }
        form { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
        input, button { font: inherit; padding: 0.55rem 0.7rem; border: 1px solid #c9ced6; border-radius: 6px; }
        input { flex: 1; min-width: 0; }
        button { color: white; background: #1455d9; border-color: #1455d9; }
        button:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
      </style>
      <div class="messages" aria-live="polite">
        ${
          this.messages.length
            ? this.messages.map(renderChatMessage).join('')
            : '<div class="meta">Messages appear here after another tab joins.</div>'
        }
      </div>
      <form>
        <input name="message" aria-label="Message" placeholder="Message" ${
          canSend ? '' : 'disabled'
        }>
        <button type="submit" ${canSend ? '' : 'disabled'}>Send</button>
      </form>
    `;

    const messages = this.shadowRoot.querySelector('.messages');
    messages.scrollTop = messages.scrollHeight;
    this.shadowRoot
      .querySelector('form')
      .addEventListener('submit', (event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.message;
        const text = input.value.trim();
        if (!text) return;
        this.roomElement.sendChat(text);
        input.value = '';
      });
  }
}

function findRoomElement(element) {
  const roomElement = element.closest('p2p-room');
  if (!roomElement) {
    throw new Error(`${element.localName} must be inside a p2p-room element`);
  }
  return roomElement;
}

function countOpenDataChannels(room) {
  if (!room) return 0;
  let count = 0;
  for (const channel of room.dataChannels.values()) {
    if (channel.readyState === 'open') count += 1;
  }
  return count;
}

function parseChatMessage(data) {
  if (typeof data !== 'string') return null;
  try {
    const message = JSON.parse(data);
    if (message?.type !== CHAT_TYPE || typeof message.text !== 'string') {
      return null;
    }
    return message;
  } catch {
    return null;
  }
}

function renderChatMessage(message) {
  const label = message.local
    ? 'You'
    : `Peer ${(message.senderId || message.memberId || '').slice(0, 8)}`;
  return `
    <div class="message">
      <div class="meta">${escapeHtml(label)}</div>
      <div class="text">${escapeHtml(message.text)}</div>
    </div>
  `;
}

function getOrCreateVideoFigure(grid, id) {
  const existing = [...grid.querySelectorAll('figure[data-stream-id]')].find(
    (figure) => figure.dataset.streamId === id,
  );
  if (existing) return existing;

  const figure = document.createElement('figure');
  const video = document.createElement('video');
  const caption = document.createElement('figcaption');

  figure.dataset.streamId = id;
  video.autoplay = true;
  video.playsInline = true;
  figure.append(video, caption);

  return figure;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

if (!customElements.get('p2p-room')) {
  customElements.define('p2p-room', P2PRoomElement);
}
if (!customElements.get('p2p-room-controls')) {
  customElements.define('p2p-room-controls', P2PRoomControlsElement);
}
if (!customElements.get('p2p-room-status')) {
  customElements.define('p2p-room-status', P2PRoomStatusElement);
}
if (!customElements.get('p2p-video-grid')) {
  customElements.define('p2p-video-grid', P2PVideoGridElement);
}
if (!customElements.get('p2p-text-chat')) {
  customElements.define('p2p-text-chat', P2PTextChatElement);
}
