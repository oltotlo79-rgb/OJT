import {
  JIPM_BOARD,
  socketPartId,
  SOCKET_IDS,
  toNetlistTerminal,
  toSessionTerminal,
} from '@ojt/board-model';
import type { BoardSession, SocketId } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  addedWireIds,
  buildHighlightIndex,
  isInspectRepairProblem,
  replacePart,
  type RepairCircuit,
} from '@ojt/content';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { schematicPolicy, useStore } from '../app/store.js';
import { NO_HIGHLIGHT } from '../app/store-types.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';
import {
  failedLog,
  historyLog,
  JA,
  openedProblemLog,
  powerLog,
  referenceErrorText,
  routeFailedLog,
  wireCountText,
  workFileSavedText,
} from '../i18n/ja.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { RepairPanel, type MountedPartRow } from '../panels/RepairPanel.js';
import { ReportPanel } from '../panels/ReportPanel.js';
import { dispatchTester, TesterPanel } from '../panels/TesterPanel.js';
import { TimeChartPanel } from '../panels/TimeChartPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { ViewHint } from '../panels/ViewHint.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import { SchematicView } from '../schematic/SchematicView.js';
import {
  cloneSession,
  redo as redoHistory,
  runAddWire,
  runRemoveWire,
  undo as undoHistory,
  type CommandHistory,
  type CommandResult,
  type SessionCommand,
} from '../session/commands.js';
import { circuitForJudge, hasReportFor, reportPickToAction } from '../session/inspect-repair.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  shouldIgnoreShortcut,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import { buildSpecChart } from '../session/spec-chart.js';
import { inspectRepairStepHint, inspectRepairSteps } from '../session/step-guide.js';
import { testerPickToAction, testerShortcut } from '../session/tester.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import { sameSelection, selectionFor, selectionForHover } from '../session/wiring-guide.js';
import { applyWorkFile, replayTesterToWorker, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * モードC2（回路点検・修復）のセッション画面。設計仕様 §9.2 / §9.3 / §12.2。
 *
 * 盤は**故障が注入された状態で、見たまま**描かれる（断線した電線は見えるが導通しない、
 * 未配線の電線は存在しない）。訓練者はテスターで測って故障を突き止め、指摘を登録し、
 * 白線で修復し、必要なら部品を交換して判定する。
 *
 * 3Dのクリックの意味はツールモードで変わる: `wire`＝白線を張る、`delete`＝電線を外す、
 * `tester`＝プローブを置く、`report`＝故障を指摘する。判断はそれぞれ純関数
 * （`pickToAction` / `testerPickToAction` / `reportPickToAction`）が持つ。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * スナップショットの差分から効果音を鳴らす。§15
 * `Session` / `InspectPartsSession` と同じ理由で専用の小さなコンポーネントに切り出す
 * （この画面で `snapshot` をまるごと購読すると3Dごと毎秒約30回描き直される）。
 */
function SoundEffects(): null {
  const snapshot = useStore((s) => s.snapshot);
  const previous = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previous.current, snapshot)) sounds.play(kind);
    previous.current = snapshot;
  }, [snapshot]);
  return null;
}

