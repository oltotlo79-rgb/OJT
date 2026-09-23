import { create } from 'zustand';
import type { Difficulty, ProblemTag } from '@ojt/content';
import type { ListMode } from '../app/store.js';
import type { GradeFilter } from './problem-filter.js';

interface Filters {
  gradePick: { grade: GradeFilter } | undefined;
  difficulty: Difficulty | undefined;
  tag: ProblemTag | undefined;
  search: string;
}
export const DEFAULT_PROBLEM_FILTERS: Filters = {
  gradePick: undefined,
  difficulty: undefined,
  tag: undefined,
  search: '',
};
/** Keep each list's filters during this launch, including a round trip through a task. */
export const useProblemFilters = create<{ modes: Partial<Record<string, Filters>> }>(() => ({
  modes: {},
}));
export function changeProblemFilters(mode: ListMode, patch: Partial<Filters>): void {
  const key = mode ?? 'all';
  useProblemFilters.setState((state) => ({
    modes: {
      ...state.modes,
      [key]: { ...(state.modes[key] ?? DEFAULT_PROBLEM_FILTERS), ...patch },
    },
  }));
}
