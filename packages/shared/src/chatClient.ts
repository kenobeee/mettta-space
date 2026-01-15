import type { ChatEvents, ClientMessage, ServerMessage } from './types.js';

type Handler<T> = (payload: T) => void;

export class ChatClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly listeners: {
    [K in keyof ChatEvents]: Set<Handler<ChatEvents[K]>>;
  };

  constructor(url: string) {
    this.url = url;
    this.listeners = {
      open: new Set(),
      close: new Set(),
      welcome: new Set(),
      lobbies: new Set(),
      lobbyState: new Set(),
      signal: new Set(),
      userStatus: new Set(),
      screenSharer: new Set(),
      hand: new Set(),
      error: new Set(),
      log: new Set()
    };
  }

  on<K extends keyof ChatEvents>(event: K, handler: Handler<ChatEvents[K]>) {
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  private emit<K extends keyof ChatEvents>(event: K, payload: ChatEvents[K]) {
    for (const handler of this.listeners[event]) {
      handler(payload);
    }
  }

  private log(msg: string) {
    this.emit('log', msg);
  }

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.onopen = () => {
      this.emit('open', undefined);
      this.log('WS open');
    };

    ws.onclose = (event) => {
      this.emit('close', undefined);
      this.log(`WS close: code=${event.code}, reason=${event.reason || 'none'}, wasClean=${event.wasClean}`);
    };

    ws.onerror = () => {
      this.log('WS error');
    };

    ws.onmessage = (event) => {
      let parsed: ServerMessage | null = null;
      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch {
        this.log('WS invalid JSON');
        return;
      }

      switch (parsed.type) {
        case 'welcome':
          this.emit('welcome', { clientId: parsed.clientId });
          break;
        case 'lobbies':
          this.emit('lobbies', parsed.lobbies);
          break;
        case 'lobbyState':
          this.emit('lobbyState', { lobbyId: parsed.lobbyId, users: parsed.users });
          break;
        case 'signal':
          this.emit('signal', { from: parsed.from, payload: parsed.payload });
          break;
        case 'userStatus':
          this.emit('userStatus', { userId: parsed.userId, muted: parsed.muted });
          break;
        case 'screenSharer':
          this.emit('screenSharer', { userId: parsed.userId });
          break;
        case 'hand':
          this.emit('hand', { userId: parsed.userId, raised: parsed.raised });
          break;
        case 'error':
          this.emit('error', parsed.message);
          break;
        default:
          this.log('WS unknown message');
      }
    };
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private send(message: ClientMessage) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.log('WS not ready');
    }
  }

  listLobbies() {
    this.send({ type: 'listLobbies' });
  }

  sendDevice(deviceId: string) {
    this.send({ type: 'clientInfo', deviceId });
  }

  joinLobby(lobbyId: string) {
    this.send({ type: 'joinLobby', lobbyId });
  }

  leaveLobby() {
    this.send({ type: 'leaveLobby' });
  }

  sendSignal(payload: unknown) {
    // targetId обязателен на уровне вызова
    this.log('sendSignal called without targetId wrapper');
    this.send({ type: 'signal', targetId: '', payload });
  }

  sendSignalTo(targetId: string, payload: unknown) {
    this.send({ type: 'signal', targetId, payload });
  }

  sendStatus(muted: boolean) {
    this.send({ type: 'status', muted });
  }

  sendScreenShare(action: 'start' | 'stop') {
    this.send({ type: 'screenShare', action });
  }

  sendHand(raised: boolean) {
    this.send({ type: 'hand', raised });
  }

  sendLog(level: 'debug' | 'info' | 'warn' | 'error', category: string, message: string, data?: unknown) {
    this.send({ type: 'clientLog', level, category, message, data });
  }
}

