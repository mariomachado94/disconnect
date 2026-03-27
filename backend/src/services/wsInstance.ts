import type { WebSocketService } from './websocket';

let _instance: WebSocketService | null = null;

export function setWsInstance(ws: WebSocketService): void {
  _instance = ws;
}

export function getWsInstance(): WebSocketService | null {
  return _instance;
}
