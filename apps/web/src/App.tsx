import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import './App.css';
import { LobbyList } from './components/LobbyList';
import { ParticipantsGrid } from './components/ParticipantsGrid';
import { ChatPanel } from './components/ChatPanel';
import { CalendarView } from './components/CalendarView';
import { useChatStore } from './store/useChatStore';
import { ChatClient } from '@chat/shared';
import type { ChatMessage, ChatRoom, ChatRoomMessage, LobbyInfo, LobbyUser, Meeting } from '@chat/shared';
import { logger } from './utils/logger';
import { ICE_SERVERS, SCREEN_CONSTRAINTS_60 } from './webrtc/config';
import { ensureLocalAudio } from './webrtc/media';
import { createRenegotiator } from './webrtc/renegotiation';
import { attachScreen as attachScreenHelper, waitForScreenStream as waitForScreenStreamHelper } from './webrtc/screenShare';

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
const AUTH_TOKEN_KEY = 'mira_auth_token';

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatTimeLeft = (ms: number) => {
  if (ms <= 0) return 'сейчас';
  const totalMin = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours <= 0) return `${mins}м`;
  return mins === 0 ? `${hours}ч` : `${hours}ч ${mins}м`;
};

const generateFallbackId = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const getDeviceId = () => {
  const key = 'mira_device_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : generateFallbackId();
  localStorage.setItem(key, id);
  return id;
};

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
  const pendingRenegotiateRef = useRef<Map<string, boolean>>(new Map());
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<Map<string, AnalyserNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const screenReadyRef = useRef<Record<string, boolean>>({});
  const [active, setActive] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const volumesRef = useRef<Map<string, number>>(new Map());

  const [isWsReady, setIsWsReady] = useState(false);
  const [selfId, setSelfId] = useState<string>('');
  const selfIdRef = useRef<string>('');
  const [lobbies, setLobbies] = useState<LobbyInfo[]>([]);
  const [lobbyId, setLobbyId] = useState<string | undefined>();
  const [users, setUsers] = useState<LobbyUser[]>([]);
  const [chatByLobby, setChatByLobby] = useState<Record<string, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [view, setView] = useState<'calendar' | 'meetings' | 'chats'>('meetings');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [meetingModalTab, setMeetingModalTab] = useState<'schedule' | 'now'>('schedule');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [meetingTime, setMeetingTime] = useState(() => {
    const d = new Date();
    const h = `${d.getHours()}`.padStart(2, '0');
    const m = `${Math.floor(d.getMinutes() / 5) * 5}`.padStart(2, '0');
    return `${h}:${m}`;
  });
  const [meetingDurationMin, setMeetingDurationMin] = useState(30);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [selfMuted, setSelfMuted] = useState(true);
  const [selfHandRaised, setSelfHandRaised] = useState(false);
  const [screenSharerId, setScreenSharerId] = useState<string | null>(null);
  const screenSharerIdRef = useRef<string | null>(null);
  const [screenOverlayOpen, setScreenOverlayOpen] = useState(false);
  const [screenOverlayPeerId, setScreenOverlayPeerId] = useState<string | null>(null);
  const screenOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [screenOverlayLoading, setScreenOverlayLoading] = useState(false);
  const [screenReady, setScreenReady] = useState<Record<string, boolean>>({});
  const [authModalOpen, setAuthModalOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !localStorage.getItem(AUTH_TOKEN_KEY);
  });
  const [authFirstName, setAuthFirstName] = useState('');
  const [authLastName, setAuthLastName] = useState('');
  const [authError, setAuthError] = useState('');
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [activeChatRoom, setActiveChatRoom] = useState<string | null>(null);
  const [chatRoomMessages, setChatRoomMessages] = useState<Record<string, ChatRoomMessage[]>>({});
  const [chatRoomInput, setChatRoomInput] = useState('');
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);

  const deviceIdRef = useRef<string>(getDeviceId());

  const ensureLocalAudioRef = useCallback(async () => ensureLocalAudio(localStreamRef, logger), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
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
    if (screenOverlayVideoRef.current) {
      screenOverlayVideoRef.current.srcObject = null;
    }
    screenReadyRef.current = {};
    setScreenReady({});
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
    setChatByLobby({});
    setChatInput('');
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

  const attachScreen = useCallback(
    (peerId: string, stream: MediaStream) =>
      attachScreenHelper(peerId, stream, {
        videoRef: screenOverlayVideoRef,
        setOverlayOpen: setScreenOverlayOpen,
        setOverlayPeerId: setScreenOverlayPeerId,
        setOverlayLoading: setScreenOverlayLoading,
        logger
      }),
    []
  );

  const waitForScreenStream = useCallback(
    (peerId: string, timeoutMs = 3000) =>
      waitForScreenStreamHelper(peerId, screenStreamsRef, logger, timeoutMs),
    [logger]
  );

  const markScreenReady = useCallback((peerId: string) => {
    screenReadyRef.current[peerId] = true;
    setScreenReady((prev) => ({ ...prev, [peerId]: true }));
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

  const { renegotiatePeer, scheduleRenegotiate } = useMemo(
    () =>
      createRenegotiator({
        clientRef,
        makingOfferRef,
        pendingRenegotiateRef,
        logger
      }),
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

      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
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

      const local = await ensureLocalAudioRef();
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
        logger.info('WebRTC', 'ontrack', {
          peerId,
          kind: event.track.kind,
          trackId: event.track.id,
          streamId: stream.id,
          readyState: event.track.readyState
        });
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
          markScreenReady(peerId);
          const videoEl = screenOverlayVideoRef.current;
          if (videoEl && screenOverlayPeerId === peerId) {
            videoEl.srcObject = stream;
            videoEl.play().catch(() => {});
          }
          event.track.onunmute = () => {
            logger.info('WebRTC', 'video track onunmute', {
              peerId,
              trackId: event.track.id,
              readyState: event.track.readyState
            });
            markScreenReady(peerId);
            const videoEl = screenOverlayVideoRef.current;
            if (videoEl && screenOverlayPeerId === peerId) {
              videoEl.srcObject = stream;
              videoEl.play().catch(() => {});
              setScreenOverlayLoading(false);
            }
          };
          event.track.onended = () => {
            const v = screenStreamsRef.current.get(peerId);
            if (v) v.getTracks().forEach((t) => t.stop());
            screenStreamsRef.current.delete(peerId);
            setScreenReady((prev) => {
              const next = { ...prev };
              delete next[peerId];
              return next;
            });
            delete screenReadyRef.current[peerId];
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
        scheduleRenegotiate(peerId, pc);
      };

      return pc;
    },
    [cleanupPeer, ensureLocalAudioRef, scheduleRenegotiate]
  );

  const handleSignal = useCallback(
    async (from: string, payload: SignalPayload) => {
      let pc = pcsRef.current.get(from);
      if (!pc) {
        pc = await createPeerConnection(from, false);
      }
      if (!pc) return;
      const polite = selfIdRef.current < from;
      if (payload.sdp) {
        const offerCollision =
          payload.sdp.type === 'offer' && (makingOfferRef.current.get(from) || pc.signalingState !== 'stable');
        
        ignoreOfferRef.current.set(from, !polite && offerCollision);
        if (ignoreOfferRef.current.get(from)) {
          logger.warn('WebRTC', 'Ignore offer collision (impolite)', { from });
          return;
        }

        if (offerCollision && pc.signalingState !== 'stable') {
          try {
            await pc.setLocalDescription({ type: 'rollback', sdp: undefined });
          } catch (err) {
            logger.error('WebRTC', 'rollback failed', { err });
          }
        }
        
        settingRemoteAnswerRef.current.set(from, payload.sdp.type === 'answer');
        try {
          if (payload.sdp.type === 'answer' && pc.signalingState !== 'have-local-offer') {
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
            if (pc.signalingState !== 'have-remote-offer') {
              logger.warn('WebRTC', 'Signaling state changed before setLocalDescription(answer)', { state: pc.signalingState });
              return;
            }
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
      scheduleRenegotiate(peerId, pc);
    });
    clientRef.current?.sendScreenShare('stop');
    setScreenSharerId(null);
    screenSharerIdRef.current = null;
    setUsers((prev) => prev.map((u) => ({ ...u, isScreenSharer: false })));
  }, [renegotiatePeer]);

  const startScreenShare = useCallback(async () => {
    if (screenStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS_60);
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      if (track.contentHint !== 'detail') {
        track.contentHint = 'detail';
      }
      logger.info('Screen', 'local getDisplayMedia success', {
        streamId: stream.id,
        trackId: track.id,
        settings: track.getSettings ? track.getSettings() : undefined
      });
      screenStreamRef.current = stream;
      track.onended = () => {
        logger.info('Screen', 'local track ended');
        stopScreenShareInternal();
      };

      screenTransceiversRef.current.forEach((tr) => {
        const sender = tr.sender;
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings.forEach((enc) => {
          enc.maxBitrate = 8_000_000;
          enc.maxFramerate = 60;
          enc.scaleResolutionDownBy = 1;
          // пробуем многослойность, если поддерживается (VP9/AV1)
          if (!(enc as any).scalabilityMode) {
            (enc as any).scalabilityMode = 'L3T3_KEY';
          }
        });
        (params as any).degradationPreference = 'maintain-framerate';
        sender.setParameters(params).catch(() => {});
        sender.replaceTrack(track).catch(() => {});
        tr.direction = 'sendrecv';
      });
      // Гарантированная ренегоциация после подмены трека
      for (const [peerId, pc] of pcsRef.current.entries()) {
        scheduleRenegotiate(peerId, pc);
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
      await ensureLocalAudioRef().catch(() => {});
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
    [cleanupAll, ensureLocalAudioRef, ensureAudioContext, setStatus, setLocalMuteState]
  );

  const leaveLobby = useCallback(() => {
    clientRef.current?.leaveLobby();
    stopScreenShareInternal();
    setLocalMuteState(true);
    setSelfHandRaised(false);
    cleanupAll();
    setStatus('idle');
  }, [cleanupAll, setStatus, setLocalMuteState, stopScreenShareInternal]);

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    clientRef.current?.sendChat(text);
    setChatInput('');
  }, [chatInput]);

  const handleCreateMeeting = useCallback(
    (meeting: { title: string; startsAt: string; durationMin: number }) => {
      clientRef.current?.createMeeting(meeting);
    },
    []
  );

  const handleUpdateMeeting = useCallback(
    (meeting: { id: string; title: string; startsAt: string; durationMin: number }) => {
      clientRef.current?.updateMeeting(meeting);
    },
    []
  );

  const handleDeleteMeeting = useCallback((id: string) => {
    clientRef.current?.deleteMeeting(id);
  }, []);

  const handleAuthSubmit = useCallback(() => {
    const firstName = authFirstName.trim();
    const lastName = authLastName.trim();
    if (!firstName || !lastName) {
      setAuthError('Введите имя и фамилию');
      return;
    }
    setAuthError('');
    clientRef.current?.register(firstName, lastName);
  }, [authFirstName, authLastName]);

  const selectChatRoom = useCallback((roomId: string) => {
    setActiveChatRoom(roomId);
    clientRef.current?.joinChatRoom(roomId);
  }, []);

  const handleSendChatRoom = useCallback(() => {
    if (!activeChatRoom) return;
    const text = chatRoomInput.trim();
    if (!text) return;
    clientRef.current?.sendChatRoomMessage(activeChatRoom, text);
    setChatRoomInput('');
  }, [activeChatRoom, chatRoomInput]);

  const handleChatFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!activeChatRoom) return;
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        setError('Файл слишком большой (макс. 5 МБ)');
        event.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        clientRef.current?.sendChatRoomFile(activeChatRoom, {
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          dataUrl
        });
        event.target.value = '';
      };
      reader.readAsDataURL(file);
    },
    [activeChatRoom, setError]
  );

  const openCreateModal = useCallback(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    const h = `${d.getHours()}`.padStart(2, '0');
    const mm = `${Math.floor(d.getMinutes() / 5) * 5}`.padStart(2, '0');
    setEditingMeetingId(null);
    setMeetingModalTab('schedule');
    setMeetingTitle('');
    setMeetingDate(`${y}-${m}-${day}`);
    setMeetingTime(`${h}:${mm}`);
    setMeetingDurationMin(30);
    setMeetingModalOpen(true);
  }, []);

  const openEditModal = useCallback((meeting: Meeting) => {
    const start = new Date(meeting.startsAt);
    const y = start.getFullYear();
    const m = `${start.getMonth() + 1}`.padStart(2, '0');
    const day = `${start.getDate()}`.padStart(2, '0');
    const h = `${start.getHours()}`.padStart(2, '0');
    const mm = `${start.getMinutes()}`.padStart(2, '0');
    setEditingMeetingId(meeting.id);
    setMeetingTitle(meeting.title);
    setMeetingDate(`${y}-${m}-${day}`);
    setMeetingTime(`${h}:${mm}`);
    setMeetingDurationMin(meeting.durationMin);
    setMeetingModalOpen(true);
  }, []);

  const closeMeetingModal = useCallback(() => {
    setMeetingModalOpen(false);
  }, []);

  const acceptMeeting = useCallback(() => {
    const title = meetingTitle.trim();
    if (!title) return;
    if (editingMeetingId) {
      const [year, month, day] = meetingDate.split('-').map(Number);
      const [hour, minute] = meetingTime.split(':').map(Number);
      const startsAt = new Date(
        Number.isFinite(year) ? year : 0,
        Number.isFinite(month) ? month - 1 : 0,
        Number.isFinite(day) ? day : 1,
        Number.isFinite(hour) ? hour : 0,
        Number.isFinite(minute) ? minute : 0
      );
      handleUpdateMeeting({
        id: editingMeetingId,
        title,
        startsAt: startsAt.toISOString(),
        durationMin: meetingDurationMin
      });
      setEditingMeetingId(null);
      setMeetingModalOpen(false);
      return;
    }

    if (meetingModalTab === 'now') {
      handleCreateMeeting({
        title,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        durationMin: meetingDurationMin
      });
      setMeetingTitle('');
      setMeetingDurationMin(30);
      setMeetingModalOpen(false);
      return;
    }

    const [year, month, day] = meetingDate.split('-').map(Number);
    const [hour, minute] = meetingTime.split(':').map(Number);
    const startsAt = new Date(
      Number.isFinite(year) ? year : 0,
      Number.isFinite(month) ? month - 1 : 0,
      Number.isFinite(day) ? day : 1,
      Number.isFinite(hour) ? hour : 0,
      Number.isFinite(minute) ? minute : 0
    );
    handleCreateMeeting({
      title,
      startsAt: startsAt.toISOString(),
      durationMin: meetingDurationMin
    });
    setMeetingTitle('');
    setMeetingDurationMin(30);
    setMeetingModalOpen(false);
  }, [
    editingMeetingId,
    handleCreateMeeting,
    handleUpdateMeeting,
    meetingDate,
    meetingDurationMin,
    meetingModalTab,
    meetingTime,
    meetingTitle
  ]);

  const meetingMetaByLobby = useMemo(() => {
    const meta: Record<string, { label: string; disableJoin: boolean }> = {};
    for (const lobby of lobbies) {
      const todayMeetings = meetings
        .filter((meeting) => meeting.lobbyId === lobby.id)
        .filter((meeting) => isSameDay(new Date(meeting.startsAt), now))
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

      const nextMeeting = todayMeetings.find((meeting) => new Date(meeting.startsAt).getTime() > now.getTime());
      if (nextMeeting) {
        const startsAt = new Date(nextMeeting.startsAt);
        meta[lobby.id] = {
          label: `Старт через ${formatTimeLeft(startsAt.getTime() - now.getTime())}`,
          disableJoin: true
        };
        continue;
      }

      const activeMeeting = todayMeetings.find((meeting) => {
        const start = new Date(meeting.startsAt).getTime();
        const end = meeting.durationMin === 0 ? Number.POSITIVE_INFINITY : start + meeting.durationMin * 60_000;
        return now.getTime() >= start && now.getTime() <= end;
      });
      if (activeMeeting) {
        meta[lobby.id] = {
          label: 'Идёт сейчас',
          disableJoin: false
        };
      }
    }
    return meta;
  }, [lobbies, meetings, now]);

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
      logger.info('Screen', 'openScreenOverlay click', {
        peerId,
        hasStream: !!screenStreamsRef.current.get(peerId)
      });
      setScreenOverlayPeerId(peerId);
      setScreenOverlayOpen(true);
      setScreenOverlayLoading(true);
      const stream = screenStreamsRef.current.get(peerId);
      if (stream) {
        attachScreen(peerId, stream);
      } else {
        const pc = pcsRef.current.get(peerId);
        if (pc) scheduleRenegotiate(peerId, pc);
        waitForScreenStream(peerId).then((s) => {
          if (s) attachScreen(peerId, s);
          else setScreenOverlayLoading(false);
        });
      }
    },
    [attachScreen, renegotiatePeer, waitForScreenStream]
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
    const unsubMeetings = client.on('meetings', (list) => setMeetings(list));
    const unsubChatHistory = client.on('chatHistory', ({ lobbyId: lid, messages }) => {
      setChatByLobby((prev) => ({ ...prev, [lid]: messages }));
    });
    const unsubChat = client.on('chat', (message) => {
      setChatByLobby((prev) => {
        const list = prev[message.lobbyId] ?? [];
        const next = [...list, message];
        if (next.length > 200) next.splice(0, next.length - 200);
        return { ...prev, [message.lobbyId]: next };
      });
    });
    const unsubChatRooms = client.on('chatRooms', (rooms) => {
      setChatRooms(rooms);
      if (rooms.length && (!activeChatRoom || !rooms.find((r) => r.id === activeChatRoom))) {
        const first = rooms[0].id;
        setActiveChatRoom(first);
        client.joinChatRoom(first);
      }
    });
    const unsubChatRoomHistory = client.on('chatRoomHistory', ({ roomId, messages }) => {
      setChatRoomMessages((prev) => ({ ...prev, [roomId]: messages }));
    });
    const unsubChatRoomMessage = client.on('chatRoomMessage', (message) => {
      setChatRoomMessages((prev) => {
        const list = prev[message.roomId] ?? [];
        const next = [...list, message];
        if (next.length > 200) next.splice(0, next.length - 200);
        return { ...prev, [message.roomId]: next };
      });
    });
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
        logger.info('Screen', 'screenSharer stopped');
        setScreenOverlayOpen(false);
        setScreenOverlayPeerId(null);
        setScreenOverlayLoading(false);
        screenReadyRef.current = {};
        setScreenReady({});
        if (screenOverlayVideoRef.current) screenOverlayVideoRef.current.srcObject = null;
      } else if (userId !== selfIdRef.current) {
        logger.info('Screen', 'screenSharer started (remote)', { userId });
        screenReadyRef.current[userId] = false;
        setScreenReady((prev) => ({ ...prev, [userId]: false }));
        const stream = screenStreamsRef.current.get(userId);
        if (stream && screenOverlayVideoRef.current) {
          screenOverlayVideoRef.current.srcObject = stream;
          screenOverlayVideoRef.current.play().catch(() => {});
        }
        const pc = pcsRef.current.get(userId);
        const tx = screenTransceiversRef.current.get(userId);
        if (tx) tx.direction = 'recvonly';
        if (pc) scheduleRenegotiate(userId, pc);
        // не авто-открываем окно — ждём ручного клика “Смотреть”
      }
    });
    const unsubHand = client.on('hand', ({ userId, raised }) => {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, handRaised: raised } : u)));
      if (userId === selfIdRef.current) setSelfHandRaised(raised);
    });
    const unsubAuthOk = client.on('authOk', ({ token }) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
      }
      setAuthModalOpen(false);
      setAuthError('');
      client.sendDevice(deviceIdRef.current);
      client.listLobbies();
      client.listMeetings();
      client.listChatRooms();
    });
    const unsubAuthError = client.on('authError', (message) => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
      setAuthModalOpen(true);
      setAuthError(message);
    });
    const unsubOpen = client.on('open', () => {
      setIsWsReady(true);
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
      if (storedToken) {
        client.auth(storedToken);
      } else {
        setAuthModalOpen(true);
      }
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
      unsubMeetings();
      unsubChatHistory();
      unsubChat();
      unsubChatRooms();
      unsubChatRoomHistory();
      unsubChatRoomMessage();
      unsubLobbyState();
      unsubSignal();
      unsubStatus();
      unsubScreenSharer();
      unsubHand();
      unsubAuthOk();
      unsubAuthError();
      unsubOpen();
      unsubClose();
      unsubError();
      unsubLog();
      logger.setClient(null);
      client.disconnect();
    };
  }, [
    activeChatRoom,
    attachScreen,
    cleanupAll,
    cleanupPeer,
    createPeerConnection,
    ensureAudioContext,
    handleSignal,
    pushLog,
    scheduleRenegotiate,
    setError,
    setLocalMuteState,
    setStatus,
    stopScreenShareInternal
  ]);

  return (
    <div className="page audio">
      <div className="top-banner">
        <div className="logo">mettta.space</div>
        <div className="tabs">
          <button
            className={`tab ${view === 'calendar' ? 'active' : ''}`}
            onClick={() => setView('calendar')}
          >
            календарь
          </button>
          <button className={`tab ${view === 'meetings' ? 'active' : ''}`} onClick={() => setView('meetings')}>
            встречи
          </button>
          <button className={`tab ${view === 'chats' ? 'active' : ''}`} onClick={() => setView('chats')}>
            чаты
          </button>
        </div>
        <div className="header-actions">
          <button className="quick-btn" onClick={openCreateModal}>
            Создать встречу
          </button>
        </div>
      </div>
      <div className={`layout ${view === 'calendar' || view === 'chats' ? 'calendar-layout' : ''}`}>
        {view === 'calendar' && (
          <CalendarView
            meetings={meetings}
            now={now}
            onDeleteMeeting={handleDeleteMeeting}
            onEditMeeting={openEditModal}
          />
        )}
        {view === 'meetings' && (
          <>
            <LobbyList
              lobbies={lobbies}
              lobbyId={lobbyId}
              isWsReady={isWsReady}
              onJoin={joinLobby}
              onLeave={leaveLobby}
              meetingMetaByLobby={meetingMetaByLobby}
            />

            <div className="room">
              {lobbyId ? (
                <>
                  <div className="room-body">
                    <ParticipantsGrid
                      users={users}
                      selfId={selfId}
                      active={active}
                      volumes={volumes}
                      screenReady={screenReady}
                      onVolume={handleVolume}
                      onOpenScreen={openScreenOverlay}
                    />
                    <ChatPanel
                      messages={chatByLobby[lobbyId] ?? []}
                      selfId={selfId}
                      input={chatInput}
                      onInputChange={setChatInput}
                      onSend={handleSendChat}
                      disabled={!isWsReady}
                    />
                  </div>
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
                <div className="placeholder">Выберите встречу, чтобы войти</div>
              )}
            </div>
          </>
        )}
        {view === 'chats' && (
          <div className="chat-layout">
            <aside className="chat-sidebar">
              <div className="chat-sidebar-title">Чаты</div>
              <div className="chat-room-list">
                {chatRooms.map((room) => (
                  <button
                    key={room.id}
                    className={`chat-room ${activeChatRoom === room.id ? 'active' : ''}`}
                    onClick={() => selectChatRoom(room.id)}
                  >
                    {room.name}
                  </button>
                ))}
              </div>
            </aside>
            <section className="chat-panel">
              <div className="chat-panel-title">
                #{chatRooms.find((room) => room.id === activeChatRoom)?.name ?? 'чат'}
              </div>
              <div className="chat-panel-messages">
                {activeChatRoom && (chatRoomMessages[activeChatRoom]?.length ?? 0) > 0 ? (
                  chatRoomMessages[activeChatRoom]?.map((message) => (
                    <div key={message.id} className="chat-room-message">
                      <div className="chat-room-avatar" />
                      <div className="chat-room-message-body">
                        <div className="chat-room-message-meta">
                          <span className="chat-room-message-author">{message.displayName}</span>
                          <span className="chat-room-message-time">
                            {new Date(message.createdAt).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        {message.kind === 'text' ? (
                          <div className="chat-room-message-text">{message.text}</div>
                        ) : (
                          <a className="chat-room-message-file" href={message.dataUrl} download={message.fileName}>
                            {message.fileName}
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="chat-panel-empty">Пока сообщений нет</div>
                )}
              </div>
              <div className="chat-panel-input">
                <textarea
                  value={chatRoomInput}
                  onChange={(event) => setChatRoomInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSendChatRoom();
                    }
                  }}
                  placeholder={`Сообщение в #${activeChatRoom ?? 'чат'}`}
                  disabled={!activeChatRoom}
                />
                <div className="chat-input-bar">
                  <button
                    className="chat-input-btn"
                    onClick={() => chatFileInputRef.current?.click()}
                    disabled={!activeChatRoom}
                    aria-label="Прикрепить файл"
                    title="Прикрепить файл"
                    type="button"
                  >
                    +
                  </button>
                  <button
                    className="chat-input-btn send"
                    onClick={handleSendChatRoom}
                    disabled={!activeChatRoom || !chatRoomInput.trim()}
                    aria-label="Отправить"
                    title="Отправить"
                    type="button"
                  >
                    ➤
                  </button>
                </div>
                <input
                  ref={chatFileInputRef}
                  className="chat-file-input"
                  type="file"
                  onChange={handleChatFileSelect}
                />
              </div>
            </section>
          </div>
        )}
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
      {authModalOpen && (
        <div className="modal auth-modal">
          <div className="modal-backdrop" />
          <div className="modal-card">
            <div className="modal-title">Добро пожаловать</div>
            <input
              type="text"
              placeholder="Имя"
              value={authFirstName}
              onChange={(event) => setAuthFirstName(event.target.value)}
            />
            <input
              type="text"
              placeholder="Фамилия"
              value={authLastName}
              onChange={(event) => setAuthLastName(event.target.value)}
            />
            {authError && <div className="auth-error">{authError}</div>}
            <div className="modal-actions">
              <button className="primary" onClick={handleAuthSubmit} disabled={!isWsReady}>
                Продолжить
              </button>
            </div>
          </div>
        </div>
      )}
      {lastError && <div className="error">Ошибка: {lastError}</div>}
      {meetingModalOpen && (
        <div className="modal">
          <div className="modal-backdrop" onClick={closeMeetingModal} />
          <div className="modal-card">
            <div className="modal-title">{editingMeetingId ? 'Редактировать встречу' : 'Создать встречу'}</div>
            {!editingMeetingId && (
              <div className="modal-tabs">
                <button
                  className={`modal-tab ${meetingModalTab === 'schedule' ? 'active' : ''}`}
                  onClick={() => setMeetingModalTab('schedule')}
                >
                  Запланировать
                </button>
                <button
                  className={`modal-tab ${meetingModalTab === 'now' ? 'active' : ''}`}
                  onClick={() => setMeetingModalTab('now')}
                >
                  Сейчас
                </button>
              </div>
            )}
            <input
              type="text"
              placeholder="Название"
              value={meetingTitle}
              onChange={(event) => setMeetingTitle(event.target.value)}
            />
            {(editingMeetingId || meetingModalTab === 'schedule') && (
              <>
                <input
                  type="date"
                  value={meetingDate}
                  onChange={(event) => setMeetingDate(event.target.value)}
                />
                <input
                  type="time"
                  value={meetingTime}
                  step={900}
                  onChange={(event) => setMeetingTime(event.target.value)}
                />
              </>
            )}
            <select
              value={meetingDurationMin}
              onChange={(event) => setMeetingDurationMin(Number(event.target.value))}
            >
              {[15, 30, 45, 60, 90, 120].map((value) => (
                <option key={value} value={value}>
                  {value} мин
                </option>
              ))}
              <option value={0}>Без лимита</option>
            </select>
            <div className="modal-actions">
              <button className="primary" onClick={acceptMeeting} disabled={!meetingTitle.trim()}>
                Принять
              </button>
              <button className="ghost" onClick={closeMeetingModal}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

