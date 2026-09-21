import { create } from 'zustand';

export type TourStep = 'rotate' | 'mount' | 'wire' | 'power' | 'judge';
export const TOUR_STEPS: readonly TourStep[] = ['rotate', 'mount', 'wire', 'power', 'judge'];

interface TourState {
  loaded: boolean;
  done: boolean;
  requested: boolean;
  step: TourStep | null;
  canvas: HTMLCanvasElement | null;
  initialize: (done: boolean) => void;
  setCanvas: (canvas: HTMLCanvasElement | null) => void;
  request: () => void;
  start: () => void;
  advance: (completed: TourStep) => void;
  finish: () => void;
}

/** 課題の解答とは別に持つ。開き直しても進行中の案内を別の課題へ持ち越さない。 */
export const useTourStore = create<TourState>((set, get) => ({
  loaded: false,
  done: false,
  requested: false,
  step: null,
  canvas: null,
  initialize: (done) => {
    if (!get().loaded) set({ loaded: true, done });
  },
  setCanvas: (canvas) => set({ canvas }),
  request: () => set({ requested: true, step: null }),
  start: () => set({ step: 'rotate', requested: false }),
  advance: (completed) => {
    if (get().step !== completed) return;
    const next = TOUR_STEPS[TOUR_STEPS.indexOf(completed) + 1];
    if (next !== undefined) set({ step: next });
  },
  finish: () => set({ done: true, requested: false, step: null }),
}));

/** クリック・ズームだけでは回転を終えた扱いにしない。 */
export function tourRotationChanged(
  before: readonly [number, number],
  after: readonly [number, number],
): boolean {
  return Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]) > 0.025;
}
