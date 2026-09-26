import { useRuntimeConnection } from '../session/use-runtime-connection.js';
import { TerminalListPanel } from '../panels/TerminalListPanel.js';
import { TesterPanel, dispatchTester } from '../panels/TesterPanel.js';
import { testerPickToAction } from '../session/tester.js';
import { IoTable } from '../ladder/IoTable.js';
import { BoardFocusNotice } from '../panels/BoardFocusNotice.js';
import { WireListPanel } from '../panels/WireListPanel.js';
import { togglePowerFixture } from '../session/power-toggle.js';
import {
  plcUnitFor,
  socketPartId,
  toNetlistTerminal,
  type MountableKind,
  type SocketId,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { isPlcProblem, resolvePlcIo } from '@ojt/content';
import { getDialect, type DialectProfile } from '@ojt/plc-dialects';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import {
  failedLog,
  historyLog,
  JA,
  powerLog,
  routeFailedLog,
  wireCountText,
  wireLabel,
} from '../i18n/ja.js';
import { HoverHint } from '../panels/HoverHint.js';
import { LadderWorkspace } from '../ladder/LadderWorkspace.js';
import { NotationDialog } from '../ladder/NotationDialog.js';
import { LivePanel } from '../panels/LivePanel.js';
import { TimeChartPanel } from '../panels/TimeChartPanel.js';
import { buildPlcSpecChart } from '../session/spec-chart.js';
import { focusWorkPanel } from '../session/workflow.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { PartsPanel } from '../panels/PartsPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { StepGuide } from '../panels/StepGuide.js';
import { hintStages } from '../session/hints.js';
import { Toolbar } from '../panels/Toolbar.js';
import { ViewHint } from '../panels/ViewHint.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import {
  cloneSession,
  redo as redoHistory,
  runAddWire,
  runPlug,
  runRemoveWire,
  runSetPreset,
  runSwapPart,
  runUnplug,
  undo as undoHistory,
  type CommandResult,
} from '../session/commands.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  shouldIgnoreShortcut,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import { hasLadderContent, shortcutKeyOf, type LadderEditorMode } from '../session/ladder.js';
import { boardForProblem, canJudgePlc, plcBoardOf } from '../session/plc-session.js';
import { autoConvert, skinGridCols, skinStepKeys, type PlcStepKey } from '../session/plc-skin.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import { loadWorkFileAndApply, saveCurrentWork } from '../session/work-file.js';
import { SoundEffects, useElapsedTicker } from '../session/use-session-runtime.js';
import { bridge } from '../session/worker-bridge.js';
import { terminalLoads } from '../session/terminal-list.js';
import { clearWireLimit, overloadedEnd, showWireLimit } from '../session/wire-limit.js';
import { WireLimitNotice } from '../panels/WireLimitNotice.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import { NoProblem } from './NoProblem.js';
import styles from './screens.module.css';

/**
 * モードD（PLC）のセッション画面。設計仕様 §10.1 / §10.6 / §12.1。決定表#10
 *
 * 左にGX Works3風のラダーワークスペース、右に3D盤（PLC本体と壁コンセントを含む）を置く。
 * キーの宛先はフォーカスで決まる（決定表#3）: エディタにフォーカスがある間は視点のショートカットも
 * 盤の `Delete` / `Esc` も動かさない。
 */

/** 手順の進み方（`done` 済み / `current` いまここ / `todo` これから / `anytime` いつでも）。 */
type StepState = 'done' | 'current' | 'todo' | 'anytime';

/**
 * ラダーの作り方の1行。キーの文字列は**方言プロファイルから引く**（決定表#12）。
 * 画面にキーを直接書かないので、Phase 4 でメーカーを替えると案内も一緒に変わる。
 * Batch 4+5 レビュー M7: これは「ラダー作成」の手順だけの案内で、`convert` は含めない
 * （変換の手順になったら {@link convertHintText} に切り替わる）。
 */
