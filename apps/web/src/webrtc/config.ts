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

export const SCREEN_CONSTRAINTS_60 = {
  video: {
    frameRate: { ideal: 60, max: 60 },
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 }
  },
  audio: false as const
};

export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000
  },
  video: false
};

export const FALLBACK_AUDIO_CONSTRAINTS: MediaStreamConstraints = { audio: true, video: false };

export { ICE_SERVERS };
