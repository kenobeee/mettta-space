import { create } from 'zustand';
import type { ChatStatus } from '@chat/shared';

type ChatState = {
  status: ChatStatus;
  partnerId?: string;
  log: string[];
  lastError?: string;
  setStatus: (status: ChatStatus) => void;
  setPartnerId: (partnerId?: string) => void;
  pushLog: (entry: string) => void;
  setError: (error: string) => void;
  reset: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  status: 'idle',
  partnerId: undefined,
  log: [],
  lastError: undefined,
  setStatus: (status) => set({ status }),
  setPartnerId: (partnerId) => set({ partnerId }),
  pushLog: (entry) =>
    set((state) => ({
      log: [...state.log.slice(-18), entry]
    })),
  setError: (error) =>
    set({
      status: 'error',
      lastError: error
    }),
  reset: () =>
    set({
      status: 'idle',
      partnerId: undefined,
      log: [],
      lastError: undefined
    })
}));

