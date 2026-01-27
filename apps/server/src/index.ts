import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ChatMessage, ClientMessage, LobbyInfo, LobbyUser, Meeting, ServerMessage } from '@chat/shared';
import { writeClientLog } from './logger';

type TrackedSocket = WebSocket & { isAlive?: boolean };

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = join(process.cwd(), 'data');
const MEETINGS_FILE = join(DATA_DIR, 'meetings.json');

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
const meetingsById = new Map<string, Meeting>();

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const getMeetingEnd = (startsAt: Date, durationMin: number) =>
  durationMin === 0 ? Number.POSITIVE_INFINITY : startsAt.getTime() + durationMin * 60_000;

const hasMeetingConflict = (candidate: { startsAt: Date; durationMin: number; excludeId?: string }) => {
  const start = candidate.startsAt.getTime();
  const end = getMeetingEnd(candidate.startsAt, candidate.durationMin);
  for (const meeting of meetingsById.values()) {
    if (candidate.excludeId && meeting.id === candidate.excludeId) continue;
    const existingStart = new Date(meeting.startsAt).getTime();
    const existingEnd = getMeetingEnd(new Date(meeting.startsAt), meeting.durationMin);
    if (start < existingEnd && end > existingStart) {
      return true;
    }
  }
  return false;
};

const saveMeetings = () => {
  mkdirSync(DATA_DIR, { recursive: true });
  const payload = Array.from(meetingsById.values());
  writeFileSync(MEETINGS_FILE, JSON.stringify(payload, null, 2), 'utf-8');
};

const loadMeetings = () => {
  if (!existsSync(MEETINGS_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(MEETINGS_FILE, 'utf-8')) as Meeting[];
    raw.forEach((meeting) => {
      if (!meeting?.id || !meeting?.startsAt) return;
      meetingsById.set(meeting.id, meeting);
    });
  } catch {
    // ignore corrupted file
  }
};

