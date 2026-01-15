import type { MutableRefObject } from 'react';
import { AUDIO_CONSTRAINTS, FALLBACK_AUDIO_CONSTRAINTS } from './config';

type LoggerLike = { error: (cat: string, msg: string, data?: unknown) => void };

export async function ensureLocalAudio(
  localStreamRef: MutableRefObject<MediaStream | null>,
  logger: LoggerLike
): Promise<MediaStream> {
  if (localStreamRef.current) return localStreamRef.current;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    localStreamRef.current = stream;
    const track = stream.getAudioTracks()[0];
    if (track?.contentHint === '') track.contentHint = 'speech';
    return stream;
  } catch (err) {
    logger.error('WebRTC', 'getUserMedia failed with tuned constraints, retrying with defaults', { err });
    const stream = await navigator.mediaDevices.getUserMedia(FALLBACK_AUDIO_CONSTRAINTS);
    localStreamRef.current = stream;
    return stream;
  }
}