/** モードC2のセッション画面。 */
export function InspectRepairSession(): JSX.Element {
  const problem = useStore((s) =>
    s.problem !== undefined && isInspectRepairProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const circuit = useStore((s) => s.circuit);
  const reports = useStore((s) => s.reports);
  const pendingReport = useStore((s) => s.pendingReport);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const camera = useStore((s) => s.camera);
  /*
   * スナップショットは毎秒約30枚届くが、この画面が見るのは電源まわりの真偽値だけ。
   * `snapshot` をまるごと購読すると3Dビューポートごと巻き添えになる（§15）。
   */
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const schematicVisible = useStore((s) => s.schematicVisible);
  const highlightCells = useStore((s) => s.highlight.cellIds);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  // 視点のショートカットは Session / InspectPartsSession と共通のフックに任せる（§12.2）
  useViewportShortcuts({ enabled: session !== undefined });

  /*
   * Worker を起こし、**故障入りの**盤を読ませる。§9.2 / §5.4
   * 部品の故障はネットリスト変換のたびに入れ直す必要があるので、盤と一緒に `partFaults` を送る。
   */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    const currentCircuit = store.circuit;
    // この画面が描けない課題では Worker を起こさない（`SessionRoute` の振り分けの安全網）
    if (current === undefined || !isInspectRepairProblem(current) || currentCircuit === undefined) {
      return undefined;
    }
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: () => {
        // モードC2では届かない（モードBの判定結果）
      },
      onInspect: (message) => {
        // C1（`judgeParts`）と同じ `inspectResult` で返る。判別は `result.value.mode`
        const state = useStore.getState();
        state.setJudging(false);
        if (message.result.ok) {
          state.setJudge(message.result.value);
          state.setRoute('result');
        } else {
          state.toast(referenceErrorText(message.result.errors.map((e) => e.message)), 'error');
        }
      },
      onError: (text, fatal) => {
        const state = useStore.getState();
        // 判定の往復中に落ちたら「判定中…」のまま固まるので、必ず戻す（§8.2）
        state.setJudging(false);
        const line = `${JA.error.workerError}: ${text}`;
        if (fatal) state.setFatalError(line);
        else state.toast(line, 'error');
        state.addLog(line);
      },
    });
    bridge.send({
      type: 'load',
      problemId: current.id,
      session: cloneSession(currentCircuit.session),
      partFaults: currentCircuit.applied.partFaults,
    });
    /*
     * Worker を起こし直した直後は、盤の `load` でつまみ・レンジ・0Ω調整が既定に戻っている
     * （クラッシュ復帰など、この効果が張られる前に `applyWorkFile()` が送った再送が
     * `WorkerBridge.send()` の no-op で捨てられている場合がある。Plan 2B レビュー B2）。
     */
    const tester = store.tester;
    if (tester.mode !== 'off' || tester.zeroAdjusted) replayTesterToWorker(tester);
    store.addLog(openedProblemLog(current.title));
    return () => {
      bridge.stop();
    };
  }, [problemId, sessionEpoch]);

  // 経過時間を定期更新する（§8.1）
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  /** 盤操作の結果を反映する（`Session` と同じ流儀）。§8.2 */
  const apply = useCallback(<T,>(result: CommandResult<T>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      store.addLog(failedLog(result.message));
      // 1端子3本目は盤としては断るが、実機ではやってしまえるので危険操作として数える（§5.6 #5）
      if (result.code === 'terminal-overload' && result.wire !== undefined) {
        bridge.send({ type: 'addWire', wire: result.wire });
      }
      return;
    }
    const current = store.session;
    if (current !== undefined) store.setSession(cloneSession(current));
    store.pushHistory(result.command);
    store.addLog(result.command.label);
    after();
  }, []);

  const runAction = useCallback(
    (action: PickAction): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      switch (action.type) {
        case 'beginWire':
          store.setPending(action.from);
          break;
        case 'cancelWire':
          store.setPending(undefined);
          store.addLog(JA.session.cancelWire);
          break;
        case 'completeWire':
          store.setPending(undefined);
          apply(runAddWire(current, action.from, action.to, action.color, JIPM_BOARD), () => {
            const next = useStore.getState();
            const wire = next.session?.wires.at(-1);
            const board = next.session;
            if (wire === undefined || board === undefined) return;
            bridge.send({ type: 'addWire', wire });
            const failed = safeRoutes(JIPM_BOARD, board).errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
              next.addLog(routeFailedLog(wire.id, JA.routeReason[failed.reason]));
            }
          });
          break;
        case 'selectWire':
          store.setSelectedWire(action.wireId);
          break;
        case 'removeWire':
          apply(runRemoveWire(current, action.wireId), () => {
            useStore.getState().setSelectedWire(undefined);
            bridge.send({ type: 'removeWire', wireId: action.wireId });
          });
          break;
        case 'reject':
          store.toast(action.message, 'error');
          break;
        case 'selectSocket':
        case 'selectMounted':
          store.setSelectedSocket(action.socketId);
          break;
        case 'pressButton':
          bridge.send({ type: 'press', pbId: action.pbId });
          break;
        case 'placeProbe':
          dispatchTester({ type: 'place-probe', probe: action.probe, terminal: action.terminal });
          break;
        case 'liftProbe':
          if (action.probe === 'both') {
            dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
            dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
            // 空クリックのあとは必ず「次は黒」に戻す（2回の place-probe の順序に依存しない。M-5）
            store.setNextProbe('black');
          } else {
            dispatchTester({ type: 'place-probe', probe: action.probe, terminal: undefined });
          }
          break;
        case 'openReport':
          store.setPendingReport(action.target);
          break;
        case 'none':
          break;
      }
    },
    [apply],
  );

  /**
   * 回路図要素 ⇄ 盤の索引。§9.2
   * 電線は**いまの盤**から引くので、故障で取り除かれた電線（未配線）は出てこない
   * （Plan 2A `buildHighlightIndex()`）。盤が変わるたびに組み直す。
   */
  const highlightIndex = useMemo(
    () =>
      circuit === undefined || session === undefined
        ? undefined
        : buildHighlightIndex(circuit.cells, session),
    [circuit, session],
  );
  /** 最新の索引（`onHover` は `useCallback([])` なので ref 経由で読む。§15） */
  const latestIndex = useRef(highlightIndex);
  latestIndex.current = highlightIndex;

  /**
   * 端子のホバー。§9.2 / 決定表#8
   * 盤の端子から回路図の要素を逆引きして光らせる（連動ハイライトの「およびその逆」）。
   * 3Dが返すのは物理端子IDなので、索引が持つ役割IDへ直してから引く（§6.4）。
   * 引き方はモードBの配線ガイドと**同じ関数**（`session/wiring-guide.ts`。Plan 5 Task 8）。
   *
   * 2点ガードする（I-8）: ①1級（`schematicVisible === false`）は回路図を出さないので
   * 逆引きしても無駄な `set` になるだけで、毎フレームのホバーのたびにストアを揺らさない。
   * ②同じ選択なら `setHighlight()` を呼ばない（`sameSelection`）。ホバーは
   * マウス移動のたびに飛んでくるので、同一端子の上に留まっている間の再描画を防ぐ。
   */
  const onHover = useCallback((id: TerminalId | undefined) => {
    const store = useStore.getState();
    store.setHovered(id);
    if (!store.schematicVisible) return;
    const current = store.session;
    const next =
      current === undefined || id === undefined
        ? NO_HIGHLIGHT
        : selectionForHover(latestIndex.current, { terminal: toSessionTerminal(current, id) });
    if (sameSelection(next, store.highlight)) return;
    store.setHighlight(next);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

  /**
   * 3Dのピック → 操作。ツールモードで判断する純関数を選ぶ。§9.2 / §9.3
   * 端子IDは3Dが物理ID（`S1.13`）を返すので、ネットリスト・指摘・プローブが使う役割ID
   * （`CR1.13`）へ直してから渡す（§6.4）。
   */
  const onPick = useCallback(
    (hit: PickHit): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const mapped: PickHit =
        hit.kind === 'terminal'
          ? { ...hit, id: toNetlistTerminal(current.socketRoles, hit.id) }
          : hit;
      if (store.mode === 'tester') {
        runAction(
          testerPickToAction(
            { black: store.tester.black, red: store.tester.red, next: store.nextProbe },
            mapped,
          ),
        );
        return;
      }
      if (store.mode === 'report') {
        runAction(
          reportPickToAction(mapped, (socketId) => socketPartId(current.socketRoles, socketId)),
        );
        return;
      }
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
          },
          mapped,
        ),
      );
    },
    [runAction],
  );

  // キーボード操作（§8.2 / §9.3）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 入力欄で打鍵中・IME変換中は盤のショートカットを動かさない（§8.2）
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const state = {
        mode: store.mode,
        pendingTerminal: store.pendingTerminal,
        selectedWire: store.selectedWire,
        wireColor: store.wireColor,
      };
      if (event.key === 'Delete') {
        runAction(
          deleteKeyToAction(
            state,
            current.wires.filter((w) => w.locked).map((w) => w.id),
          ),
        );
        return;
      }
      if (store.mode === 'tester' || store.mode === 'report') {
        // 3種とも明示的に分岐する（`testerShortcut()` は未知のキーを既に上で弾いている）
        const shortcut = testerShortcut(event.key);
        if (shortcut === undefined) return;
        if (shortcut.type === 'next-probe') store.setNextProbe(shortcut.probe);
        else if (shortcut.type === 'zero-adjust') dispatchTester({ type: 'zero-adjust' });
        else if (shortcut.type === 'lift-both') {
          dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
          dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
          // 空クリックと同じく「次は黒」に戻す（§9.1 / §9.3。M-5）
          store.setNextProbe('black');
        }
        return;
      }
      if (event.key === 'Escape') runAction(escapeToAction(state));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [runAction]);

  const spec = useMemo(
    () => (problem === undefined ? undefined : buildSpecChart(problem)),
    [problem],
  );

  /**
   * 外した青線（**事実**）。§9.2
   * `modificationWireIds()` は故障箇所を除いた「改造」を返す判定用の集計なので、
   * これをそのままパネルに出すと「出ない＝故障箇所」が漏れてしまう（Blocking fix）。
   * ここでは初期配線から**いま無い**ものを機械的に挙げるだけで、故障箇所かどうかは判断しない。
   */
  const removedWires = useMemo(
    () =>
      circuit === undefined || session === undefined
        ? []
        : circuit.initialWireIds.filter((id) => !session.wires.some((w) => w.id === id)),
    [circuit, session],
  );

  /** 装着済みの部品（交換の対象）。 */
  const mountedParts = useMemo<MountedPartRow[]>(() => {
    if (session === undefined) return [];
    const out: MountedPartRow[] = [];
    for (const socketId of SOCKET_IDS) {
      const mounted = session.mounted[socketId];
      if (mounted === undefined) continue;
      const partId = socketPartId(session.socketRoles, socketId);
      out.push({
        socketId,
        partId,
        isTimer: mounted.kind === 'timer-h3y4',
        /*
         * 「交換済み」＝この部品を対象にした故障サイト（`sites`。交換しても残る）はあるのに、
         * いまの `partFaults`（ネットリスト注入用）にはもう無い（§9.2）。
         * 元から故障のない部品を誤って「交換済み」扱いしないよう、まず `sites` にあるかで絞る。
         */
        replaced:
          circuit !== undefined &&
          circuit.applied.sites.some((s) => s.partId === partId) &&
          !circuit.applied.partFaults.some(
            (f) => 'partId' in f.target && f.target.partId === partId,
          ),
      });
    }
    return out;
  }, [session, circuit]);

  /** 白線を張った本数（手順帯が見る「修復の作業をしたか」の元。§9.2 / UXレビュー #3）。 */
  const addedWireCount = useMemo(
    () =>
      circuit === undefined || session === undefined ? 0 : addedWireIds(circuit, session).length,
    [circuit, session],
  );

  if (problem === undefined || session === undefined || circuit === undefined) {
    return (
      <div className={styles.center}>
        <p>{JA.session.noProblem}</p>
        <button
          type="button"
          onClick={() => {
            useStore.getState().abandonSession();
          }}
        >
          {JA.result.toList}
        </button>
      </div>
    );
  }

  /*
   * 回路図ヒントの出し方は級で決まる（§9.2 / §8.4 2026-09-18の決定）。2級は開閉できて
   * 初期は閉じる、1級は出さない（開閉できない級ではストアの値を見ずに規則そのものを見るので、
   * 何かの拍子に `schematicVisible` が立っても1級の表示は出ない。`Session.tsx` と同じ理由）。
   */
  const policy = schematicPolicy(problem.grade);
  const showSchematic = policy.toggleable ? schematicVisible : policy.shown;

  /** 状態オーバーレイの電線カウントが見る「固定」本数（UXレビュー #21）。 */
  const fixedWireCount = session.wires.filter((w) => w.locked).length;

  /*
   * 手順の見える化（UXレビュー #3）。指摘 → 修復 → 判定。
   * ここでも配線・指摘の中身（合否）は一切見ない（決定表#7と同じ理由）。
   */
  const guideSteps = inspectRepairSteps({
    reported: reports.length > 0,
    repaired: addedWireCount > 0 || mountedParts.some((p) => p.replaced),
  });
  const currentStepKey = guideSteps.find((step) => step.state === 'current')?.key;

  /**
   * 元に戻す／やり直し。§8.2 / §9.2（I-11）
   * 部品交換の取り消しは、Worker の `plug` がそのたびに新しい良品を作ってしまうため
   * `unplug`/`plug` の送り直しでは元の故障を戻せない。**`load` をやり直す**ことで、
   * コマンドが持つ交換前後の `circuit`（故障つき `applied`）を丸ごと当て直す。
   * `applied.sites`（指摘すべき対象）は `replacePart()` で変わらないので、元に戻しても・
   * やり直しても指摘の要不要には影響しない（`sites` の義務は不変）。
   */
  const restore = (
    step: { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined,
    verb: string,
    circuitFor: (command: SessionCommand) => RepairCircuit | undefined,
  ): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setPending(undefined);
    store.setSelectedWire(undefined);
    store.clearLive();
    // `load` を送り直すと Worker 側もプローブを外す（`sim.worker.ts` の `load()`）ので合わせる
    store.clearProbes();
    const nextCircuit = circuitFor(step.command) ?? store.circuit;
    if (nextCircuit !== undefined) store.setCircuit(nextCircuit);
    store.addLog(historyLog(verb, step.command.label));
    bridge.send({
      type: 'load',
      problemId: problem.id,
      session: cloneSession(step.session),
      ...(nextCircuit === undefined ? {} : { partFaults: nextCircuit.applied.partFaults }),
    });
  };

  /**
   * 部品を良品に交換する。§9.2
   * 盤の上ではソケットから抜いて挿し直すだけなので、Worker には `unplug` → `plug` を送る
   * （`mountPart()` が新しい部品インスタンスを作るので、故障は入っていない）。判定側では
   * `replacePart()` で `partFaults` からその部品を落とす。**`sites` は残る**ので、
   * 交換しても指摘しなければ合格しない（Plan 2A 意図的な差分 #7）。
   *
   * 交換も1手として履歴に積む（I-11）。盤は変わらないので、前後の違いは `circuit` にだけ出る。
   */
  const onReplacePart = (socketId: SocketId, partId: string): void => {
    // 交換済みの部品にもう一度押しても、undo が壊れる無意味な1手を積まない（§9.2）
    if (
      !circuit.applied.partFaults.some((f) => 'partId' in f.target && f.target.partId === partId)
    ) {
      return;
    }
    const store = useStore.getState();
    const cloned = cloneSession(session);
    const nextCircuit = replacePart(circuit, partId);
    const command: SessionCommand = {
      kind: 'replacePart',
      label: `${JA.inspectRepair.replaced}: ${partId}`,
      before: cloned,
      after: cloned,
      circuitBefore: circuit,
      circuitAfter: nextCircuit,
    };
    bridge.send({ type: 'unplug', partId, session: cloned });
    bridge.send({ type: 'plug', socketId, session: cloned });
    store.setCircuit(nextCircuit);
    store.pushHistory(command);
    store.addLog(command.label);
  };

  return (
    <>
      <SoundEffects />
      <Toolbar
        mode={mode}
        wireColor={wireColor}
        allowedColors={session.allowedColors}
        camera={camera}
        canUndo={history.done.length > 0}
        canRedo={history.undone.length > 0}
        extraTools={
          <>
            <button
              type="button"
              data-testid="tool-tester"
              aria-pressed={mode === 'tester'}
              onClick={() => {
                useStore.getState().setMode('tester');
              }}
            >
              {JA.tester.toolMode}
            </button>
            <button
              type="button"
              data-testid="tool-report"
              aria-pressed={mode === 'report'}
              onClick={() => {
                useStore.getState().setMode('report');
              }}
            >
              {JA.inspectRepair.toolMode}
            </button>
          </>
        }
        onMode={(next) => {
          useStore.getState().setMode(next);
        }}
        onWireColor={(color) => {
          useStore.getState().setWireColor(color);
        }}
        onCamera={(preset) => {
          useStore.getState().setCamera(preset);
        }}
        onUndo={() => {
          restore(undoHistory(history), JA.session.undo, (c) => c.circuitBefore);
        }}
        onRedo={() => {
          restore(redoHistory(history), JA.session.redo, (c) => c.circuitAfter);
        }}
        judging={judging}
        onJudge={() => {
          const store = useStore.getState();
          // 往復中は押させない（結果が返るか Worker が落ちるまで `judging` が立つ）。§8.2
          if (store.judging) return;
          const board = store.session;
          const current = store.circuit;
          if (board === undefined || current === undefined) return;
          store.setJudging(true);
          bridge.send({
            type: 'judgeRepair',
            problem,
            circuit: circuitForJudge(current, cloneSession(board)),
            reports: store.reports,
            elapsedMs: store.elapsedMs,
          });
        }}
        onBack={() => {
          useStore.getState().setRoute('list');
        }}
        onSave={() => {
          const store = useStore.getState();
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            store.toast(reasonOf(error), 'error');
            return;
          }
          void api
            .saveWorkFile({
              kind: 'manual',
              file: toWorkFile(problem.id, session, store.elapsedMs, store.hazards.length),
            })
            .then((result) => {
              store.toast(
                result.ok ? workFileSavedText(result.path) : result.message,
                result.ok ? 'info' : 'error',
              );
            });
        }}
        onLoad={() => {
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            useStore.getState().toast(reasonOf(error), 'error');
            return;
          }
          void api.loadWorkFile({ kind: 'manual' }).then((result) => {
            if (!result.ok) {
              if (!result.canceled) useStore.getState().toast(result.message, 'error');
              return;
            }
            void applyWorkFile(result.file);
          });
        }}
        schematicVisible={showSchematic}
        onToggleSchematic={
          policy.toggleable
            ? () => {
                useStore.getState().toggleSchematic();
              }
            : undefined
        }
      >
        <PowerControls
          breakerOn={breakerOn}
          switchOn={switchOn}
          powered={powered}
          tripped={tripped}
          onBreaker={(on) => {
            bridge.send({ type: 'breaker', on });
            useStore.getState().addLog(powerLog(JA.session.breaker, on));
          }}
          onSwitch={(on) => {
            bridge.send({ type: 'switch', on });
            useStore.getState().addLog(powerLog(JA.session.switch, on));
          }}
          onResetTrip={() => {
            bridge.send({ type: 'resetTrip' });
            useStore.getState().addLog(JA.session.resetTripLog);
          }}
        />
      </Toolbar>

      {/* いまどの手順にいるのかを文字でも出す（UXレビュー #3）。決定表#7と同じ理由で合否には触れない。 */}
      <div className={styles.stepGuide} data-testid="step-guide">
        <ol className={styles.stepList} aria-label={JA.stepGuide.label}>
          {guideSteps.map((step) => (
            <li
              key={step.key}
              className={styles.step}
              data-state={step.state}
              data-testid={`step-${step.key}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              <span className={styles.stepName}>{step.label}</span>
              {step.state === 'done' ? (
                <span className={styles.stepNote}>{JA.stepGuide.done}</span>
              ) : null}
              {step.state === 'current' ? (
                <span className={styles.stepNote}>{JA.stepGuide.current}</span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className={styles.stepHint} data-testid="step-hint">
          {inspectRepairStepHint(currentStepKey)}
        </p>
      </div>

      <div className={styles.sessionLayout}>
        <div className={styles.viewport} data-testid="viewport">
          <WarningBanner />
          <BoardScene onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
          <div className={styles.statusOverlay} data-testid="status-overlay">
            {powered ? JA.session.powered : JA.session.unpowered} /{' '}
            {wireCountText(session.wires.length, fixedWireCount)} / {JA.inspectRepair.reportCount}{' '}
            {reports.length}
            {tripped ? ` / ${JA.session.tripped}` : ''}
          </div>
          <ViewHint />
        </div>

        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          <ReportPanel
            reports={reports}
            pending={pendingReport}
            wires={session.wires}
            onPick={(kind) => {
              const store = useStore.getState();
              const target = store.pendingReport;
              if (target === undefined) return;
              store.setPendingReport(undefined);
              if (hasReportFor(store.reports, target, kind)) {
                store.toast(JA.inspectRepair.duplicate, 'error');
                return;
              }
              store.addReport({ target, kind });
              store.addLog(`${JA.inspectRepair.reportCount}: ${JA.reportKind[kind]}`);
            }}
            onCancel={() => {
              useStore.getState().setPendingReport(undefined);
            }}
            onRemove={(index) => {
              useStore.getState().removeReport(index);
            }}
          />
          {/*
            回路図ヒントは**テスターより前**に置く（M4。`Session.tsx` が部品パネルより後に
            置くのと同じ理由の裏返しで、C2はテスターで測る前に回路図を見る流れが多い）。
          */}
          {showSchematic ? (
            <section className={styles.panelLive} data-testid="schematic-hint">
              <h2 className={styles.liveTitle}>{JA.session.schematicHint}</h2>
              <div className={styles.schematicBox}>
                <SchematicView
                  document={problem.schematic}
                  title={JA.session.schematicHint}
                  highlightCellIds={highlightCells}
                  onPickCell={(cellId) => {
                    useStore.getState().setHighlight(selectionFor(latestIndex.current, cellId));
                  }}
                />
              </div>
            </section>
          ) : null}
          <TesterPanel />
          <RepairPanel
            addedWires={addedWireIds(circuit, session)}
            removedWires={removedWires}
            mountedParts={mountedParts}
            onReplacePart={onReplacePart}
          />
          {spec !== undefined && spec.ok ? <TimeChartPanel chart={spec.chart} /> : null}
          {spec !== undefined && !spec.ok ? (
            <p data-testid="reference-error">{referenceErrorText(spec.errors)}</p>
          ) : null}
        </div>

        <div className={styles.bottomPanel}>
          <LogPanel
            lines={logLines}
            hazards={hazards}
            chatters={chatters}
            restoredHazardCount={restoredHazardCount}
          />
          <ElapsedTimer limit={problem.timeLimit} />
        </div>
      </div>
    </>
  );
}