const getMeetingLobbies = (now = new Date()): LobbyInfo[] => {
  const list = Array.from(meetingsById.values())
    .filter((meeting) => {
      const start = new Date(meeting.startsAt);
      const end = getMeetingEnd(start, meeting.durationMin);
      return isSameDay(start, now) && end >= now.getTime();
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((meeting) => {
      const users = lobbyUsers.get(meeting.id) ?? [];
      return { id: meeting.id, name: meeting.title, count: users.length, capacity: 0 };
    });
  return list;
};

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

loadMeetings();

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
  const summary = getMeetingLobbies();
  for (const id of sockets.keys()) {
    sendToClient(id, { type: 'lobbies', lobbies: summary });
  }
};

const broadcastMeetings = () => {
  const meetings = Array.from(meetingsById.values()).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
  for (const id of sockets.keys()) {
    sendToClient(id, { type: 'meetings', meetings });
  }
};

const sendMeetings = (clientId: string) => {
  const meetings = Array.from(meetingsById.values()).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
  sendToClient(clientId, { type: 'meetings', meetings });
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
    sendToClient(clientId, { type: 'error', message: 'Некорректный JSON' });
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
        sendToClient(clientId, { type: 'error', message: 'Нужен deviceId' });
        return;
      }
      const existing = deviceToClient.get(deviceId);
      if (existing && existing !== clientId && sockets.has(existing)) {
        sendToClient(clientId, { type: 'error', message: 'Устройство уже подключено' });
        const ws = sockets.get(clientId);
        ws?.close(4001, 'duplicate device');
        return;
      }
      deviceToClient.set(deviceId, clientId);
      break;
    }
    case 'joinLobby': {
      const meeting = meetingsById.get(data.lobbyId);
      if (!meeting) {
        sendToClient(clientId, { type: 'error', message: 'Встреча не найдена' });
        return;
      }
      const now = new Date();
      const start = new Date(meeting.startsAt);
      const end = getMeetingEnd(start, meeting.durationMin);
      if (!isSameDay(start, now)) {
        sendToClient(clientId, { type: 'error', message: 'Встреча не запланирована на сегодня' });
        return;
      }
      if (now.getTime() < start.getTime()) {
        sendToClient(clientId, { type: 'error', message: 'Встреча еще не началась' });
        return;
      }
      if (now.getTime() > end) {
        sendToClient(clientId, { type: 'error', message: 'Встреча уже завершена' });
        return;
      }
      const lobbyId = meeting.id;
      const users = lobbyUsers.get(lobbyId) ?? [];
      // Уже в этом лобби
      if (users.find((u) => u.id === clientId)) {
        sendLobbyState(lobbyId);
        sendChatHistory(clientId, lobbyId);
        broadcastLobbies();
        return;
      }
      leaveCurrentLobby(clientId);
      const name = displayNames.get(clientId) ?? randomName();
      displayNames.set(clientId, name);
      lobbyUsers.set(lobbyId, [...users, { id: clientId, displayName: name, muted: mutedState.get(clientId) ?? false }]);
      lobbyByClient.set(clientId, lobbyId);
      broadcastLobbies();
      sendLobbyState(lobbyId);
      sendChatHistory(clientId, lobbyId);
      break;
    }
    case 'leaveLobby': {
      leaveCurrentLobby(clientId);
      break;
    }
    case 'signal': {
      const targetId = data.targetId;
      if (!targetId) {
        sendToClient(clientId, { type: 'error', message: 'Нет получателя' });
        return;
      }
      const lobbyId = lobbyByClient.get(clientId);
      if (!lobbyId || lobbyByClient.get(targetId) !== lobbyId) {
        sendToClient(clientId, { type: 'error', message: 'Не в одной встрече' });
        return;
      }
      sendToClient(targetId, { type: 'signal', from: clientId, payload: data.payload });
      if ('sdp' in (data.payload as Record<string, unknown>)) {
      } else if ('candidate' in (data.payload as Record<string, unknown>)) {
      }
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
    case 'listMeetings': {
      sendMeetings(clientId);
      break;
    }
    case 'createMeeting': {
      const meeting = data.meeting;
      const title = meeting.title?.trim();
      if (!title || title.length > 80) {
        sendToClient(clientId, { type: 'error', message: 'Некорректное название встречи' });
        return;
      }
      const duration = Number(meeting.durationMin);
      if (!Number.isFinite(duration) || duration < 0 || duration > 480) {
        sendToClient(clientId, { type: 'error', message: 'Некорректная длительность встречи' });
        return;
      }
      const start = new Date(meeting.startsAt);
      if (Number.isNaN(start.getTime())) {
        sendToClient(clientId, { type: 'error', message: 'Некорректное время встречи' });
        return;
      }
      const now = new Date();
      if (start.getTime() < now.getTime() - 60_000) {
        sendToClient(clientId, { type: 'error', message: 'Время встречи должно быть в будущем' });
        return;
      }
      if (hasMeetingConflict({ startsAt: start, durationMin: duration })) {
        sendToClient(clientId, { type: 'error', message: 'Время встречи пересекается с другой' });
        return;
      }
      const meetingId = randomUUID();
      const created: Meeting = {
        id: meetingId,
        lobbyId: meetingId,
        title,
        startsAt: start.toISOString(),
        durationMin: duration,
        createdAt: new Date().toISOString()
      };
      meetingsById.set(created.id, created);
      saveMeetings();
      broadcastMeetings();
      broadcastLobbies();
      break;
    }
    case 'updateMeeting': {
      const meeting = data.meeting;
      const existing = meetingsById.get(meeting.id);
      if (!existing) {
        sendToClient(clientId, { type: 'error', message: 'Встреча не найдена' });
        return;
      }
      const title = meeting.title?.trim();
      if (!title || title.length > 80) {
        sendToClient(clientId, { type: 'error', message: 'Некорректное название встречи' });
        return;
      }
      const duration = Number(meeting.durationMin);
      if (!Number.isFinite(duration) || duration < 0 || duration > 480) {
        sendToClient(clientId, { type: 'error', message: 'Некорректная длительность встречи' });
        return;
      }
      const start = new Date(meeting.startsAt);
      if (Number.isNaN(start.getTime())) {
        sendToClient(clientId, { type: 'error', message: 'Некорректное время встречи' });
        return;
      }
      const now = new Date();
      if (start.getTime() < now.getTime() - 60_000) {
        sendToClient(clientId, { type: 'error', message: 'Время встречи должно быть в будущем' });
        return;
      }
      if (hasMeetingConflict({ startsAt: start, durationMin: duration, excludeId: meeting.id })) {
        sendToClient(clientId, { type: 'error', message: 'Время встречи пересекается с другой' });
        return;
      }
      const updated: Meeting = {
        ...existing,
        title,
        startsAt: start.toISOString(),
        durationMin: duration
      };
      meetingsById.set(updated.id, updated);
      saveMeetings();
      broadcastMeetings();
      broadcastLobbies();
      break;
    }
    case 'deleteMeeting': {
      if (!meetingsById.has(data.id)) {
        sendToClient(clientId, { type: 'error', message: 'Встреча не найдена' });
        return;
      }
      meetingsById.delete(data.id);
      saveMeetings();
      broadcastMeetings();
      broadcastLobbies();
      break;
    }
    case 'chat': {
      const lobbyId = lobbyByClient.get(clientId);
      if (!lobbyId) break;
      const text = data.text?.trim();
      if (!text) return;
      if (text.length > 500) {
        sendToClient(clientId, { type: 'error', message: 'Сообщение слишком длинное' });
        return;
      }
      const message: ChatMessage = {
        id: randomUUID(),
        lobbyId,
        userId: clientId,
        displayName: displayNames.get(clientId) ?? 'Пользователь',
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
      sendToClient(clientId, { type: 'error', message: 'Неизвестное сообщение' });
  }
};

wss.on('connection', (socket: TrackedSocket) => {
  const clientId = randomUUID();
  sockets.set(clientId, socket);
  socket.isAlive = true;
  displayNames.set(clientId, randomName());

  sendToClient(clientId, { type: 'welcome', clientId });
  sendToClient(clientId, { type: 'lobbies', lobbies: getMeetingLobbies() });
  sendMeetings(clientId);

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => handleMessage(clientId, raw));

  socket.on('close', () => {
    leaveCurrentLobby(clientId);
    sockets.delete(clientId);
    displayNames.delete(clientId);
    for (const [device, cid] of deviceToClient.entries()) {
      if (cid === clientId) deviceToClient.delete(device);
    }
  });

  socket.on('error', () => {
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

