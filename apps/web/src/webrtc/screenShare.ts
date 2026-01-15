import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type LoggerLike = { info: (c: string, m: string, d?: unknown) => void; warn: (c: string, m: string, d?: unknown) => void };

export async function waitForScreenStream(
  peerId: string,
  screenStreamsRef: MutableRefObject<Map<string, MediaStream>>,
  logger: LoggerLike,
  timeoutMs = 3000
): Promise<MediaStream | null> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const stream = screenStreamsRef.current.get(peerId);
    if (stream) return stream;
    await new Promise((res) => setTimeout(res, 150));
  }
  logger.warn('Screen', 'waitForScreenStream timeout', { peerId, timeoutMs });
  return null;
}

type AttachOpts = {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  setOverlayPeerId: Dispatch<SetStateAction<string | null>>;
  setOverlayOpen: Dispatch<SetStateAction<boolean>>;
  setOverlayLoading: Dispatch<SetStateAction<boolean>>;
  logger: LoggerLike;
};

export function attachScreen(peerId: string, stream: MediaStream, opts: AttachOpts, attempt = 0) {
  const { videoRef, setOverlayOpen, setOverlayPeerId, setOverlayLoading, logger } = opts;
  logger.info('Screen', 'attachScreen', {
    peerId,
    streamId: stream.id,
    tracks: stream.getTracks().map((t) => ({ id: t.id, kind: t.kind, readyState: t.readyState })),
    attempt
  });

  const videoEl = videoRef.current;
  if (!videoEl) {
    if (attempt > 3) {
      logger.warn('Screen', 'attachScreen: video element not ready', { peerId });
      return;
    }
    requestAnimationFrame(() => attachScreen(peerId, stream, opts, attempt + 1));
    return;
  }

  setOverlayPeerId(peerId);
  setOverlayOpen(true);
  setOverlayLoading(true);
  videoEl.srcObject = stream;
  videoEl.muted = true;
  const onReady = () => setOverlayLoading(false);
  videoEl.onloadeddata = onReady;
  videoEl.oncanplay = onReady;
  videoEl.onplaying = onReady;
  videoEl.style.display = 'none';
  videoEl.load();
  videoEl.play().catch(() => {});
  requestAnimationFrame(() => {
    videoEl.style.display = 'block';
  });
}
