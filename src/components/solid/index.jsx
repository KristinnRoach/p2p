import { splitProps } from 'solid-js';
import { defineP2PComponents } from '../web-components.js';

export {
  configureP2PComponents,
  defineP2PComponents,
  defineP2PRoom,
  defineP2PRoomControls,
  defineP2PRoomStatus,
  defineP2PVideoGrid,
  defineP2PChat,
  P2PRoomElement,
  P2PRoomControlsElement,
  P2PRoomStatusElement,
  P2PVideoGridElement,
  P2PChatElement,
} from '../web-components.js';

function useP2PRegistration() {
  if (typeof customElements !== 'undefined') {
    defineP2PComponents();
  }
}

export function P2PRoom(props) {
  useP2PRegistration();

  const [local, rest] = splitProps(props, [
    'roomId',
    'memberCapacity',
    'peerId',
    'createSignaling',
    'getLocalStream',
    'roomOptions',
    'onRoomChange',
  ]);

  return (
    <p2p-room
      {...rest}
      room-id={local.roomId}
      member-capacity={local.memberCapacity}
      peer-id={local.peerId}
      prop:createSignaling={local.createSignaling}
      prop:getLocalStream={local.getLocalStream}
      prop:roomOptions={local.roomOptions}
      on:p2p-room-change={local.onRoomChange}
    />
  );
}

export function P2PVideoGrid(props) {
  useP2PRegistration();
  return <p2p-video-grid {...props} />;
}

export function P2PChat(props) {
  useP2PRegistration();
  const [local, rest] = splitProps(props, ['maxMessages', 'onChatMessage']);

  return (
    <p2p-chat
      {...rest}
      max-messages={local.maxMessages}
      on:p2p-chat-message={local.onChatMessage}
    />
  );
}

export function P2PRoomControls(props) {
  useP2PRegistration();
  return <p2p-room-controls {...props} />;
}

export function P2PRoomStatus(props) {
  useP2PRegistration();
  return <p2p-room-status {...props} />;
}
