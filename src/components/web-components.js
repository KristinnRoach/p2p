import { joinP2PRoom } from '../index.js';

const CHAT_TYPE = 'kidlib:p2p:components:chat';
const DEFAULT_MEMBER_CAPACITY = 6;

const componentDefaults = {
  createSignaling: null,
  getLocalStream: defaultGetLocalStream,
  roomOptions: null,
};

export function configureP2PComponents(options = {}) {
  if ('createSignaling' in options) {
    componentDefaults.createSignaling = options.createSignaling;
  }
  if ('getLocalStream' in options) {
    componentDefaults.getLocalStream = options.getLocalStream;
  }
  if ('roomOptions' in options) {
    componentDefaults.roomOptions = options.roomOptions;
  }
}

export function defineP2PComponents(options = {}) {
  configureP2PComponents(options);
  defineP2PRoom();
  defineP2PRoomControls();
  defineP2PRoomStatus();
  defineP2PVideoGrid();
  defineP2PChat();
}

export function defineP2PRoom() {
  defineElement('p2p-room', P2PRoomElement);
}

export function defineP2PRoomControls() {
  defineElement('p2p-room-controls', P2PRoomControlsElement);
}

export function defineP2PRoomStatus() {
  defineElement('p2p-room-status', P2PRoomStatusElement);
}

export function defineP2PVideoGrid() {
  defineElement('p2p-video-grid', P2PVideoGridElement);
}

export function defineP2PChat() {
  defineElement('p2p-chat', P2PChatElement);
}

export class P2PRoomElement extends HTMLElement {
  static get observedAttributes() {
    return ['room-id', 'member-capacity'];
  }

  constructor() {
    super();
    this.room = null;
    this.peerId = crypto.randomUUID();
    this.createSignaling = null;
    this.getLocalStream = null;
    this.roomOptions = null;
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
    return Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_MEMBER_CAPACITY;
  }

