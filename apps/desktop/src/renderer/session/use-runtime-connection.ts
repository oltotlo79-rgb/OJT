import { useEffect } from 'react';
import type { ProblemMode } from '@ojt/content';
import type { SimMessage } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { JA, openedProblemLog, referenceErrorText } from '../i18n/ja.js';
import { cloneSession } from './commands.js';
import { replayTesterToWorker } from './work-file.js';
import { bridge } from './worker-bridge.js';

type Outcome = Extract<
  SimMessage,
  { type: 'judgeResult' | 'inspectResult' | 'plcResult' }
>['result'];

/** 永続作業はストアに残し、画面・復旧の世代ごとにライブ演算だけを接続し直す。 */
export function useRuntimeConnection(mode: ProblemMode): void {
  const problemId = useStore((state) => state.problem?.id);
  const epoch = useStore((state) => state.sessionEpoch);
  useEffect(() => {
    const store = useStore.getState(),
      problem = store.problem,
      session = store.session;
    if (problem?.mode !== mode || session === undefined) return;
    if (mode === 'inspect-repair' && store.circuit === undefined) return;
    const judged = (result: Outcome): void => {
      const state = useStore.getState();
      if (result.ok && result.value.mode !== mode) return;
      state.setJudging(false);
      if (result.ok) {
        state.setJudge(result.value);
        state.setRoute('result');
      } else state.toast(referenceErrorText(result.errors.map((error) => error.message)), 'error');
    };
    bridge.start({
      onSnapshot: (snapshot) => {
        const state = useStore.getState();
        state.applySnapshot(snapshot);
        if (mode === 'plc') {
          if (snapshot.plcDebug !== undefined) state.setPlcRunning(snapshot.plcDebug.running);
          if (snapshot.plc !== undefined || state.plcMonitor !== undefined)
            state.setPlcMonitor(snapshot.plc);
        }
      },
      onJudge: (message) => {
        if (mode === 'assemble') judged(message.result);
      },
      onInspect: (message) => {
        if (mode === 'inspect-parts' || mode === 'inspect-repair') judged(message.result);
      },
      onPlc: (message) => {
        if (mode === 'plc') judged(message.result);
      },
      onVerify: (message) => {
        if (mode === 'assemble') useStore.getState().setVerifyResult(message.result);
      },
      onError: (message, fatal) => {
        const state = useStore.getState(),
          text = `${JA.error.workerError}: ${message}`;
        state.setJudging(false);
        state.setVerifying(false);
        if (fatal) state.setFatalError(text);
        else state.toast(text, 'error');
        state.addLog(text);
      },
    });
    // C1の部品装着はcheckPartIdの効果で再現する。その他は同じ保存セッションを送る。
    if (problem.mode !== 'inspect-parts') {
      const circuit = problem.mode === 'inspect-repair' ? store.circuit : undefined;
      bridge.send({
        type: 'load',
        problemId: problem.id,
        session: cloneSession(circuit?.session ?? session),
        ...(circuit === undefined ? {} : { partFaults: circuit.applied.partFaults }),
        ...(problem.mode === 'plc'
          ? { plcModel: problem.plc.model, allowPlcForcing: problem.io.mode === 'free' }
          : {}),
      });
      if (problem.mode !== 'plc') replayTesterToWorker(store.tester);
    }
    store.addLog(openedProblemLog(problem.title));
    return () => bridge.stop();
  }, [mode, problemId, epoch]);
}
