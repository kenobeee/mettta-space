import type { MutableRefObject } from 'react';
import type { ChatClient } from '@chat/shared';

type LoggerLike = {
  warn: (cat: string, msg: string, data?: unknown) => void;
  error: (cat: string, msg: string, data?: unknown) => void;
};

export const waitForStable = (
  pc: RTCPeerConnection,
  peerId: string,
  logger: LoggerLike,
  timeoutMs = 2000
): Promise<boolean> => {
  if (pc.signalingState === 'stable') return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const onChange = () => {
      if (done) return;
      if (pc.signalingState === 'stable') {
        done = true;
        pc.removeEventListener('signalingstatechange', onChange);
        resolve(true);
      } else if (pc.signalingState === 'closed') {
        done = true;
        pc.removeEventListener('signalingstatechange', onChange);
        resolve(false);
      }
    };
    pc.addEventListener('signalingstatechange', onChange);
    setTimeout(() => {
      if (done) return;
      done = true;
      pc.removeEventListener('signalingstatechange', onChange);
      logger.warn('WebRTC', 'waitForStable timeout', { peerId, state: pc.signalingState });
      resolve(pc.signalingState === 'stable');
    }, timeoutMs);
  });
};

type RenegotiatorDeps = {
  clientRef: MutableRefObject<ChatClient | null>;
  makingOfferRef: MutableRefObject<Map<string, boolean>>;
  pendingRenegotiateRef: MutableRefObject<Map<string, boolean>>;
  logger: LoggerLike;
};

export const createRenegotiator = ({
  clientRef,
  makingOfferRef,
  pendingRenegotiateRef,
  logger
}: RenegotiatorDeps) => {
  const renegotiatePeer = async (peerId: string, pc: RTCPeerConnection) => {
    if (makingOfferRef.current.get(peerId)) return;
    makingOfferRef.current.set(peerId, true);
    try {
      const stable = await waitForStable(pc, peerId, logger);
      if (!stable || pc.signalingState !== 'stable') {
        logger.warn('WebRTC', 'Skip renegotiation: signaling not stable', {
          peerId,
          state: pc.signalingState
        });
        scheduleRenegotiate(peerId, pc);
        return;
      }
      await pc.setLocalDescription(await pc.createOffer());
      clientRef.current?.sendSignalTo(peerId, { sdp: pc.localDescription });
    } catch (err) {
      logger.error('WebRTC', 'Renegotiation failed', { peerId, err });
      if ((err as any)?.name === 'InvalidStateError' || pc.signalingState !== 'stable') {
        scheduleRenegotiate(peerId, pc);
      }
    } finally {
      makingOfferRef.current.set(peerId, false);
    }
  };

  const scheduleRenegotiate = (peerId: string, pc: RTCPeerConnection) => {
    if (pc.signalingState === 'closed') return;
    if (pendingRenegotiateRef.current.get(peerId)) {
      return;
    }
    pendingRenegotiateRef.current.set(peerId, true);
    const run = async () => {
      pendingRenegotiateRef.current.delete(peerId);
      if (pc.signalingState === 'closed') return;
      await renegotiatePeer(peerId, pc);
    };
    if (pc.signalingState === 'stable') {
      run();
    } else {
      const handler = () => {
        if (pc.signalingState === 'stable' || pc.signalingState === 'closed') {
          pc.removeEventListener('signalingstatechange', handler);
          run();
        }
      };
      pc.addEventListener('signalingstatechange', handler);
      setTimeout(() => {
        if (pc.signalingState === 'stable' && pendingRenegotiateRef.current.get(peerId)) {
          pc.removeEventListener('signalingstatechange', handler);
          run();
        }
      }, 1500);
    }
  };

  return { renegotiatePeer, scheduleRenegotiate };
};
