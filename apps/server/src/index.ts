import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import type { ChatMessage, ClientMessage, LobbyInfo, LobbyUser, ServerMessage } from '@chat/shared';
import { writeClientLog } from './logger';

type TrackedSocket = WebSocket & { isAlive?: boolean };

const PORT = Number(process.env.PORT ?? 3001);
const LOBBIES: LobbyInfo[] = [
  { id: 'l1', name: 'TTT daily', count: 0, capacity: 0 },
  { id: 'l2', name: 'Mascot daily', count: 0, capacity: 0 }
];

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const sockets = new Map<string, TrackedSocket>();
const lobbyByClient = new Map<string, string>(); // clientId -> lobbyId
const lobbyUsers = new Map<string, LobbyUser[]>(); // lobbyId -> users
const displayNames = new Map<string, string>();
const deviceToClient = new Map<string, string>(); // deviceId -> clientId
const mutedState = new Map<string, boolean>(); // clientId -> muted
const muted = new Map<string, boolean>(); // clientId -> muted
const screenSharerByLobby = new Map<string, string | null>();
const handState = new Map<string, boolean>(); // clientId -> hand
const chatHistoryByLobby = new Map<string, ChatMessage[]>();

const randomName = () => {
  const names = [
    'Наруто',
    'Саске',
    'Сакура',
    'Какаши',
    'Итачи',
    'Мадара',
    'Хината',
    'Шикамару',
    'Гаара',
    'Боруто',
    'Сарада',
    'Мицуки',
    'Луффи',
    'Зоро',
    'Нами',
    'Санджи',
    'Усопп',
    'Чоппер',
    'Робин',
    'Фрэнки',
    'Брук',
    'Шэнкс',
    'Гоку',
    'Вегета',
    'Гохан',
    'Транкс',
    'Булма',
    'Пикколо',
    'Джинан',
    'Ванпанч',
    'Сайтама',
    'Генос',
    'Тацумакі',
    'Вэш',
    'Милле',
    'Декуро',
    'Бакуго',
    'Тодороки',
    'Урарака',
    'Айзава',
    'АллМайт',
    'Хоукс',
    'Эндеавор',
    'Гон',
    'Киллуа',
    'Курапика',
    'Хисока',
    'Неферпиту',
    'Эрен',
    'Микаса',
    'Армин',
    'Леви',
    'Эрвин',
    'Ханджи',
    'История',
    'Ймир',
    'Танджиро',
    'Незуко',
    'Зеницу',
    'Иноске',
    'Шинобу',
    'Ренгоку',
    'Музан',
    'Аня',
    'Йор',
    'Лойд',
    'Годжо',
    'Итадори',
    'Фусигуро',
    'Нобара',
    'Нанами',
    'Рюмен',
    'Эдвард',
    'Альфонс',
    'Мустанг',
    'Армстронг',
    'Винри',
    'Спайк',
    'Фэй',
    'Джетт',
    'ЭдвардЭлрик',
    'Вайолет',
    'Легоси',
    'Рем',
    'Рам',
    'Эмилия',
    'Сэйбер',
    'Рин',
    'Широ',
    'Кира',
    'Лайт',
    'Эл',
    'Миса',
    'Сижу',
    'Холо',
    'Нацу',
    'Люси',
    'Эрза',
    'Грэй',
    'Мака',
    'Соуля',
    'Юкино',
    'Кагуя',
    'Чика',
    'Хаясака'
  ];
  return names[Math.floor(Math.random() * names.length)];
};

const sendSafe = (ws: WebSocket, message: ServerMessage) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendToClient = (clientId: string, message: ServerMessage) => {
  const socket = sockets.get(clientId);
  if (socket) {
    sendSafe(socket, message);
  }
};

const broadcastLobbies = () => {
  const summary = LOBBIES.map((lobby) => {
    const users = lobbyUsers.get(lobby.id) ?? [];
    return { ...lobby, count: users.length };
  });
  for (const id of sockets.keys()) {
    sendToClient(id, { type: 'lobbies', lobbies: summary });
  }
};

const sendLobbyState = (lobbyId: string) => {
  const users = lobbyUsers.get(lobbyId) ?? [];
  const sharer = screenSharerByLobby.get(lobbyId) ?? null;
  const enriched = users.map((u) => ({
    ...u,
    muted: mutedState.get(u.id) ?? false,
    isScreenSharer: sharer === u.id,
    handRaised: handState.get(u.id) ?? false
  }));
  const message: ServerMessage = { type: 'lobbyState', lobbyId, users: enriched };
  for (const user of enriched) {
    sendToClient(user.id, message);
  }
};

