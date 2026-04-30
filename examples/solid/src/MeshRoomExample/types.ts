import type { P2PRoomState } from '@kidlib/p2p';

export type RoomStatus =
  | P2PRoomState
  | 'idle'
  | 'full'
  | 'error';
