export type ChatStatus = 'idle' | 'in-lobby' | 'error';

export type LobbyInfo = { id: string; name: string; count: number; capacity: number };
export type LobbyUser = { id: string; displayName: string; muted?: boolean; isScreenSharer?: boolean; handRaised?: boolean };
export type ChatMessage = {
  id: string;
  lobbyId: string;
  userId: string;
  displayName: string;
  text: string;
  createdAt: string;
};
export type Meeting = {
  id: string;
  lobbyId: string;
  title: string;
  startsAt: string;
  durationMin: number;
  createdAt: string;
};

export type ClientMessage =
  | { type: 'clientInfo'; deviceId: string }
  | { type: 'listLobbies' }
  | { type: 'joinLobby'; lobbyId: string }
  | { type: 'leaveLobby' }
  | { type: 'chat'; text: string }
  | { type: 'listMeetings' }
  | { type: 'createMeeting'; meeting: { title: string; startsAt: string; durationMin: number } }
  | { type: 'updateMeeting'; meeting: { id: string; title: string; startsAt: string; durationMin: number } }
  | { type: 'deleteMeeting'; id: string }
  | { type: 'status'; muted: boolean }
  | { type: 'screenShare'; action: 'start' | 'stop' }
  | { type: 'hand'; raised: boolean }
  | { type: 'signal'; targetId: string; payload: unknown }
  | { type: 'clientLog'; level: 'debug' | 'info' | 'warn' | 'error'; category: string; message: string; data?: unknown };

export type ServerMessage =
  | { type: 'welcome'; clientId: string }
  | { type: 'lobbies'; lobbies: LobbyInfo[] }
  | { type: 'lobbyState'; lobbyId: string; users: LobbyUser[] }
  | { type: 'chatHistory'; lobbyId: string; messages: ChatMessage[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'meetings'; meetings: Meeting[] }
  | { type: 'signal'; from: string; payload: unknown }
  | { type: 'userStatus'; userId: string; muted: boolean }
  | { type: 'screenSharer'; userId: string | null }
  | { type: 'hand'; userId: string; raised: boolean }
  | { type: 'error'; message: string };

export type ChatEvents = {
  open: void;
  close: void;
  welcome: { clientId: string };
  lobbies: LobbyInfo[];
  lobbyState: { lobbyId: string; users: LobbyUser[] };
  chatHistory: { lobbyId: string; messages: ChatMessage[] };
  chat: ChatMessage;
  meetings: Meeting[];
  signal: { from: string; payload: unknown };
  userStatus: { userId: string; muted: boolean };
  screenSharer: { userId: string | null };
  hand: { userId: string; raised: boolean };
  error: string;
  log: string;
};

