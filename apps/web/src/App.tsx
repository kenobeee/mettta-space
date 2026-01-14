import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { LobbyList } from './components/LobbyList';
import { ParticipantsGrid } from './components/ParticipantsGrid';
import { useChatStore } from './store/useChatStore';
import { ChatClient } from '@chat/shared';
import type { LobbyInfo, LobbyUser } from '@chat/shared';
import { logger } from './utils/logger';

type SignalPayload = {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

  const DESKTOP_WS_FALLBACK = import.meta.env.VITE_DESKTOP_WS_URL ?? 'wss://mettta.space/ws';
const WS_URL =
  import.meta.env.VITE_WS_URL ??
  (window.location.protocol === 'app:'
    ? DESKTOP_WS_FALLBACK
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`);

const FORCE_RELAY = (import.meta.env.VITE_FORCE_RELAY ?? '0') === '1';

const ICE_SERVERS: RTCIceServer[] = (() => {
  const urlsEnv = (import.meta.env.VITE_TURN_URL ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string): s is string => Boolean(s));

  const defaultStun = ['stun:mettta.space:3478', 'stun:85.198.100.83:3478'];
  const defaultTurn = [
    'turn:mettta.space:3478?transport=udp',
    'turn:mettta.space:3478?transport=tcp',
    'turn:85.198.100.83:3478?transport=udp',
    'turn:85.198.100.83:3478?transport=tcp'
  ];

  const stunUrls = urlsEnv.filter((u: string) => u.startsWith('stun:'));
  const turnUrls = urlsEnv.filter((u: string) => u.startsWith('turn:'));

  const servers: RTCIceServer[] = [
    { urls: stunUrls.length ? stunUrls : defaultStun },
    {
      urls: turnUrls.length ? turnUrls : defaultTurn,
      username: import.meta.env.VITE_TURN_USERNAME ?? 'mira',
      credential: import.meta.env.VITE_TURN_PASSWORD ?? 'mira_turn_secret'
    }
  ];

  return servers;
})();

function App() {
  const { lastError, setStatus, setError, reset, pushLog } = useChatStore();

  const clientRef = useRef<ChatClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<Map<string, AnalyserNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const volumesRef = useRef<Map<string, number>>(new Map());

  const [isWsReady, setIsWsReady] = useState(false);
  const [selfId, setSelfId] = useState<string>('');
  const selfIdRef = useRef<string>('');
  const [lobbies, setLobbies] = useState<LobbyInfo[]>([]);
  const [lobbyId, setLobbyId] = useState<string | undefined>();
  const [users, setUsers] = useState<LobbyUser[]>([]);
  const isDesktopEnv = typeof window !== 'undefined' && window.location.protocol === 'app:';
  const [selfMuted, setSelfMuted] = useState(false);

  const deviceIdRef = useRef<string>((() => {
    const key = 'mira_device_id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
    return id;
  })());

  const ensureLocalAudio = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    const primaryConstraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000
      },
      video: false
    };

    const fallbackConstraints: MediaStreamConstraints = { audio: true, video: false };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (track?.contentHint === '') track.contentHint = 'speech';
      return stream;
    } catch (err) {
      logger.error('WebRTC', 'getUserMedia failed with tuned constraints, retrying with defaults', { err });
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      localStreamRef.current = stream;
      return stream;
    }
  }, []);

  const cleanupPeer = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) pc.close();
    pcsRef.current.delete(peerId);
    pendingRef.current.delete(peerId);
    const audio = remoteAudioRef.current.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
    remoteAudioRef.current.delete(peerId);
    const analyser = analyserRef.current.get(peerId);
    if (analyser) {
      analyser.disconnect();
      analyserRef.current.delete(peerId);
    }
    if (analyserRef.current.size === 0 && rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    volumesRef.current.delete(peerId);
    setVolumes((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const cleanupAll = useCallback(() => {
    for (const peerId of pcsRef.current.keys()) {
      cleanupPeer(peerId);
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    analyserRef.current.forEach((a) => a.disconnect());
    analyserRef.current.clear();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setActive(new Set());
    setUsers([]);
    setLobbyId(undefined);
    setSelfMuted(false);
    reset();
  }, [cleanupPeer, reset]);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (!rafRef.current) {
      const loop = () => {
        const next = new Set<string>();
        analyserRef.current.forEach((analyser, id) => {
          const arr = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(arr);
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            const v = (arr[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / arr.length);
          if (rms > 0.08) next.add(id);
        });
        setActive(next);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }
  }, []);

  const flushPending = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queue = pendingRef.current.get(peerId);
    if (!queue?.length) return;
    while (queue.length) {
      const cand = queue.shift();
      if (!cand) continue;
      await pc.addIceCandidate(cand).catch((err) => logger.error('WebRTC', 'Failed to add queued ICE', { err }));
    }
  }, []);

  const createPeerConnection = useCallback(
    async (peerId: string, initiator: boolean) => {
      if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!;

      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all'
      });
      pcsRef.current.set(peerId, pc);
      pendingRef.current.set(peerId, []);

      const local = await ensureLocalAudio();
      local.getTracks().forEach((t) => {
        const sender = pc.addTrack(t, local);
        if (t.kind === 'audio') {
          const params = sender.getParameters();
          params.encodings = params.encodings?.length ? params.encodings : [{}];
          params.encodings.forEach((enc) => {
            enc.maxBitrate = 128_000; // 128 kbps для голоса
          });
          sender.setParameters(params).catch(() => {});
        }
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          clientRef.current?.sendSignalTo(peerId, { candidate: event.candidate });
        }
      };

      pc.onicecandidateerror = (event) => {
        logger.error('WebRTC', 'ICE candidate error', {
          errorCode: (event as any).errorCode,
          errorText: (event as any).errorText,
          url: (event as any).url
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          cleanupPeer(peerId);
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        let audio = remoteAudioRef.current.get(peerId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          // @ts-expect-error playsInline not in typings
          audio.playsInline = true;
          remoteAudioRef.current.set(peerId, audio);
        }
        const vol = volumesRef.current.get(peerId) ?? 1;
        volumesRef.current.set(peerId, vol);
        audio.volume = vol;
        audio.srcObject = stream;
        audio.play().catch(() => {});
        ensureAudioContext();
        const ctx = audioCtxRef.current;
        if (ctx) {
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current.set(peerId, analyser);
        }
      };

      if (initiator) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
        await pc.setLocalDescription(offer);
        clientRef.current?.sendSignalTo(peerId, { sdp: pc.localDescription });
      }

      return pc;
    },
    [cleanupPeer, ensureLocalAudio]
  );

  const handleSignal = useCallback(
    async (from: string, payload: SignalPayload) => {
      let pc = pcsRef.current.get(from);
      if (!pc) {
        pc = await createPeerConnection(from, false);
      }
      if (!pc) return;
      if (payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushPending(from, pc);
        if (payload.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          clientRef.current?.sendSignalTo(from, { sdp: pc.localDescription });
        }
        return;
      }
      if (payload.candidate) {
        if (!pc.remoteDescription) {
          const list = pendingRef.current.get(from) ?? [];
          list.push(payload.candidate);
          pendingRef.current.set(from, list);
          return;
        }
        await pc.addIceCandidate(payload.candidate).catch((err) =>
          logger.error('WebRTC', 'Failed to add ICE', { err })
        );
      }
    },
    [createPeerConnection, flushPending]
  );


  const joinLobby = useCallback(
    async (id: string) => {
      if (!clientRef.current) return;
      cleanupAll();
      await ensureLocalAudio().catch(() => {});
      ensureAudioContext();
      const me = selfIdRef.current;
      if (me && localStreamRef.current && audioCtxRef.current && !analyserRef.current.has(me)) {
        const source = audioCtxRef.current.createMediaStreamSource(localStreamRef.current);
        const analyser = audioCtxRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current.set(me, analyser);
        ensureAudioContext();
      }
      setLobbyId(id);
      setStatus('in-lobby');
      clientRef.current.joinLobby(id);
    },
    [cleanupAll, ensureLocalAudio, ensureAudioContext, setStatus]
  );

  const leaveLobby = useCallback(() => {
    clientRef.current?.leaveLobby();
    cleanupAll();
    setStatus('idle');
  }, [cleanupAll, setStatus]);

  const handleVolume = useCallback(
    (peerId: string, value: number) => {
      volumesRef.current.set(peerId, value);
      setVolumes((prev) => ({ ...prev, [peerId]: value }));
      const audio = remoteAudioRef.current.get(peerId);
      if (audio) audio.volume = value;
    },
    []
  );

  const toggleMute = useCallback(() => {
    const next = !selfMuted;
    setSelfMuted(next);
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    }
    clientRef.current?.sendStatus(next);
    setUsers((prev) => prev.map((u) => (u.id === selfIdRef.current ? { ...u, muted: next } : u)));
  }, [selfMuted]);

  useEffect(() => {
    const client = new ChatClient(WS_URL);
    clientRef.current = client;
    logger.setClient(client);
    client.connect();

    const unsubWelcome = client.on('welcome', ({ clientId }) => {
      selfIdRef.current = clientId;
      setSelfId(clientId);
    });
    const unsubLobbies = client.on('lobbies', (list) => setLobbies(list));
    const unsubLobbyState = client.on('lobbyState', async ({ lobbyId: lid, users: us }) => {
      setLobbyId(lid);
      setUsers(us);
      const meId = selfIdRef.current;
      if (!meId) return;
      const me = us.find((u) => u.id === meId);
      setSelfMuted(!!me?.muted);
      if (localStreamRef.current) {
        ensureAudioContext();
      }
      setVolumes((prev) => {
        const next = { ...prev };
        us.forEach((u) => {
          if (next[u.id] === undefined) next[u.id] = 1;
        });
        Object.keys(next).forEach((k) => {
          if (!us.find((u) => u.id === k)) delete next[k];
        });
        return next;
      });
      if (localStreamRef.current && audioCtxRef.current && !analyserRef.current.has(meId)) {
        const analyser = audioCtxRef.current.createAnalyser();
        analyser.fftSize = 256;
        audioCtxRef.current.createMediaStreamSource(localStreamRef.current).connect(analyser);
        analyserRef.current.set(meId, analyser);
        ensureAudioContext();
      }
      for (const u of us) {
        if (u.id === meId) continue;
        if (!pcsRef.current.has(u.id) && meId < u.id) {
          await createPeerConnection(u.id, true);
        }
      }
      for (const peerId of Array.from(pcsRef.current.keys())) {
        if (!us.find((u) => u.id === peerId)) {
          cleanupPeer(peerId);
        }
      }
    });
    const unsubSignal = client.on('signal', async ({ from, payload }) => {
      await handleSignal(from, payload as SignalPayload);
    });
    const unsubStatus = client.on('userStatus', ({ userId, muted }) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, muted } : u)));
      if (userId === selfIdRef.current) setSelfMuted(muted);
    });
    const unsubOpen = client.on('open', () => {
      setIsWsReady(true);
      client.sendDevice(deviceIdRef.current);
      client.listLobbies();
    });
    const unsubClose = client.on('close', () => {
      setIsWsReady(false);
      cleanupAll();
    });
    const unsubError = client.on('error', (msg) => setError(msg));
    const unsubLog = client.on('log', (msg) => pushLog(msg));

    return () => {
      unsubWelcome();
      unsubLobbies();
      unsubLobbyState();
      unsubSignal();
      unsubStatus();
      unsubOpen();
      unsubClose();
      unsubError();
      unsubLog();
      logger.setClient(null);
      client.disconnect();
    };
  }, [cleanupAll, cleanupPeer, createPeerConnection, handleSignal, pushLog, setError, setStatus]);

  return (
    <div className="page audio">
      {!isDesktopEnv && (
        <div className="top-banner">
          <div className="logo">mettta.space</div>
          <div className="downloads">
            <a href="https://mettta.space/downloads/metttaspace-mac.dmg" className="dl-btn" download>
              macOS
            </a>
            <a href="https://mettta.space/downloads/metttaspace-linux.AppImage" className="dl-btn" download>
              Linux
            </a>
          </div>
        </div>
      )}
      <div className="layout">
        <LobbyList lobbies={lobbies} lobbyId={lobbyId} isWsReady={isWsReady} onJoin={joinLobby} onLeave={leaveLobby} />

        <div className="room">
          {lobbyId ? (
            <>
              <ParticipantsGrid
                users={users}
                selfId={selfId}
                active={active}
                volumes={volumes}
              onVolume={handleVolume}
              />
              <div className="room-controls">
                <div className="control-pill">
                  <button
                    className="pill-btn"
                    onClick={toggleMute}
                    aria-label={selfMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                  >
                    <span className={`pill-icon ${selfMuted ? 'muted' : ''}`}>{selfMuted ? '🔇' : '🎤'}</span>
                  </button>
                  <button className="pill-btn" aria-label="Демонстрация экрана">
                    <span className="pill-icon">🖥️</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="placeholder">Select a lobby to join</div>
          )}
        </div>
      </div>
      {lastError && <div className="error">Error: {lastError}</div>}
      </div>
  );
}

export default App;