function ladderHintText(profile: DialectProfile): string {
  const keys = (['contact-no', 'coil'] as const)
    .map((action) => profile.shortcuts.find((entry) => entry.action === action))
    .filter((entry) => entry !== undefined)
    .map((entry) => `${entry.keys}＝${entry.label}`);
  const base = keys.length === 0 ? JA.plc.ladderHint : `${JA.plc.ladderHint}: ${keys.join(' ／ ')}`;
  /*
   * 「変換」の操作を持たないメーカー（決定表#3）の説明は、以前は帯に別行として常に出していた
   * （句読点無しで手順の案内と続いてしまい読みにくかった。UI監査 2026-09-20 Important #10 /
   * I20）。手順帯は「いまの手順の1行だけ」にするため、最初の手順（ラダー作成）の案内に
   * 句点で区切って添える。
   */
  return autoConvert(profile) ? `${base}。${JA.plc.stepConvertAuto}` : base;
}

/** 「変換」の手順の案内（Batch 4+5 レビュー M7 / M9）。 */
function convertHintText(profile: DialectProfile): string {
  const key = shortcutKeyOf(profile, 'convert');
  return key === undefined
    ? JA.plc.convertHint
    : `${JA.plc.convertHint}: ${key}＝${JA.plc.stepConvert}`;
}

/** 「モニタ開始・RUN」の手順の案内（Batch 4+5 レビュー M7）。 */
function runHintText(profile: DialectProfile): string {
  const entry = profile.shortcuts.find((e) => e.action === 'monitor');
  return entry === undefined ? JA.plc.runHint : `${JA.plc.runHint}: ${entry.keys}＝${entry.label}`;
}

/**
 * いまの手順にだけ効く1行の案内（Batch 4+5 レビュー M7）。手順ごとに1つだけ出し、
 * どの手順も「いまここ」でなければ（＝全部終わっていれば）何も出さない。
 */
function stepHintText(
  stepKey: PlcStepKey | undefined,
  profile: DialectProfile,
): string | undefined {
  if (stepKey === 'ladder') return ladderHintText(profile);
  if (stepKey === 'convert') return convertHintText(profile);
  if (stepKey === 'run') return runHintText(profile);
  if (stepKey === 'judge') return JA.plc.judgeHint;
  return undefined;
}

/** 選択中の電線の表示名（見つからなければ電線IDのまま）。 */
function selectedWireLabel(
  wires: readonly { id: string; from: string; to: string; color: string }[],
  id: string,
): string {
  const wire = wires.find((w) => w.id === id);
  return wire === undefined ? id : wireLabel(wire);
}

/** 書込み／読出し／モニタの表示名（GX Works3 の言い方に揃える）。§10.6 */
function ladderModeLabel(mode: LadderEditorMode): string {
  if (mode === 'write') return JA.plc.modeWrite;
  if (mode === 'read') return JA.plc.modeRead;
  return JA.plc.modeMonitor;
}

