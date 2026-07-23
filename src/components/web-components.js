import { joinP2PRoom } from '../index.js';

const CHAT_TYPE = 'kidlib:p2p:components:chat';
const DEFAULT_MEMBER_CAPACITY = 6;
const DEFAULT_CHAT_HISTORY_LIMIT = 50;

const SHARED_VARS = `
  :host {
    --p2p-accent: #1455d9;
    --p2p-accent-fg: #fff;
    --p2p-border: #c9ced6;
    --p2p-radius: 6px;
    --p2p-bg: #fff;
    --p2p-fg: #354052;
    --p2p-muted-fg: #667085;
    --p2p-error: #b42318;
  }
`;

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
  #room = null;
  #generatedPeerId = crypto.randomUUID();
  #state = 'idle';
  #error = '';
  #localStream = null;
  #remoteStreams = [];
  #leavePending = false;
  #joinController = null;

  static get observedAttributes() {
    return ['room-id', 'member-capacity', 'peer-id'];
  }

  constructor() {
    super();
    this.createSignaling = null;
    this.getLocalStream = null;
    this.roomOptions = null;
    this.subscribers = new Set();
    this.chatListenerCount = 0;
  }

  connectedCallback() {
    this.#leavePending = false;
    this.notify();
  }

  disconnectedCallback() {
    this.#leavePending = true;
    queueMicrotask(() => {
      if (this.isConnected || !this.#leavePending) return;
      this.#leavePending = false;
      this.leave();
    });
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

  get peerId() {
    return this.getAttribute('peer-id') || this.#generatedPeerId;
  }

  set peerId(value) {
    if (value) this.setAttribute('peer-id', value);
    else this.removeAttribute('peer-id');
  }

  get room() {
    return this.#room;
  }
  get state() {
    return this.#state;
  }
  get error() {
    return this.#error;
  }
  get localStream() {
    return this.#localStream;
  }
  get remoteStreams() {
    return this.#remoteStreams;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.snapshot());
    return () => this.subscribers.delete(callback);
  }

  enableChatParsing() {
    this.chatListenerCount += 1;
  }

  disableChatParsing() {
    if (this.chatListenerCount > 0) this.chatListenerCount -= 1;
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

    this.#state = 'joining';
    this.#error = '';
    this.notify();

    const controller = new AbortController();
    this.#joinController = controller;

    try {
      const room = await joinP2PRoom({
        ...componentDefaults.roomOptions,
        ...this.roomOptions,
        signal: controller.signal,
        roomId,
        peerId: this.peerId,
        createSignaling,
        getLocalStream: this.getLocalStream || componentDefaults.getLocalStream,
        memberCapacity: this.memberCapacity,
        dataChannel: true,
        dataChannelOpenTimeoutMs: 0,
        onLocalStream: ({ stream }) => {
          if (controller.signal.aborted) return;
          this.#localStream = stream;
          this.notify();
        },
        onMemberStream: () => this.syncFromRoom(),
        onMemberLeft: () => this.syncFromRoom(),
        onMembersChanged: () => this.syncFromRoom(),
        onStateChange: ({ state }) => {
          this.#state = state;
          this.notify();
        },
        onDataChannelOpen: () => this.notify(),
        onDataChannelClose: () => this.notify(),
        onDataChannelMessage: ({ memberId, data }) => {
          if (this.chatListenerCount === 0) return;
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
          this.#error = error?.message || String(error);
          this.notify();
        },
      });

      if (this.#joinController !== controller || controller.signal.aborted) {
        room.close();
        return;
      }
      this.#joinController = null;
      this.#room = room;
      this.syncFromRoom();
    } catch (error) {
      if (this.#joinController === controller) this.#joinController = null;
      if (controller.signal.aborted && error?.name === 'AbortError') return;
      this.leave();
      this.#state = 'idle';
      this.#error = error?.message || String(error);
      this.notify();
    }
  }

  async leave() {
    this.#joinController?.abort();
    this.#joinController = null;
    const room = this.room;
    if (room) {
      try {
        await room.leave();
      } catch (error) {
        this.#error = error?.message || String(error);
      } finally {
        room.close();
      }
    }
    this.#room = null;
    this.#localStream = null;
    this.#remoteStreams = [];
    this.#state = 'idle';
    this.notify();
  }

  sendChat(text) {
    const cleanText = String(text ?? '').trim();
    if (!cleanText) return 0;
    const message = {
      type: CHAT_TYPE,
      id: crypto.randomUUID(),
      text: cleanText,
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
    this.#state = this.room.state;
    this.#localStream = this.room.localStream;
    this.#remoteStreams = this.room.remoteMemberStreams;
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
    this.#error = message;
    this.notify();
  }
}

export class P2PRoomControlsElement extends HTMLElement {
  connectedCallback() {
    this.roomElement = findRoomElement(this);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_VARS}
        form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
        input, button { font: inherit; padding: 0.55rem 0.7rem; border: 1px solid var(--p2p-border); border-radius: var(--p2p-radius); }
        input { min-width: 12rem; background: var(--p2p-bg); color: var(--p2p-fg); }
        button { cursor: pointer; background: var(--p2p-bg); color: var(--p2p-fg); }
        button.primary { color: var(--p2p-accent-fg); background: var(--p2p-accent); border-color: var(--p2p-accent); }
        button:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
      </style>
      <form part="form">
        <input name="roomId" part="room-id-input" aria-label="Room ID">
        <button class="primary" type="submit" part="join-button">Join room</button>
        <button name="leave" type="button" part="leave-button">Leave</button>
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
    if (
      this.shadowRoot.activeElement !== this.input &&
      this.input.value !== state.roomId
    ) {
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
        ${SHARED_VARS}
        :host { display: block; color: var(--p2p-fg); }
        p { margin: 0.35rem 0; }
        .error { color: var(--p2p-error); }
      </style>
      <p class="status" part="status"></p>
      <p class="members" part="members"></p>
      <p class="error" part="error" role="alert" hidden></p>
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
        ${SHARED_VARS}
        :host { display: block; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
        figure { margin: 0; }
        video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #111; border-radius: var(--p2p-radius); object-fit: cover; }
        figcaption { margin-top: 0.35rem; color: var(--p2p-fg); font-size: 0.9rem; }
        .empty { min-height: 8rem; display: grid; place-items: center; border: 1px dashed var(--p2p-border); border-radius: var(--p2p-radius); color: var(--p2p-muted-fg); }
        [hidden] { display: none !important; }
      </style>
      <div class="grid" part="grid" hidden></div>
      <div class="empty" part="empty">Join a room to start video</div>
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

export class P2PChatElement extends HTMLElement {
  static get observedAttributes() {
    return ['max-messages'];
  }

  constructor() {
    super();
    this.messageCount = 0;
  }

  get maxMessages() {
    const value = Number(this.getAttribute('max-messages'));
    return Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_CHAT_HISTORY_LIMIT;
  }

  set maxMessages(value) {
    this.setAttribute('max-messages', String(value));
  }

  connectedCallback() {
    this.roomElement = findRoomElement(this);
    this.roomElement.enableChatParsing();
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_VARS}
        :host { display: block; }
        .messages { min-height: 8rem; max-height: 16rem; overflow: auto; padding: 0.75rem; border: 1px solid var(--p2p-border); border-radius: var(--p2p-radius); background: var(--p2p-bg); }
        .message + .message { margin-top: 0.55rem; }
        .meta { color: var(--p2p-muted-fg); font-size: 0.8rem; }
        .text { margin-top: 0.1rem; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--p2p-fg); }
        form { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
        input, button { font: inherit; padding: 0.55rem 0.7rem; border: 1px solid var(--p2p-border); border-radius: var(--p2p-radius); }
        input { flex: 1; min-width: 0; background: var(--p2p-bg); color: var(--p2p-fg); }
        button { color: var(--p2p-accent-fg); background: var(--p2p-accent); border-color: var(--p2p-accent); }
        button:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
      </style>
      <div class="messages" part="messages" aria-live="polite">
        <div class="meta empty">Messages appear here after you join.</div>
      </div>
      <form part="form">
        <input name="message" part="input" aria-label="Message" placeholder="Message" disabled>
        <button type="submit" part="send-button" disabled>Send</button>
      </form>
    `;
    this.messageCount = 0;
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
    this.roomElement?.disableChatParsing();
  }

  attributeChangedCallback(name) {
    if (name !== 'max-messages' || !this.messagesEl) return;
    this.trimToCap();
  }

  updateSendState() {
    if (!this.input) return;
    const state = this.state || {};
    const canSend = state.state === 'joined';
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
    this.trimToCap();
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  trimToCap() {
    const cap = this.maxMessages;
    while (this.messageCount > cap && this.messagesEl.firstElementChild) {
      this.messagesEl.firstElementChild.remove();
      this.messageCount -= 1;
    }
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
  wrapper.setAttribute('part', 'message');
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
  figure.setAttribute('part', 'tile');
  const video = document.createElement('video');
  video.setAttribute('part', 'video');
  const caption = document.createElement('figcaption');
  caption.setAttribute('part', 'caption');

  figure.dataset.streamId = id;
  video.autoplay = true;
  video.playsInline = true;
  figure.append(video, caption);

  return { figure, created: true };
}
