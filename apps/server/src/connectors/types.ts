import type { ConnectorStatus, NormalizedEvent } from '@cau/shared';

export type ConnectorEventListener = (event: NormalizedEvent) => void;

export interface ConnectorState {
  status: ConnectorStatus;
  username: string | null;
  roomId: string | null;
  viewerCount: number;
  lastError: string | null;
  reconnectAttempt: number;
}

export type ConnectorStateListener = (state: ConnectorState) => void;

/**
 * Interface chung cho mọi nguồn sự kiện LIVE. Engine chỉ thấy NormalizedEvent,
 * nên có thể thay connector (thư viện khác, webhook TikFinity…) mà không đụng Game Engine.
 */
export interface LiveConnector {
  readonly name: string;
  onEvent(fn: ConnectorEventListener): void;
  onState(fn: ConnectorStateListener): void;
  state(): ConnectorState;
}
