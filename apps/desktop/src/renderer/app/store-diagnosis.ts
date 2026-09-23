import type { StateCreator } from 'zustand';
import {
  MEASUREMENT_LIMIT,
  type MeasurementRecord,
  type DiagnosisNote,
} from '../../shared/diagnosis.js';
import type { AppState } from './store.js';

export interface DiagnosisSlice {
  measurements: readonly MeasurementRecord[];
  diagnosisNotes: readonly DiagnosisNote[];
  recordMeasurement: (note: string) => boolean;
  removeMeasurement: (id: string) => void;
  setDiagnosisNotes: (notes: readonly DiagnosisNote[]) => void;
}

export const createDiagnosisSlice: StateCreator<AppState, [], [], DiagnosisSlice> = (set, get) => ({
  measurements: [],
  diagnosisNotes: [],
  recordMeasurement: (note) => {
    const state = get(),
      tester = state.tester,
      reading = state.snapshot.tester;
    if (
      state.replay !== undefined ||
      state.measurements.length >= MEASUREMENT_LIMIT ||
      tester.black === undefined ||
      tester.red === undefined ||
      tester.mode === 'off' ||
      tester.mode === 'ACV' ||
      reading.mode !== tester.mode ||
      reading.live ||
      ['OFF', '----', '−−−'].includes(reading.display)
    )
      return false;
    if (
      reading.black !== tester.black ||
      reading.red !== tester.red ||
      reading.kind !== tester.kind ||
      reading.voltRange !== tester.voltRange ||
      reading.ohmRange !== tester.ohmRange
    )
      return false;
    const record: MeasurementRecord = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      tMs: state.snapshot.tMs,
      mode: tester.mode,
      kind: tester.kind,
      black: tester.black,
      red: tester.red,
      range: tester.mode === 'DCV' ? tester.voltRange : tester.ohmRange,
      value: Number.isFinite(reading.value) ? reading.value : null,
      display: reading.display,
      powered: state.snapshot.powered,
      note: note.slice(0, 1000),
      ...(state.checkPartId === undefined ? {} : { partId: state.checkPartId }),
    };
    set({ measurements: [...state.measurements, record] });
    return true;
  },
  removeMeasurement: (id) =>
    set((state) => ({
      measurements: state.measurements.filter((record) => record.id !== id),
      diagnosisNotes: state.diagnosisNotes.map((note) => ({
        ...note,
        measurementIds: note.measurementIds.filter((value) => value !== id),
      })),
    })),
  setDiagnosisNotes: (notes) => set({ diagnosisNotes: notes.slice(0, MEASUREMENT_LIMIT) }),
});