/** モードDのセッション画面。 */
export function PlcSession(): JSX.Element {
  const problem = useStore((s) =>
    s.problem !== undefined && isPlcProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const camera = useStore((s) => s.camera);
  const view = useStore((s) => s.ladderView);
  const ladderFocused = useStore((s) => s.ladderFocused);
  const ladderMode = useStore((s) => s.ladderMode);
  const converted = useStore((s) => s.converted);
  const ladder = useStore((s) => s.ladder);
  const plcRunning = useStore((s) => s.plcRunning);
  const debug = useStore((state) => state.snapshot.plcDebug);
  const pendingTerminal = useStore((state) => state.pendingTerminal);
  const hoveredTerminal = useStore((state) => state.hoveredTerminal);
  const selectedSocket = useStore((s) => s.selectedSocket);
  const selectedWire = useStore((s) => s.selectedWire);
  const dragging = useStore((s) => s.dragging);
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const dialectId = useStore((s) => s.dialectId);
  const problemId = problem?.id;

  const profile = useMemo(() => getDialect(dialectId), [dialectId]);
  /**
   * 「メーカーを切り替える」の確認画面。ラダー作業領域の「表記切替」と同じ画面を、盤だけを
   * 出している表示からも開けるようにする（2026-09-26 利用者報告「3D図の画面の時に各メーカーの
   * シーケンサーを切り替えることができない」）。
   */
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const closeVendorDialog = useCallback((): void => {
    setVendorDialogOpen(false);
  }, []);
  /** 表示列数は設定画面の値。`0` なら方言の既定（§10.6 / 決定表#8）。 */
  const gridColsSetting = useStore((s) => s.ladderGridCols);
  const board = useMemo(() => boardForProblem(problem), [problem]);
  /**
   * 課題の仕様タイムチャート（2026-09-26 利用者報告「PLCの課題でタイムチャートが見れないの？
   * 分かりにくい」）。模範ラダー＋模範配線を課題の操作列で走らせた波形で、判定の期待波形と同じ。
   */
  const spec = useMemo(
    () => (problem === undefined ? undefined : buildPlcSpecChart(problem)),
    [problem],
  );

  // 視点のショートカットはラダーにフォーカスが無いときだけ効かせる（決定表#3）
  useViewportShortcuts({ enabled: session !== undefined && !ladderFocused });

  /** Worker への `plc` コマンド。 */
  const onPlc = useCallback((action: PlcCommandAction): void => {
    bridge.send({ type: 'plc', action });
  }, []);

  /** Worker を起こし、PLC本体つきの盤を読ませる。§10.1 */
  useRuntimeConnection('plc');

  // 経過時間を定期更新する（§8.1）
  useElapsedTicker();

  /** 盤操作の結果を反映する（`InspectRepairSession` と同じ流儀）。§8.2 */
  const apply = useCallback(<T,>(result: CommandResult<T>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      // 1端子3本目は注意文で止める（2026-09-26 利用者指示。危険操作には数えない）
      if (result.code === 'terminal-overload' && result.wire !== undefined && store.session) {
        showWireLimit(overloadedEnd(store.session, result.wire), '');
        return;
      }
      store.toast(result.message, 'error');
      store.addLog(failedLog(result.message));
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
        case 'togglePower':
          togglePowerFixture(action.fixture);
          break;
        case 'dropPart':
          apply(runPlug(current, action.socketId, action.kind), () => {
            const next = useStore.getState().session;
            if (next === undefined) return;
            bridge.send({ type: 'plug', socketId: action.socketId, session: cloneSession(next) });
            useStore.getState().setSelectedSocket(action.socketId);
          });
          break;
        case 'unplugPart':
          apply(runUnplug(current, action.socketId), () => {
            const next = useStore.getState().session;
            if (next === undefined) return;
            const partId = socketPartId(current.socketRoles, action.socketId);
            bridge.send({ type: 'unplug', partId, session: cloneSession(next) });
          });
          break;
        case 'beginWire':
          store.setPending(action.from);
          break;
        case 'wireLimit':
          showWireLimit(action.terminal, action.label);
          break;
        case 'cancelWire':
          store.setPending(undefined);
          store.addLog(JA.session.cancelWire);
          break;
        case 'completeWire':
          store.setPending(undefined);
          apply(runAddWire(current, action.from, action.to, action.color, board), () => {
            clearWireLimit();
            const next = useStore.getState();
            const wire = next.session?.wires.at(-1);
            const boardNow = next.session;
            if (wire === undefined || boardNow === undefined) return;
            bridge.send({ type: 'addWire', wire });
            const failed = safeRoutes(board, boardNow).errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
              next.addLog(routeFailedLog(wire.id, JA.routeReason[failed.reason]));
            }
          });
          break;
        case 'placeProbe':
          dispatchTester({ type: 'place-probe', probe: action.probe, terminal: action.terminal });
          break;
        case 'liftProbe':
          for (const side of action.probe === 'both' ? (['black', 'red'] as const) : [action.probe])
            dispatchTester({ type: 'place-probe', probe: side, terminal: undefined });
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
        default:
          break;
      }
    },
    [apply, board],
  );

  const onHover = useCallback((id: TerminalId | undefined) => {
    useStore.getState().setHovered(id);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

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
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
            dragging: store.dragging,
            replaying: store.replay !== undefined,
            // 端子の結線数（2本で一杯の端子を押したら注意文で止める。2026-09-26）
            terminals: terminalLoads(board, current),
          },
          mapped,
        ),
      );
    },
    [runAction, board],
  );

  // 盤のキーボード操作（ラダーにフォーカスがある間は動かさない。決定表#3）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      if (store.ladderFocused) return;
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
      if (event.key === 'Escape') runAction(escapeToAction(state));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [runAction]);

  /*
   * 未対応の機種（§13 #2 / Batch 4+5 レビュー M13）。`boardForProblem()` は未対応機種でも
   * `JIPM_BOARD` へ静かに落ちる（3D は描ける）が、Worker へ送る `plcModel` に対応する本体が
   * 無いので判定できない。ここで検知して判定を止め、理由をトーストと判定ボタンの両方に出す。
   * 早期 return（次のブロック）より**前**に置く（Hooks はレンダーごとに必ず同じ順で呼ぶ）。
   */
  const modelKnown = problem === undefined ? true : plcBoardOf(problem) !== undefined;
  useEffect(() => {
    if (problem !== undefined && !modelKnown) {
      useStore.getState().toast(JA.plc.unknownModel(problem.plc.model), 'error');
    }
    // 機種は課題が変わらない限り変わらないので、課題ごとに1回だけ出す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, modelKnown]);

  if (problem === undefined || session === undefined) {
    return <NoProblem />;
  }

  /**
   * 部品の装着・取り外し・タイマ設定。§8.2
   * `Session.tsx` の3つの関数と同じ（盤の操作はモードDでも変わらない）。
   */
  const onPlug = (socketId: SocketId, kind: MountableKind): void => {
    apply(runPlug(session, socketId, kind), () => {
      const next = useStore.getState().session;
      if (next !== undefined) bridge.send({ type: 'plug', socketId, session: cloneSession(next) });
    });
  };

  const onUnplug = (socketId: SocketId): void => {
    apply(runUnplug(session, socketId), () => {
      const next = useStore.getState().session;
      const partId = socketPartId(session.socketRoles, socketId);
      if (next !== undefined) bridge.send({ type: 'unplug', partId, session: cloneSession(next) });
    });
  };

  /**
   * 部品を入れ替える（取り外して別の部品を挿し直す）。§8.2 利用者要望 2026-09-19
   * 盤としては `unplug` → `plug` だが、履歴には1手として積む（`runSwapPart()`）ので
   * 「元に戻す」1回で元の部品に戻る。Worker へは実機と同じ順（抜く → 挿す）で送る。
   */
  const onSwap = (socketId: SocketId, kind: MountableKind): void => {
    apply(runSwapPart(session, socketId, kind), () => {
      const next = useStore.getState().session;
      if (next === undefined) return;
      const partId = socketPartId(session.socketRoles, socketId);
      bridge.send({ type: 'unplug', partId, session: cloneSession(next) });
      bridge.send({ type: 'plug', socketId, session: cloneSession(next) });
    });
  };

  const onPreset = (socketId: SocketId, presetMs: number): void => {
    apply(runSetPreset(session, socketId, presetMs), () => {
      const next = useStore.getState().session;
      if (next === undefined) return;
      const mounted = next.mounted[socketId];
      if (mounted === undefined || mounted.kind !== 'timer-h3y4') return;
      bridge.send({
        type: 'setPreset',
        partId: socketPartId(next.socketRoles, socketId),
        presetMs: mounted.presetMs,
        session: cloneSession(next),
      });
    });
  };

  /** 状態オーバーレイの電線カウントが見る「固定」本数（UXレビュー #21）。 */
  const fixedWireCount = session.wires.filter((w) => w.locked).length;

  const readiness = canJudgePlc({ converted, ladder });
  /** 「変換」を持たないメーカー（`convertStep: false`）では `undefined`。決定表#3 */
  const convertKey = shortcutKeyOf(profile, 'convert');
  const judgeTitle = !modelKnown
    ? JA.plc.unknownModel(problem.plc.model)
    : readiness.ok
      ? JA.session.judge
      : readiness.reason === 'no-ladder'
        ? JA.plc.judgeNoLadder
        : convertKey === undefined
          ? JA.plc.judgeAutoConverting
          : JA.plc.judgeNotConverted(convertKey);

  /*
   * 手順の見える化（2026-09-19 の利用者決定「分かりやすく直感的に」）。
   * 見るのは**ラダーの有無・変換済みか・RUN 中か**の3つだけで、配線の中身は一切見ない
   * （決定表#7: セッション中に合否を漏らさない）。「配線」はいつでも行える作業として
   * 完了印を出さない。
   *
   * 「いまここ」は必ず1つだけにする（UI監査 2026-09-20 Blocking #7 / B8）。決まった順
   * （ラダー作成 → 変換 → モニタ開始RUN → 判定）で、まだ終わっていない**最初の**手順だけを
   * 「いまここ」にし、その手前は「済」、その先は「これから」にする。
   *
   * 以前は「ラダー作成」「モニタ開始RUN」「判定」の3段が同時に「いまここ」になることがあった:
   * 「変換」の無いスキン（自動変換）は課題を開いた瞬間の**空のラダー**でも変換が通ってしまい
   * （`converted` が真になる）、`ladder`（未着手）・`run`（変換済み・未RUN）・`judge`
   * （変換済みなら判定可）がそれぞれ独立に「いまここ」の条件を満たしていた。ここでは
   * 「先の手順が終わっているか」を順番に見ていき、**最初に終わっていない手順で止める**ことで、
   * 空のラダーの自動変換がまだ「ラダー作成」を終えたことにはならないようにする。
   */
  const written = hasLadderContent(ladder);
  const stepLabel: Readonly<Record<PlcStepKey, string>> = {
    wire: JA.plc.stepWire,
    ladder: JA.plc.stepLadder,
    convert: JA.plc.stepConvert,
    run: JA.plc.stepRun,
    judge: JA.plc.stepJudge,
  };
  /** 「judge」は本画面の中では完了しない（判定に成功すると結果画面へ遷移する）。 */
  const stepDone: Readonly<Record<Exclude<PlcStepKey, 'wire'>, boolean>> = {
    ladder: written,
    convert: converted,
    run: plcRunning,
    judge: false,
  };
  /** 「変換」を持たないメーカーではその段を落とす（決定表#3）。 */
  let currentStepKey: PlcStepKey | undefined;
  let currentFound = false;
  const steps: { key: PlcStepKey; label: string; state: StepState }[] = [];
  for (const key of skinStepKeys(profile)) {
    let state: StepState;
    if (key === 'wire') {
      state = 'anytime';
    } else if (currentFound) {
      state = 'todo';
    } else if (stepDone[key]) {
      state = 'done';
    } else {
      state = 'current';
      currentFound = true;
      currentStepKey = key;
    }
    steps.push({ key, label: stepLabel[key], state });
  }

  /** 元に戻す／やり直し（盤のみ。ラダーは `Ctrl+Z` がエディタで処理する。決定表#3） */
  const restore = (step: ReturnType<typeof undoHistory>, verb: string): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setPending(undefined);
    store.setSelectedWire(undefined);
    store.clearLive();
    store.addLog(historyLog(verb, step.command.label));
    bridge.send({
      type: 'load',
      problemId: problem.id,
      session: cloneSession(step.session),
      plcModel: problem.plc.model,
      allowPlcForcing: problem.io.mode === 'free',
    });
    // 盤を読み直すとスキャン結合も捨てられるので、変換済みのラダーを載せ直す（§10.4）
    const after = useStore.getState();
    if (after.converted && ladder !== undefined) {
      bridge.send({ type: 'plc', action: { kind: 'load', program: ladder } });
      // `load` は Worker 側で RUN もモニタも落とす（Task 3）。画面が RUN／モニタのままなら
      // 送り直さないと「ボタンは RUN なのに動かない」状態になる（レビュー指摘 B4）
      if (after.plcRunning) bridge.send({ type: 'plc', action: { kind: 'run', on: true } });
      if (after.ladderMode === 'monitor') {
        bridge.send({ type: 'plc', action: { kind: 'monitor', on: true } });
      }
    }
  };

  return (
    <>
      <SoundEffects />
      <Toolbar
        mode={mode}
        wireColor={wireColor}
        allowedColors={session.allowedColors}
        camera={camera}
        /* 段階的に開くヒント（指摘 PR-02）。1段目は手順帯がいま出している案内そのもの。 */
        hints={hintStages({
          mode: 'plc',
          profile,
          grade: problem.grade,
          stepHint: stepHintText(currentStepKey, profile),
          tags: problem.tags,
        })}
        showPlcView
        canUndo={history.done.length > 0}
        canRedo={history.undone.length > 0}
        judging={judging}
        judgeDisabled={!readiness.ok || !modelKnown}
        judgeTitle={judgeTitle}
        extraTools={
          <>
            {(
              [
                ['ladder', JA.plc.viewLadder],
                ['split', JA.plc.viewSplit],
                ['board', JA.plc.viewBoard],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={styles.plcToolButton}
                data-testid={`view-${value}`}
                aria-pressed={view === value}
                onClick={() => {
                  useStore.getState().setLadderView(value);
                }}
              >
                {label}
              </button>
            ))}
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
          restore(undoHistory(history), JA.session.undo);
        }}
        onRedo={() => {
          restore(redoHistory(history), JA.session.redo);
        }}
        onJudge={() => {
          const store = useStore.getState();
          if (store.judging || !modelKnown) return;
          const boardSession = store.session;
          const currentLadder = store.ladder;
          if (boardSession === undefined || currentLadder === undefined) return;
          if (!canJudgePlc({ converted: store.converted, ladder: currentLadder }).ok) return;
          store.setJudging(true);
          bridge.send({
            type: 'judgePlc',
            problem,
            session: cloneSession(boardSession),
            ladder: currentLadder,
            elapsedMs: store.elapsedMs,
          });
        }}
        onBack={() => {
          useStore.getState().setRoute('list');
        }}
        onSave={() => {
          saveCurrentWork(problem.id, session);
        }}
        onLoad={loadWorkFileAndApply}
        schematicVisible={false}
        onToggleSchematic={undefined}
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
      <BoardFocusNotice />
      {debug !== undefined && Object.keys(debug.forcedInputs).length > 0 && (
        <div role="alert" style={{ padding: 8, background: '#66480d' }}>
          診断用入力の強制中：実際の配線とは異なる入力で運転しています。
          <button type="button" onClick={() => onPlc({ kind: 'clearForces' })}>
            強制をすべて解除
          </button>
        </div>
      )}

      {/*
        いまどの手順にいるのか・いまの状態は何か・次に何をすればよいのかを、
        ボタンの見た目に頼らず文字でも出す（2026-09-19 の利用者決定）。
        手順の判定材料はラダーの有無・変換済みか・RUN 中かの3つだけで、
        配線の中身（＝合否）には一切触れない（決定表#7）。
      */}
      <StepGuide
        steps={steps}
        actions={{
          wire: () => useStore.getState().setLadderView('board'),
          ladder: () => useStore.getState().setLadderView('ladder'),
        }}
        hint={stepHintText(currentStepKey, profile)}
        testId={{ band: `plc-guide`, step: (key) => `plc-step-${key}`, hint: `plc-hint` }}
      >
        <div className={styles.plcStatus}>
          {spec !== undefined && spec.ok ? (
            <button
              type="button"
              className={styles.plcChartLink}
              data-testid="plc-show-chart"
              onClick={() => {
                focusWorkPanel('chart-panel');
              }}
            >
              {JA.plc.showChart}
            </button>
          ) : null}
          <span className={styles.plcChip} data-testid="plc-ladder-mode">
            {JA.plc.statusLadder}: {ladderModeLabel(ladderMode)}
          </span>
          <span
            className={styles.plcChip}
            data-testid="plc-run-status"
            data-on={plcRunning ? 'true' : 'false'}
          >
            {JA.plc.statusPlc}: {plcRunning ? JA.plc.statusRunning : JA.plc.statusStopped}
          </span>
        </div>
      </StepGuide>

      <div className={styles.plcLayout} data-testid="plc-session" data-view={view}>
        {view === 'board' ? null : (
          <LadderWorkspace
            problem={problem}
            profile={profile}
            gridCols={skinGridCols(profile, gridColsSetting)}
            onPlc={onPlc}
          />
        )}
        {view === 'ladder' ? null : (
          <div className={styles.viewport} data-testid="viewport">
            <WarningBanner />
            <WireLimitNotice />
            <BoardScene
              board={board}
              onPick={onPick}
              onHover={onHover}
              onPress={onPress}
              onRelease={onRelease}
            />
            {/*
              配線の始点と選択中の電線を字でも出す（組立画面と同じ。2026-09-26 の操作の総点検で、
              PLC画面だけ「いまどの端子を選んでいるか」「どの電線を選んでいるか」が出ていなかった）。
            */}
            <div className={styles.statusOverlay} data-testid="status-overlay">
              {powered ? JA.session.powered : JA.session.unpowered} /{' '}
              {wireCountText(session.wires.length, fixedWireCount)} /{' '}
              {pendingTerminal === undefined
                ? JA.session.noTerminal
                : `${JA.session.firstTerminal}: ${pendingTerminal}`}
              {selectedWire === undefined || selectedWire.length === 0
                ? ''
                : ` / ${JA.session.selection}: ${selectedWireLabel(session.wires, selectedWire)}`}
              {tripped ? ` / ${JA.session.tripped}` : ''}
            </div>
            <ViewHint />
            {/* いま指しているものと、押すと何が起きるか（組立・点検修復と同じ） */}
            <HoverHint />
          </div>
        )}
        <div className={styles.plcRight}>
          <ProblemPanel problem={problem} />
          {/* 仕様（模範の動き）と実測（いまの動き）を上下に並べる。組立画面と同じ部品 */}
          {spec !== undefined && spec.ok ? <TimeChartPanel chart={spec.chart} /> : null}
          <LivePanel />
          {/*
            決定表#7の静的な1行（判定データではないので常に出してよい）。Batch 4+5 レビュー B1。
          */}
          <p className={styles.plcOutletNote} data-testid="plc-outlet-note">
            {JA.plc.outletNote}
          </p>
          {/* 3Dの本体と同じ機種であることを字でも見せる（決定表#9。既定メーカーで差し替わる） */}
          <div className={styles.plcModelRow}>
            <p className={styles.plcOutletNote} data-testid="plc-model">
              {JA.plc.modelLabel}: {plcUnitFor(problem.plc.model)?.displayName ?? problem.plc.model}
            </p>
            <button
              type="button"
              data-testid="switch-vendor"
              title={JA.plc.switchVendorHint}
              onClick={() => {
                setVendorDialogOpen(true);
              }}
            >
              {JA.plc.switchVendor}
            </button>
          </div>
          {vendorDialogOpen ? (
            <NotationDialog profile={profile} onClose={closeVendorDialog} purpose="vendor" />
          ) : null}
          {/*
            モードDもリレーはソケットへ装着してから `CRn.14` へ配線する（§10.2 の2段結線）。
            `onPlug` / `onUnplug` / `onPreset` は `Session.tsx` の3つをそのまま写す。
          */}
          <PartsPanel
            session={session}
            selectedSocket={selectedSocket}
            powered={powered}
            carrying={dragging?.source === 'palette' ? dragging.kind : undefined}
            onCarry={(kind) => useStore.getState().setDragging({ source: 'palette', kind })}
            onSelectSocket={(socketId) => {
              useStore.getState().setSelectedSocket(socketId);
            }}
            onPlug={onPlug}
            onUnplug={onUnplug}
            onSwap={onSwap}
            onPreset={onPreset}
          />
          {view === 'board' && board.plcUnit !== undefined && (
            <IoTable io={resolvePlcIo(problem.io)} profile={profile} unit={board.plcUnit} />
          )}
          <TerminalListPanel
            board={board}
            session={session}
            pendingTerminal={pendingTerminal}
            hoveredTerminal={hoveredTerminal}
            measuring={mode === 'tester'}
            onPick={onPick}
            onHover={onHover}
            onCancel={() => useStore.getState().setPending(undefined)}
          />
          <TesterPanel />
          <WireListPanel board={board} />
          <ElapsedTimer limit={problem.timeLimit} />
          <LogPanel
            lines={logLines}
            hazards={hazards}
            chatters={chatters}
            restoredHazardCount={restoredHazardCount}
          />
        </div>
      </div>
    </>
  );
}