const sendChatHistory = (clientId: string, lobbyId: string) => {
  const messages = chatHistoryByLobby.get(lobbyId) ?? [];
  sendToClient(clientId, { type: 'chatHistory', lobbyId, messages });
};

const broadcastChat = (lobbyId: string, message: ChatMessage) => {
  const users = lobbyUsers.get(lobbyId) ?? [];
  for (const user of users) {
    sendToClient(user.id, { type: 'chat', message });
  }
};

const broadcastStatus = (lobbyId: string, userId: string, muted: boolean) => {
  const users = lobbyUsers.get(lobbyId) ?? [];
  for (const user of users) {
    sendToClient(user.id, { type: 'userStatus', userId, muted });
  }
};

const leaveCurrentLobby = (clientId: string) => {
  const lobbyId = lobbyByClient.get(clientId);
  if (!lobbyId) return;
  const users = lobbyUsers.get(lobbyId) ?? [];
  const filtered = users.filter((u) => u.id !== clientId);
  lobbyUsers.set(lobbyId, filtered);
  if (filtered.length === 0) {
    chatHistoryByLobby.delete(lobbyId);
  }
  lobbyByClient.delete(clientId);
  muted.delete(clientId);
  if (screenSharerByLobby.get(lobbyId) === clientId) {
    screenSharerByLobby.set(lobbyId, null);
  }
  handState.delete(clientId);
  broadcastLobbies();
  sendLobbyState(lobbyId);
};

const isClientMessage = (value: unknown): value is ClientMessage => {
  if (typeof value !== 'object' || value === null) return false;
  return 'type' in value;
};

