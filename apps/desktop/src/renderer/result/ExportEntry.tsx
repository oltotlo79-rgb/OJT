import { JIPM_BOARD } from '@ojt/board-model';
import { wiringSuspects } from '@ojt/content';
import { useRef, useState, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { errnoText, saveFailedText } from '../../shared/messages.js';
import { JA } from '../i18n/ja.js';
import { resultReportHtml } from './report-html.js';

export function ExportEntry(): JSX.Element | null {
  const judge = useStore((state) => state.judge);
  const problem = useStore((state) => state.problem);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (judge === undefined || problem === undefined || judge.mode !== problem.mode) return null;
  const save = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const state = useStore.getState();
      const suspects =
        problem.mode === 'assemble' && !judge.passed && state.session !== undefined
          ? wiringSuspects(problem, JIPM_BOARD, state.session)
          : undefined;
      const html = resultReportHtml({
        measurements: state.measurements,
        diagnosisNotes: state.diagnosisNotes,
        problem,
        result: judge,
        sessionOpenedAtMs: state.sessionOpenedAtMs,
        restoredHazardCount: state.restoredHazardCount,
        hintStage: state.hintStage,
        schematicOpenCount: state.schematicOpenCount,
        ...(suspects === undefined
          ? {}
          : { suspects: suspects.suspects, suspectTotal: suspects.total }),
      });
      // IDも利用者課題由来。ファイル名は安全なASCIIだけに限定する。
      const id = problem.id.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
      const result = await ojtApi().exportResult({ html, suggestedName: `OJT-${id}-result.pdf` });
      if (!result.ok) state.toast(result.message, 'error');
      else if (!result.canceled) state.toast(JA.report.saved, 'info');
    } catch (cause) {
      useStore.getState().toast(saveFailedText(errnoText(cause)), 'error');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      data-testid="result-export"
      disabled={busy}
      aria-busy={busy}
      onClick={() => {
        void save();
      }}
    >
      {busy ? JA.report.exporting : JA.report.export}
    </button>
  );
}