  set memberCapacity(value) {
    this.setAttribute('member-capacity', String(value));
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

    const createSignaling =
      this.createSignaling || componentDefaults.createSignaling;
    if (typeof createSignaling !== 'function') {
      this.setError(
        'p2p-room requires a createSignaling function before joining',
      );
      return;
    }

    this.state = 'joining';
    this.error = '';
    this.notify();

    try {
      const room = await joinP2PRoom({
        ...componentDefaults.roomOptions,
        ...this.roomOptions,
        roomId,
        peerId: this.peerId,
        createSignaling,
        getLocalStream: this.getLocalStream || componentDefaults.getLocalStream,
        memberCapacity: this.memberCapacity,
        dataChannel: true,
        dataChannelOpenTimeoutMs: 0,
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

  setError(message) {
    this.error = message;
    this.notify();
  }
}

export class P2PRoomControlsElement extends HTMLElement {
  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
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
        <input name="roomId" aria-label="Room ID">
        <button class="primary" type="submit">Join room</button>
        <button name="leave" type="button">Leave</button>
      </form>
    `;
    const form = this.shadowRoot.querySelector('form');
    this.form = form;
    this.input = form.elements.roomId;
    this.joinBtn = form.querySelector('button.primary');
    this.leaveBtn = form.elements.leave;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.roomElement.roomId = this.input.value.trim();
      this.roomElement.join();
    });
    this.leaveBtn.addEventListener('click', () => this.roomElement.leave());

    this.unsubscribe = this.roomElement.subscribe((state) => {
      this.render(state);
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render(state) {
    if (!this.form) return;
    const isJoined = state.state === 'joined';
    const isJoining = state.state === 'joining';
    if (document.activeElement !== this.input && this.input.value !== state.roomId) {
      this.input.value = state.roomId;
    }
    this.input.disabled = isJoined || isJoining;
    this.joinBtn.disabled = isJoined || isJoining;
    this.joinBtn.textContent = isJoining ? 'Joining...' : 'Join room';
    this.leaveBtn.disabled = !isJoined;
  }
}

export class P2PRoomStatusElement extends HTMLElement {
  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; color: #354052; }
        p { margin: 0.35rem 0; }
        .error { color: #b42318; }
      </style>
      <p class="status"></p>
      <p class="members"></p>
      <p class="error" hidden></p>
    `;
    this.statusEl = this.shadowRoot.querySelector('.status');
    this.membersEl = this.shadowRoot.querySelector('.members');
    this.errorEl = this.shadowRoot.querySelector('.error');
    this.unsubscribe = this.roomElement.subscribe((state) => {
      this.render(state);
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render(state) {
    if (!this.statusEl) return;
    this.statusEl.textContent = `Status: ${state.state}`;
    this.membersEl.textContent = `Members: ${state.memberCount} / ${state.memberCapacity}`;
    if (state.error) {
      this.errorEl.textContent = `Error: ${state.error}`;
      this.errorEl.hidden = false;
    } else {
      this.errorEl.hidden = true;
    }
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
    this.unsubscribe = this.roomElement.subscribe((state) => {
      this.render(state);
    });
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
      const { figure, created } = getOrCreateVideoFigure(grid, item.id);
      const video = figure.querySelector('video');
      const caption = figure.querySelector('figcaption');

      caption.textContent = item.title;
      video.muted = item.muted;
      if (video.srcObject !== item.stream) {
        video.srcObject = item.stream;
        video.play().catch(() => {});
      }
      if (created) grid.append(figure);
    }

    for (const figure of [...grid.querySelectorAll('figure[data-stream-id]')]) {
      if (liveIds.has(figure.dataset.streamId)) continue;
      const video = figure.querySelector('video');
      video.srcObject = null;
      figure.remove();
    }
  }
}

const CHAT_HISTORY_LIMIT = 50;

export class P2PChatElement extends HTMLElement {
  constructor() {
    super();
    this.messageCount = 0;
  }

  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
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
        <div class="meta empty">Messages appear here after another tab joins.</div>
      </div>
      <form>
        <input name="message" aria-label="Message" placeholder="Message" disabled>
        <button type="submit" disabled>Send</button>
      </form>
    `;
    this.messagesEl = this.shadowRoot.querySelector('.messages');
    this.emptyEl = this.shadowRoot.querySelector('.empty');
    this.input = this.shadowRoot.querySelector('input[name="message"]');
    this.sendBtn = this.shadowRoot.querySelector('button[type="submit"]');

    this.shadowRoot
      .querySelector('form')
      .addEventListener('submit', (event) => {
        event.preventDefault();
        const text = this.input.value.trim();
        if (!text) return;
        this.roomElement.sendChat(text);
        this.input.value = '';
      });

    this.unsubscribe = this.roomElement.subscribe((state) => {
      this.state = state;
      this.updateSendState();
    });
    this.onMessage = (event) => this.appendMessage(event.detail);
    this.roomElement.addEventListener('p2p-chat-message', this.onMessage);
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.roomElement?.removeEventListener('p2p-chat-message', this.onMessage);
  }

  updateSendState() {
    if (!this.input) return;
    const state = this.state || {};
    const canSend = state.state === 'joined' && state.openDataChannels > 0;
    this.input.disabled = !canSend;
    this.sendBtn.disabled = !canSend;
  }

  appendMessage(message) {
    if (!this.messagesEl) return;
    if (this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }
    const node = createChatMessageNode(message);
    this.messagesEl.append(node);
    this.messageCount += 1;
    while (this.messageCount > CHAT_HISTORY_LIMIT && this.messagesEl.firstElementChild) {
      this.messagesEl.firstElementChild.remove();
      this.messageCount -= 1;
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

function defaultGetLocalStream() {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

function defineElement(name, elementClass) {
  if (!customElements.get(name)) customElements.define(name, elementClass);
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

function createChatMessageNode(message) {
  const label = message.local
    ? 'You'
    : `Peer ${(message.senderId || message.memberId || '').slice(0, 8)}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'message';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = label;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = message.text;
  wrapper.append(meta, text);
  return wrapper;
}

function getOrCreateVideoFigure(grid, id) {
  const existing = grid.querySelector(
    `figure[data-stream-id="${CSS.escape(id)}"]`,
  );
  if (existing) return { figure: existing, created: false };

  const figure = document.createElement('figure');
  const video = document.createElement('video');
  const caption = document.createElement('figcaption');

  figure.dataset.streamId = id;
  video.autoplay = true;
  video.playsInline = true;
  figure.append(video, caption);

  return { figure, created: true };
}