const parseClientMessage = (raw: WebSocket.RawData): ClientMessage | null => {
  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString('utf-8');
  } else if (Array.isArray(raw)) {
    text = Buffer.concat(raw).toString('utf-8');
  } else {
    text = Buffer.from(raw).toString('utf-8');
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isClientMessage(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const handleMessage = (clientId: string, raw: WebSocket.RawData) => {
  const data = parseClientMessage(raw);
  if (!data) {
    sendToClient(clientId, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  switch (data.type) {
    case 'listLobbies': {
      broadcastLobbies();
      break;
    }
    case 'clientInfo': {
      const deviceId = data.deviceId;
      if (!deviceId) {
        sendToClient(clientId, { type: 'error', message: 'Device required' });
        return;
      }
      const existing = deviceToClient.get(deviceId);
      if (existing && existing !== clientId && sockets.has(existing)) {
        sendToClient(clientId, { type: 'error', message: 'Device already connected' });
        const ws = sockets.get(clientId);
        ws?.close(4001, 'duplicate device');
        return;
      }
      deviceToClient.set(deviceId, clientId);
      break;
    }
    case 'joinLobby': {
      const lobby = LOBBIES.find((l) => l.id === data.lobbyId);
      if (!lobby) {
        sendToClient(clientId, { type: 'error', message: 'Lobby not found' });
        return;
      }
      const users = lobbyUsers.get(lobby.id) ?? [];
      // Уже в этом лобби
      if (users.find((u) => u.id === clientId)) {
        sendLobbyState(lobby.id);
        sendChatHistory(clientId, lobby.id);
        broadcastLobbies();
        return;
      }
      leaveCurrentLobby(clientId);
      const name = displayNames.get(clientId) ?? randomName();
      displayNames.set(clientId, name);
      lobbyUsers.set(lobby.id, [...users, { id: clientId, displayName: name, muted: mutedState.get(clientId) ?? false }]);
      lobbyByClient.set(clientId, lobby.id);
      broadcastLobbies();
      sendLobbyState(lobby.id);
      sendChatHistory(clientId, lobby.id);
      break;
    }
    case 'leaveLobby': {
      leaveCurrentLobby(clientId);
      break;
    }
    case 'signal': {
      const targetId = data.targetId;
      if (!targetId) {
        sendToClient(clientId, { type: 'error', message: 'No target' });
        return;
      }
      const lobbyId = lobbyByClient.get(clientId);
      if (!lobbyId || lobbyByClient.get(targetId) !== lobbyId) {
        sendToClient(clientId, { type: 'error', message: 'Not in same lobby' });
        return;
      }
      sendToClient(targetId, { type: 'signal', from: clientId, payload: data.payload });
      break;
    }
    case 'status': {
      mutedState.set(clientId, !!data.muted);
      const lobbyId = lobbyByClient.get(clientId);
      if (lobbyId) {
        const users = lobbyUsers.get(lobbyId) ?? [];
        users.forEach((u) => {
          if (u.id === clientId) u.muted = !!data.muted;
        });
        lobbyUsers.set(lobbyId, users);
        sendLobbyState(lobbyId);
      }
      break;
    }
    case 'screenShare': {
      const lobbyId = lobbyByClient.get(clientId);
      if (!lobbyId) break;
      const current = screenSharerByLobby.get(lobbyId) ?? null;
      if (data.action === 'start') {
        if (current && current !== clientId) {
          // already someone sharing; ignore
          break;
        }
        screenSharerByLobby.set(lobbyId, clientId);
        sendLobbyState(lobbyId);
        const users = lobbyUsers.get(lobbyId) ?? [];
        for (const u of users) {
          sendToClient(u.id, { type: 'screenSharer', userId: clientId });
        }
      } else {
        if (current === clientId) {
          screenSharerByLobby.set(lobbyId, null);
          sendLobbyState(lobbyId);
          const users = lobbyUsers.get(lobbyId) ?? [];
          for (const u of users) {
            sendToClient(u.id, { type: 'screenSharer', userId: null });
          }
        }
      }
      break;
    }
    case 'hand': {
      const lobbyId = lobbyByClient.get(clientId);
      if (!lobbyId) break;
      handState.set(clientId, !!data.raised);
      const users = lobbyUsers.get(lobbyId) ?? [];
      lobbyUsers.set(
        lobbyId,
        users.map((u) => (u.id === clientId ? { ...u, handRaised: !!data.raised } : u))
      );
      sendLobbyState(lobbyId);
      for (const u of users) {
        sendToClient(u.id, { type: 'hand', userId: clientId, raised: !!data.raised });
      }
      break;
    }
    case 'chat': {
      const lobbyId = lobbyByClient.get(clientId);
      if (!lobbyId) break;
      const text = data.text?.trim();
      if (!text) return;
      if (text.length > 500) {
        sendToClient(clientId, { type: 'error', message: 'Message too long' });
        return;
      }
      const message: ChatMessage = {
        id: randomUUID(),
        lobbyId,
        userId: clientId,
        displayName: displayNames.get(clientId) ?? 'User',
        text,
        createdAt: new Date().toISOString()
      };
      const history = chatHistoryByLobby.get(lobbyId) ?? [];
      history.push(message);
      if (history.length > 50) history.splice(0, history.length - 50);
      chatHistoryByLobby.set(lobbyId, history);
      broadcastChat(lobbyId, message);
      break;
    }
    case 'clientLog': {
      writeClientLog(clientId, data.level, data.category, data.message, data.data);
      break;
    }
    default:
      sendToClient(clientId, { type: 'error', message: 'Unknown message' });
  }
};

wss.on('connection', (socket: TrackedSocket) => {
  const clientId = randomUUID();
  sockets.set(clientId, socket);
  socket.isAlive = true;
  displayNames.set(clientId, randomName());

  sendToClient(clientId, { type: 'welcome', clientId });
  sendToClient(clientId, { type: 'lobbies', lobbies: LOBBIES.map((l) => ({ ...l, count: (lobbyUsers.get(l.id) ?? []).length })) });

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => handleMessage(clientId, raw));

  socket.on('close', (code, reason) => {
    leaveCurrentLobby(clientId);
    sockets.delete(clientId);
    displayNames.delete(clientId);
    for (const [device, cid] of deviceToClient.entries()) {
      if (cid === clientId) deviceToClient.delete(device);
    }
  });

  socket.on('error', (err) => {
    // suppress server-side logging
  });
});

const heartbeat = setInterval(() => {
  for (const [id, ws] of sockets.entries()) {
    if (!ws.isAlive) {
      ws.terminate();
      leaveCurrentLobby(id);
      sockets.delete(id);
      displayNames.delete(id);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

httpServer.listen(PORT, () => {
  // logging disabled
});

