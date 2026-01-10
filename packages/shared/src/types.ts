export type ChatStatus = 'idle' | 'in-lobby' | 'error';

export type LobbyInfo = { id: string; name: string; count: number; capacity: number };
export type LobbyUser = { id: string; displayName: string };

export type ClientMessage =
  | { type: 'clientInfo'; deviceId: string }
  | { type: 'listLobbies' }
  | { type: 'joinLobby'; lobbyId: string }
  | { type: 'leaveLobby' }
  | { type: 'signal'; targetId: string; payload: unknown }
  | { type: 'clientLog'; level: 'debug' | 'info' | 'warn' | 'error'; category: string; message: string; data?: unknown };

export type ServerMessage =
  | { type: 'welcome'; clientId: string }
  | { type: 'lobbies'; lobbies: LobbyInfo[] }
  | { type: 'lobbyState'; lobbyId: string; users: LobbyUser[] }
  | { type: 'signal'; from: string; payload: unknown }
  | { type: 'error'; message: string };

export type ChatEvents = {
  open: void;
  close: void;
  welcome: { clientId: string };
  lobbies: LobbyInfo[];
  lobbyState: { lobbyId: string; users: LobbyUser[] };
  signal: { from: string; payload: unknown };
  error: string;
  log: string;
};

