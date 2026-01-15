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

  const defaultStun = ['stun:mettta.space:3478'];
  const defaultTurn = ['turn:mettta.space:3478?transport=udp'];

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
  const screenTransceiversRef = useRef<Map<string, RTCRtpTransceiver>>(new Map());
  const screenStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferRef = useRef<Map<string, boolean>>(new Map());
  const settingRemoteAnswerRef = useRef<Map<string, boolean>>(new Map());
  const pendingRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<Map<string, AnalyserNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const overlayIntentRef = useRef<string | null>(null);
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
  const [selfMuted, setSelfMuted] = useState(true);
  const [selfHandRaised, setSelfHandRaised] = useState(false);
  const [screenSharerId, setScreenSharerId] = useState<string | null>(null);
  const screenSharerIdRef = useRef<string | null>(null);
  const [screenOverlayOpen, setScreenOverlayOpen] = useState(false);
  const [screenOverlayPeerId, setScreenOverlayPeerId] = useState<string | null>(null);
  const screenOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [screenOverlayLoading, setScreenOverlayLoading] = useState(false);

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
    screenTransceiversRef.current.delete(peerId);
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
    if (screenSharerIdRef.current === selfIdRef.current) {
      clientRef.current?.sendScreenShare('stop');
    }
    screenTransceiversRef.current.clear();
    screenStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    screenStreamsRef.current.clear();
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenSharerId(null);
    screenSharerIdRef.current = null;
    setScreenOverlayOpen(false);
    setScreenOverlayPeerId(null);
    setScreenOverlayLoading(false);
    overlayIntentRef.current = null;
    if (screenOverlayVideoRef.current) {
      screenOverlayVideoRef.current.srcObject = null;
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
    setSelfMuted(true);
    setSelfHandRaised(false);
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

  const attachScreen = useCallback((peerId: string, stream: MediaStream) => {
    setScreenOverlayPeerId(peerId);
    setScreenOverlayOpen(true);
    setScreenOverlayLoading(true);
    const videoEl = screenOverlayVideoRef.current;
    if (videoEl) {
      videoEl.srcObject = stream;
      videoEl.muted = true;
      const onReady = () => setScreenOverlayLoading(false);
      videoEl.onloadeddata = onReady;
      videoEl.onplaying = onReady;
      videoEl.play().catch(() => {});
    }
    overlayIntentRef.current = null;
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

  const renegotiatePeer = useCallback(
    async (peerId: string, pc: RTCPeerConnection) => {
      if (makingOfferRef.current.get(peerId)) return;
      makingOfferRef.current.set(peerId, true);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        clientRef.current?.sendSignalTo(peerId, { sdp: pc.localDescription });
      } catch (err) {
        logger.error('WebRTC', 'Renegotiation failed', { peerId, err });
      } finally {
        makingOfferRef.current.set(peerId, false);
      }
    },
    []
  );

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

      const videoTransceiver = pc.addTransceiver('video', { direction: 'recvonly' });
      // Prefer VP8 for compatibility (Windows/Safari) and screen content
      const capabilities = RTCRtpSender.getCapabilities('video');
      if (capabilities?.codecs) {
        const vp8First = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp8');
        const rest = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/vp8');
        const prefs = vp8First.concat(rest);
        try {
          videoTransceiver.setCodecPreferences(prefs);
        } catch {
          // ignore if not supported
        }
      }
      screenTransceiversRef.current.set(peerId, videoTransceiver);
      if (screenStreamRef.current) {
        const track = screenStreamRef.current.getVideoTracks()[0];
        if (track) {
          videoTransceiver.sender.replaceTrack(track).catch(() => {});
          videoTransceiver.direction = 'sendrecv';
        }
      }

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
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === 'audio') {
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
        }

        if (event.track.kind === 'video') {
          screenStreamsRef.current.set(peerId, stream);
          const currentSharer = screenSharerIdRef.current;
          const wanted = overlayIntentRef.current ?? currentSharer;
          const videoEl = screenOverlayVideoRef.current;
          if (videoEl && screenOverlayPeerId === peerId) {
            videoEl.srcObject = stream;
            videoEl.play().catch(() => {});
          }
          if (wanted === peerId) {
            attachScreen(peerId, stream);
          }
          event.track.onunmute = () => {
            const videoEl = screenOverlayVideoRef.current;
            if (videoEl && screenOverlayPeerId === peerId) {
              videoEl.srcObject = stream;
              videoEl.play().catch(() => {});
              setScreenOverlayLoading(false);
            } else if (overlayIntentRef.current === peerId) {
              attachScreen(peerId, stream);
            }
          };
          event.track.onended = () => {
            const v = screenStreamsRef.current.get(peerId);
            if (v) v.getTracks().forEach((t) => t.stop());
            screenStreamsRef.current.delete(peerId);
            if (screenOverlayPeerId === peerId) {
              setScreenOverlayOpen(false);
              setScreenOverlayPeerId(null);
              if (screenOverlayVideoRef.current) screenOverlayVideoRef.current.srcObject = null;
            }
          };
        }
      };

      if (initiator) {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        clientRef.current?.sendSignalTo(peerId, { sdp: pc.localDescription });
      }

      pc.onnegotiationneeded = async () => {
        await renegotiatePeer(peerId, pc);
      };

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
        const offerCollision =
          payload.sdp.type === 'offer' && (makingOfferRef.current.get(from) || pc.signalingState !== 'stable');
        if (offerCollision && pc.signalingState !== 'stable') {
          try {
            await pc.setLocalDescription({ type: 'rollback', sdp: undefined });
          } catch (err) {
            logger.error('WebRTC', 'rollback failed', { err });
          }
        }
        ignoreOfferRef.current.set(from, false);
        settingRemoteAnswerRef.current.set(from, payload.sdp.type === 'answer');
        try {
          if (payload.sdp.type === 'answer' && pc.signalingState !== 'have-local-offer') {
            // Ответ пришёл, но локального оффера нет — игнор, чтобы не словить InvalidState
            settingRemoteAnswerRef.current.set(from, false);
            return;
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } catch (err) {
          logger.error('WebRTC', 'setRemoteDescription failed', { err });
          settingRemoteAnswerRef.current.set(from, false);
          return;
        }
        settingRemoteAnswerRef.current.set(from, false);
        await flushPending(from, pc);
        if (payload.sdp.type === 'offer') {
          try {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            clientRef.current?.sendSignalTo(from, { sdp: pc.localDescription });
          } catch (err) {
            logger.error('WebRTC', 'createAnswer/setLocalDescription failed', { err });
          }
        }
        return;
      }
      if (payload.candidate) {
        if (ignoreOfferRef.current.get(from)) return;
        if (!pc.remoteDescription || settingRemoteAnswerRef.current.get(from)) {
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


  const setLocalMuteState = useCallback(
    (mute: boolean) => {
      setSelfMuted(mute);
      const stream = localStreamRef.current;
      if (stream) {
        stream.getAudioTracks().forEach((t) => (t.enabled = !mute));
      }
      clientRef.current?.sendStatus(mute);
      setUsers((prev) => prev.map((u) => (u.id === selfIdRef.current ? { ...u, muted: mute } : u)));
    },
    []
  );

  const toggleMute = useCallback(() => {
    setLocalMuteState(!selfMuted);
  }, [selfMuted, setLocalMuteState]);

  const stopScreenShareInternal = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    screenTransceiversRef.current.forEach((tr) => {
      tr.sender.replaceTrack(null).catch(() => {});
      tr.direction = 'recvonly';
    });
    pcsRef.current.forEach((pc, peerId) => {
      renegotiatePeer(peerId, pc);
    });
    clientRef.current?.sendScreenShare('stop');
    setScreenSharerId(null);
    screenSharerIdRef.current = null;
    setUsers((prev) => prev.map((u) => ({ ...u, isScreenSharer: false })));
  }, [renegotiatePeer]);

  const startScreenShare = useCallback(async () => {
    if (screenStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      if (track.contentHint !== 'detail') {
        track.contentHint = 'detail';
      }
      screenStreamRef.current = stream;
      track.onended = () => {
        stopScreenShareInternal();
      };

      screenTransceiversRef.current.forEach((tr) => {
        const sender = tr.sender;
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings.forEach((enc) => {
          enc.maxBitrate = 4_000_000;
          enc.scaleResolutionDownBy = 1;
        });
        sender.setParameters(params).catch(() => {});
        sender.replaceTrack(track).catch(() => {});
        tr.direction = 'sendrecv';
      });
      // Гарантированная ренегоциация после подмены трека
      for (const [peerId, pc] of pcsRef.current.entries()) {
        await renegotiatePeer(peerId, pc);
      }

      clientRef.current?.sendScreenShare('start');
      setScreenSharerId(selfIdRef.current);
      screenSharerIdRef.current = selfIdRef.current;
      setUsers((prev) => prev.map((u) => (u.id === selfIdRef.current ? { ...u, isScreenSharer: true } : u)));
    } catch (err) {
      logger.error('Screen', 'getDisplayMedia failed', { err });
    }
  }, [renegotiatePeer, stopScreenShareInternal]);

  const toggleScreenShare = useCallback(() => {
    if (screenSharerIdRef.current === selfIdRef.current && screenStreamRef.current) {
      stopScreenShareInternal();
    } else {
      startScreenShare();
    }
  }, [selfIdRef.current, startScreenShare, stopScreenShareInternal]);

  const toggleHand = useCallback(() => {
    const next = !selfHandRaised;
    setSelfHandRaised(next);
    clientRef.current?.sendHand(next);
    setUsers((prev) => prev.map((u) => (u.id === selfIdRef.current ? { ...u, handRaised: next } : u)));
  }, [selfHandRaised]);

  const joinLobby = useCallback(
    async (id: string) => {
      if (!clientRef.current) return;
      cleanupAll();
      await ensureLocalAudio().catch(() => {});
      ensureAudioContext();
      setLocalMuteState(true);
      setSelfHandRaised(false);
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
    [cleanupAll, ensureLocalAudio, ensureAudioContext, setStatus, setLocalMuteState]
  );

  const leaveLobby = useCallback(() => {
    clientRef.current?.leaveLobby();
    stopScreenShareInternal();
    setLocalMuteState(true);
    setSelfHandRaised(false);
    cleanupAll();
    setStatus('idle');
  }, [cleanupAll, setStatus, setLocalMuteState, stopScreenShareInternal]);

  const handleVolume = useCallback(
    (peerId: string, value: number) => {
      volumesRef.current.set(peerId, value);
      setVolumes((prev) => ({ ...prev, [peerId]: value }));
      const audio = remoteAudioRef.current.get(peerId);
      if (audio) audio.volume = value;
    },
    []
  );

  const openScreenOverlay = useCallback(
    (peerId: string) => {
      overlayIntentRef.current = peerId;
      setScreenOverlayPeerId(peerId);
      setScreenOverlayOpen(true);
      setScreenOverlayLoading(true);
      const stream = screenStreamsRef.current.get(peerId);
      if (stream) {
        attachScreen(peerId, stream);
      } else {
        const pc = pcsRef.current.get(peerId);
        if (pc) renegotiatePeer(peerId, pc);
      }
    },
    [attachScreen, renegotiatePeer]
  );

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
      const sharer = us.find((u) => u.isScreenSharer)?.id ?? null;
      setScreenSharerId(sharer);
      screenSharerIdRef.current = sharer;
      const meId = selfIdRef.current;
      if (!meId) return;
      const me = us.find((u) => u.id === meId);
      setSelfMuted(!!me?.muted);
      setSelfHandRaised(!!me?.handRaised);
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
    const unsubScreenSharer = client.on('screenSharer', ({ userId }) => {
      screenSharerIdRef.current = userId;
      setScreenSharerId(userId);
      setUsers((prev) => prev.map((u) => ({ ...u, isScreenSharer: u.id === userId })));
      if (userId === null) {
        setScreenOverlayOpen(false);
        setScreenOverlayPeerId(null);
        setScreenOverlayLoading(false);
        overlayIntentRef.current = null;
        if (screenOverlayVideoRef.current) screenOverlayVideoRef.current.srcObject = null;
      } else if (userId !== selfIdRef.current) {
        overlayIntentRef.current = userId;
        const stream = screenStreamsRef.current.get(userId);
        if (stream && screenOverlayVideoRef.current) {
          screenOverlayVideoRef.current.srcObject = stream;
        }
        // не авто-открываем окно — ждём ручного клика “Смотреть”
      }
    });
    const unsubHand = client.on('hand', ({ userId, raised }) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, handRaised: raised } : u)));
      if (userId === selfIdRef.current) setSelfHandRaised(raised);
    });
    const unsubOpen = client.on('open', () => {
      setIsWsReady(true);
      client.sendDevice(deviceIdRef.current);
      client.listLobbies();
    });
    const unsubClose = client.on('close', () => {
      setIsWsReady(false);
      stopScreenShareInternal();
      setLocalMuteState(true);
      setSelfHandRaised(false);
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
      unsubScreenSharer();
      unsubHand();
      unsubOpen();
      unsubClose();
      unsubError();
      unsubLog();
      logger.setClient(null);
      client.disconnect();
    };
  }, [cleanupAll, cleanupPeer, createPeerConnection, handleSignal, pushLog, setError, setStatus, attachScreen, renegotiatePeer]);

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
                onOpenScreen={openScreenOverlay}
              />
              <div className="room-controls">
                <div className="control-pill">
                  <button
                    className={`pill-btn ${selfMuted ? 'off' : 'on'}`}
                    onClick={toggleMute}
                    aria-label={selfMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                  >
                    <span className="pill-icon">🎤</span>
                  </button>
                  <button
                  className={`pill-btn ${screenSharerId === selfId ? 'on' : 'off'}`}
                    aria-label="Демонстрация экрана"
                    onClick={toggleScreenShare}
                    title={screenSharerId === selfId ? 'Остановить демонстрацию' : 'Начать демонстрацию'}
                  disabled={screenSharerId !== null && screenSharerId !== selfId}
                  >
                    <span className="pill-icon">🖥️</span>
                  </button>
                  <button
                    className={`pill-btn ${selfHandRaised ? 'on' : 'off'}`}
                    aria-label={selfHandRaised ? 'Опустить руку' : 'Поднять руку'}
                    onClick={toggleHand}
                  >
                    <span className="pill-icon">✋</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="placeholder">Select a lobby to join</div>
          )}
        </div>
      </div>
      {screenOverlayPeerId && (
        <div className={`screen-overlay ${screenOverlayOpen ? 'open' : 'hidden'}`}>
          <div className="screen-overlay-bar">
            <span>Демонстрация: {users.find((u) => u.id === screenOverlayPeerId)?.displayName ?? 'экран'}</span>
            <button
              className="screen-overlay-close"
              onClick={() => {
                setScreenOverlayOpen(false);
                setScreenOverlayLoading(false);
                overlayIntentRef.current = null;
                if (screenOverlayVideoRef.current) screenOverlayVideoRef.current.srcObject = null;
              }}
            >
              Закрыть
        </button>
          </div>
          {screenOverlayLoading && <div className="loading">Загрузка экрана...</div>}
          <video ref={screenOverlayVideoRef} autoPlay playsInline muted />
        </div>
      )}
      {lastError && <div className="error">Error: {lastError}</div>}
      </div>
  );
}

export default App;

