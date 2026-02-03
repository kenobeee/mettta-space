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
export type ChatRoom = { id: string; name: string };
export type ChatRoomMessage =
  | {
      id: string;
      roomId: string;
      userId: string;
      displayName: string;
      createdAt: string;
      kind: 'text';
      text: string;
    }
  | {
      id: string;
      roomId: string;
      userId: string;
      displayName: string;
      createdAt: string;
      kind: 'file';
      fileName: string;
      fileType: string;
      fileSize: number;
      dataUrl: string;
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
  | { type: 'auth'; token: string }
  | { type: 'register'; firstName: string; lastName: string }
  | { type: 'clientInfo'; deviceId: string }
  | { type: 'listLobbies' }
  | { type: 'joinLobby'; lobbyId: string }
  | { type: 'leaveLobby' }
  | { type: 'chat'; text: string }
  | { type: 'listChatRooms' }
  | { type: 'joinChatRoom'; roomId: string }
  | { type: 'chatRoomMessage'; roomId: string; text: string }
  | {
      type: 'chatRoomFile';
      roomId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      dataUrl: string;
    }
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
  | { type: 'authOk'; token: string; profile: { id: string; displayName: string } }
  | { type: 'authError'; message: string }
  | { type: 'lobbies'; lobbies: LobbyInfo[] }
  | { type: 'lobbyState'; lobbyId: string; users: LobbyUser[] }
  | { type: 'chatHistory'; lobbyId: string; messages: ChatMessage[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chatRooms'; rooms: ChatRoom[] }
  | { type: 'chatRoomHistory'; roomId: string; messages: ChatRoomMessage[] }
  | { type: 'chatRoomMessage'; message: ChatRoomMessage }
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
  authOk: { token: string; profile: { id: string; displayName: string } };
  authError: string;
  lobbies: LobbyInfo[];
  lobbyState: { lobbyId: string; users: LobbyUser[] };
  chatHistory: { lobbyId: string; messages: ChatMessage[] };
  chat: ChatMessage;
  chatRooms: ChatRoom[];
  chatRoomHistory: { roomId: string; messages: ChatRoomMessage[] };
  chatRoomMessage: ChatRoomMessage;
  meetings: Meeting[];
  signal: { from: string; payload: unknown };
  userStatus: { userId: string; muted: boolean };
  screenSharer: { userId: string | null };
  hand: { userId: string; raised: boolean };
  error: string;
  log: string;
};

