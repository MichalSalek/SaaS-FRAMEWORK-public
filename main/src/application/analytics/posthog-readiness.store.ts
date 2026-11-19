import { create } from 'zustand';

interface PostHogReadinessState {
  isReady: boolean;
  identifiedUserId: string | null;
  markReady: () => void;
  markIdentified: (userId: string) => void;
  clearIdentified: () => void;
}

export const usePostHogReadinessStore = create<PostHogReadinessState>(set => ({
  isReady: false,
  identifiedUserId: null,
  markReady: () => set({ isReady: true }),
  markIdentified: userId => set({ identifiedUserId: userId }),
  clearIdentified: () => set({ identifiedUserId: null }),
}));
