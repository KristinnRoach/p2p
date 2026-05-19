import type { JSX } from 'solid-js';
import type {
  P2PChatMessage,
  P2PComponentsOptions,
  P2PRoomElement,
  P2PRoomSnapshot,
} from '../web-components.js';

export * from '../web-components.js';

type RoomEventTargetAttrs<
  E extends Event,
  CurrentTarget extends Element = P2PRoomElement,
> = E & {
  currentTarget: CurrentTarget;
  target: Element;
};

export type P2PRoomChangeEvent = RoomEventTargetAttrs<
  CustomEvent<P2PRoomSnapshot>
>;
export type P2PChatMessageEvent = RoomEventTargetAttrs<
  CustomEvent<P2PChatMessage>,
  HTMLElement
>;
export type P2PRoomChatMessageEvent = RoomEventTargetAttrs<
  CustomEvent<P2PChatMessage>
>;

type BaseHTMLAttrs<E extends HTMLElement> = JSX.HTMLAttributes<E>;

interface P2PRoomAttrs extends BaseHTMLAttrs<P2PRoomElement> {
  'room-id'?: string;
  'member-capacity'?: number | string;
  'peer-id'?: string;
  'prop:createSignaling'?: P2PComponentsOptions['createSignaling'];
  'prop:getLocalStream'?: P2PComponentsOptions['getLocalStream'];
  'prop:roomOptions'?: P2PComponentsOptions['roomOptions'];
  'on:p2p-room-change'?: (event: P2PRoomChangeEvent) => void;
  'on:p2p-chat-message'?: (event: P2PRoomChatMessageEvent) => void;
}

interface P2PChatAttrs extends BaseHTMLAttrs<HTMLElement> {
  'max-messages'?: number | string;
  'on:p2p-chat-message'?: (event: P2PChatMessageEvent) => void;
}

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'p2p-room': P2PRoomAttrs;
      'p2p-room-controls': BaseHTMLAttrs<HTMLElement>;
      'p2p-room-status': BaseHTMLAttrs<HTMLElement>;
      'p2p-video-grid': BaseHTMLAttrs<HTMLElement>;
      'p2p-chat': P2PChatAttrs;
    }

    interface CustomEvents {
      'p2p-room-change': P2PRoomChangeEvent;
      'p2p-chat-message': P2PChatMessageEvent;
    }
  }
}

export declare function P2PRoom(
  props: {
    roomId?: string;
    memberCapacity?: number | string;
    peerId?: string;
    createSignaling?: P2PComponentsOptions['createSignaling'];
    getLocalStream?: P2PComponentsOptions['getLocalStream'];
    roomOptions?: P2PComponentsOptions['roomOptions'];
    onRoomChange?: (event: P2PRoomChangeEvent) => void;
  } & BaseHTMLAttrs<P2PRoomElement>,
): JSX.Element;

export declare function P2PVideoGrid(
  props: BaseHTMLAttrs<HTMLElement>,
): JSX.Element;
export declare function P2PChat(
  props: {
    maxMessages?: number | string;
    onChatMessage?: (event: P2PChatMessageEvent) => void;
  } & BaseHTMLAttrs<HTMLElement>,
): JSX.Element;
export declare function P2PRoomControls(
  props: BaseHTMLAttrs<HTMLElement>,
): JSX.Element;
export declare function P2PRoomStatus(
  props: BaseHTMLAttrs<HTMLElement>,
): JSX.Element;
