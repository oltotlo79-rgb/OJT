import PACKAGE from '../../../package.json';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';

export async function exportDiagnostics(): Promise<void> {
  const state = useStore.getState();
  const report = {
    format: 'ojt-diagnostic-v1',
    version: PACKAGE.version,
    at: new Date().toISOString(),
    mode: state.problem?.mode,
    problemId: state.problem?.id,
    route: state.route,
    error: state.fatalError,
    sessionEpoch: state.sessionEpoch,
    lastOperations: state.logLines.slice(-50),
    snapshot: state.snapshot,
    circuit:
      state.session === undefined
        ? undefined
        : {
            boardId: state.session.boardId,
            wires: state.session.wires,
            mounted: state.session.mounted,
          },
    ladder: state.ladder,
    converted: state.converted,
    convertIssues: state.convertIssues,
    saveProgress: {
      elapsedMs: state.elapsedMs,
      hazardCount:
        state.restoredHazardCount + Math.max(state.sessionHazardCount, state.hazards.length),
    },
  };
  try {
    const result = await ojtApi().saveTextFile({
      defaultFileName: `OJT診断記録_${new Date().toISOString().slice(0, 10)}.txt`,
      text: JSON.stringify(report, null, 2),
    });
    if (!result.ok && !result.canceled) state.toast(result.message, 'error');
    else if (result.ok) state.toast('診断記録を保存しました。');
  } catch (error) {
    state.toast(`診断記録を保存できません：${String(error)}`, 'error');
  }
}
