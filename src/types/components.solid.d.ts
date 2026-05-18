import type { JSX } from 'solid-js';
import type {
  P2PChatMessage,
  P2PComponentsOptions,
  P2PRoomElement,
  P2PRoomSnapshot,
} from './components.js';

export {};

type RoomEventTargetAttrs<E extends Event> = E & {
  currentTarget: P2PRoomElement;
  target: Element;
};

export type P2PRoomChangeEvent = RoomEventTargetAttrs<
  CustomEvent<P2PRoomSnapshot>
>;
export type P2PChatMessageEvent = RoomEventTargetAttrs<
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
  'on:p2p-chat-message'?: (event: P2PChatMessageEvent) => void;
}

interface P2PChatAttrs extends BaseHTMLAttrs<HTMLElement> {
  'max-messages'?: number | string;
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
