import {
  JIPM_BOARD,
  mountedKinds,
  remainingInventory,
  socketPartId,
  toSessionTerminal,
} from '@ojt/board-model';
import { isAssembleProblem } from '@ojt/content';
import type { BoardSession, MountableKind, SocketId } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { nextAssembleView, schematicPolicy, useStore } from '../app/store.js';
import type { AssembleViewMode } from '../app/store.js';
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
import { PartsPanel } from '../panels/PartsPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { TerminalListPanel } from '../panels/TerminalListPanel.js';
import { liveChart, TimeChartPanel, TimeChartSvg } from '../panels/TimeChartPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { ViewHint } from '../panels/ViewHint.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import { SchematicEditor } from '../schematic/SchematicEditor.js';
import { SchematicView } from '../schematic/SchematicView.js';
import { VerifyPanel } from '../schematic/VerifyPanel.js';
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
  type CommandHistory,
  type CommandResult,
  type SessionCommand,
} from '../session/commands.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  shouldIgnoreShortcut,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import { buildSpecChart } from '../session/spec-chart.js';
import { assembleStepHint, assembleSteps } from '../session/step-guide.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import {
  guideIndexFor,
  sameSelection,
  selectionFor,
  selectionForHover,
} from '../session/wiring-guide.js';
import { applyWorkFile, replayTesterToWorker, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * セッション画面（モードB）。設計仕様 §8.1 / §8.2 / §8.3 / §12.2。
 * ピック結果は `pickToAction()`（純粋関数）で操作に直し、盤操作は `commands.ts` の
 * コマンドを通して実行し、成功した変更だけを Worker に送る。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** ライブチャートの最小横軸長[ms]（開始直後に潰れないようにする）。 */
const LIVE_MIN_DURATION_MS = 5000;

/**
 * ビュー切替のボタン定義（盤 → 並べて → 回路図）。§11.4 / Plan 5 決定表#1
 * `F2` の巡回順（`ASSEMBLE_VIEW_ORDER`）と同じ並びにしてある。`title` には押した先で何が
 * 見えるかを日本語で書く（利用者要求 2026-09-19「押せる・押せないの理由は日本語で」）。
 */
const ASSEMBLE_VIEWS: ReadonlyArray<readonly [AssembleViewMode, string, string]> = [
  ['board', JA.schematic.viewBoard, JA.schematic.viewBoardTitle],
  ['split', JA.schematic.viewSplit, JA.schematic.viewSplitTitle],
  ['schematic', JA.schematic.viewSchematic, JA.schematic.viewSchematicTitle],
];

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ライブ記録のチャート。§8.2
 * 毎秒約30回変わる `snapshot.tMs` をここで受けることで、`Session`（＝3Dビューポートを含む）を
 * 巻き添えで再描画しない（§15）。
 *
 * UXレビュー #9: 何も起きていないうちは空のグラフを出さず折りたたんでおき、最初の変化点が
 * 記録されたら自動で開く。そのあとは訓練者が自分で畳み直せる（強制はしない）。
 */
function LivePanel(): JSX.Element {
  const chartSpecs = useStore((s) => s.chartSpecs);
  const liveTransitions = useStore((s) => s.liveTransitions);
  const tMs = useStore((s) => s.snapshot.tMs);
  const hasRecording = Object.keys(liveTransitions).length > 0;
  const [expanded, setExpanded] = useState(hasRecording);
  useEffect(() => {
    if (hasRecording) setExpanded(true);
  }, [hasRecording]);
  const live = useMemo(
    () => liveChart(chartSpecs, liveTransitions, Math.max(tMs, LIVE_MIN_DURATION_MS)),
    [chartSpecs, liveTransitions, tMs],
  );
  return (
    <section className={styles.panelLive} data-testid="live-panel">
      <div className={styles.liveHeader}>
        <h2 className={styles.liveTitle}>{JA.session.liveChart}</h2>
        <button
          type="button"
          data-testid="live-toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((next) => !next);
          }}
        >
          {expanded ? JA.liveCollapse.collapse : JA.liveCollapse.expand}
        </button>
      </div>
      {expanded ? (
        <TimeChartSvg chart={live} title={JA.session.liveChart} />
      ) : (
        <p className={styles.liveEmptyHint} data-testid="live-empty-hint">
          {JA.liveCollapse.empty}
        </p>
      )}
    </section>
  );
}

/**
 * スナップショットの差分から効果音を鳴らす（§15: WebAudio の合成音のみ）。
 * `LivePanel` と同じ理由で `snapshot` の購読を専用の小さなコンポーネントへ分離する
 * （`Session` 本体で購読すると毎秒約30回、3Dビューポートを含む部分木ごと再描画されてしまう）。
 * 何も描かないので、盤を組み直す（＝再マウントする）たびに「直前の音」の記憶も一緒に消える。
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

/** セッション画面。 */
export function Session(): JSX.Element {
  /*
   * この画面はモードB専用（C1/C2 は `InspectPartsSession` / `InspectRepairSession`）。
   * ストアの `problem` は3モードの共用体なので、ここで絞り込んでから使う。
   * 振り分けは `SessionRoute` が行うので、絞り込みに漏れたら「課題が選ばれていません」になる。
   */
  const problem = useStore((s) =>
    s.problem !== undefined && isAssembleProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const pendingTerminal = useStore((s) => s.pendingTerminal);
  const selectedWire = useStore((s) => s.selectedWire);
  const selectedSocket = useStore((s) => s.selectedSocket);
  const camera = useStore((s) => s.camera);
  /*
   * スナップショットは毎秒約30枚届くが、この画面が見るのは電源まわりの真偽値だけ。
   * `snapshot` をまるごと購読すると、この画面（＝3Dビューポートを含む部分木）が毎秒30回
   * 再描画されてしまうので、**必要な値だけ**を個別に購読する。§15
   */
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const webglLost = useStore((s) => s.webglLost);
  const schematicVisible = useStore((s) => s.schematicVisible);
  // --- Plan 5 Task 7: 回路図エディタ（§11.4 / 決定表#1） ---
  const assembleView = useStore((s) => s.assembleView);
  const schematicDoc = useStore((s) => s.schematicDoc);
  const schematicCursor = useStore((s) => s.schematicCursor);
  const schematicHistory = useStore((s) => s.schematicHistory);
  const verifying = useStore((s) => s.verifying);
  const verifyResult = useStore((s) => s.verifyResult);
  /** 配線ガイドで光っている回路図の要素。§11.4 / 決定表#7・#8 */
  const highlightCells = useStore((s) => s.highlight.cellIds);
  /** 結果画面の「盤で見る」で跳んできたか。§8.3 / UXレビュー #28 / 決定表#11 */
  const boardFocus = useStore((s) => s.boardFocus);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  /*
   * 回路図ヒントの出し方は級で決まる（§8.4）。3級は常時表示で開閉ボタンを出さない、
   * 2級は開閉できて初期は閉じる、1級は出さない。開閉できない級ではストアの値を見ずに
   * 規則そのものを見るので、何かの拍子に `schematicVisible` が倒れても3級の表示は消えない。
   * **hooks より前に置く**（B1）: 3D側の逆引き（`latestIndex` / `onHover`）が「いま回路図を
   * 出しているか」を見て初めてハイライトを許すため。ここで漏らすと、1級（回路図を一切出さない）
   * や2級で閉じているあいだも、盤の端子にホバーするだけで模範回路の答えが輪で漏れてしまう。
   */
  const policy = problem === undefined ? undefined : schematicPolicy(problem.grade);
  const showSchematic =
    policy !== undefined && (policy.toggleable ? schematicVisible : policy.shown);

  /*
   * 課題を開いたら Worker を起動して `load` を送る（§4.3）。
   * 依存に `sessionEpoch` を入れるのは、**同じ課題**をやり直したとき（結果画面の「もう一度」、
   * 例外バナーの「セッションをリセット」）に `problemId` が変わらず、この効果が張り直されないため。
   * 張り直されないと盤だけが作り直され、Worker は古いネットリストを回し続けて食い違う（§13 #5 / #6）。
   */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    const currentSession = store.session;
    /*
     * ここで見る `store.problem` は3モードの共用体のまま（絞り込み済みの `problem` は
     * 依存配列に載せた `problemId` としてしか使わない）。モードB以外が届いたときに
     * そのまま `load` を送ると、画面は「課題が選ばれていません」なのに Worker だけが
     * 動き出す（Plan 2B Batch 1 レビュー）。振り分けの `SessionRoute`（Task 10）が入るまでの
     * 安全網として、この画面が描けない課題では Worker を起こさない。
     */
    if (current === undefined || currentSession === undefined || !isAssembleProblem(current)) {
      return;
    }
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: (message) => {
        const state = useStore.getState();
        state.setJudging(false);
        if (message.result.ok) {
          state.setJudge(message.result.value);
          state.setRoute('result');
        } else {
          state.toast(referenceErrorText(message.result.errors.map((e) => e.message)), 'error');
        }
      },
      // 検算の結果（Plan 5 Task 6 の `verify` コマンドの返り）。§11.4
      onVerify: (message) => {
        useStore.getState().setVerifyResult(message.result);
      },
      onError: (text, fatal) => {
        const state = useStore.getState();
        // 判定の往復中に落ちたら「判定中…」のまま固まるので、必ず戻す（§8.2）
        state.setJudging(false);
        /*
         * 検算も同じ（レビュー I5）。`setVerifyResult()` は届かないので `verifying` が下りず、
         * 「検算中…」のままボタンが戻らなくなる。§11.4
         */
        state.setVerifying(false);
        const line = `${JA.error.workerError}: ${text}`;
        // 追従ループが止まったら（§13 #6）トーストでは気づけない。バナーを出して立て直させる
        if (fatal) state.setFatalError(line);
        else state.toast(line, 'error');
        state.addLog(line);
      },
    });
    bridge.send({ type: 'load', problemId: current.id, session: cloneSession(currentSession) });
    /*
     * Worker を起こし直した直後は、盤の `load` でつまみ・レンジ・0Ω調整が既定に戻っている
     * （クラッシュ復帰など、この効果が張られる前に `applyWorkFile()` が送った再送が
     * `WorkerBridge.send()` の no-op で捨てられている場合がある。Plan 2B レビュー B2）。
     * つまみを触っていなければ既定のままでよいので、無駄な再送はしない。
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

  /** コマンド結果を反映する。失敗はトーストとログに残すだけで盤は変わらない。§8.2 */
  const apply = useCallback(<T,>(result: CommandResult<T>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      store.addLog(failedLog(result.message));
      /*
       * 1端子3本目は盤としては断るが、実機では**やってしまえる**操作なので
       * 危険操作として数えたい（§5.6 #5 / §17 #25）。`Simulation.addWire()` は
       * 上限を超えた電線を**ネットリストに入れずに** `over-wires-per-terminal` を発行して
       * false を返すので、断られた電線をそのまま Worker へ送れば回路は汚さずに計上できる。
       */
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
        case 'none':
          break;
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
            if (wire === undefined) return;
            bridge.send({ type: 'addWire', wire });
            // 経路器は「部品を避けて通せない」電線を `RoutingError` で断る（§6.6）。
            // `safeRoutes()` がそれを受け止めるので、ここでは結果を見て理由を知らせるだけでよい。
            // 電気的な接続は既に成立しているので、盤の状態は戻さない（描けないのは見た目だけ）。
            const board = next.session;
            if (board === undefined) return;
            const { routes, errors } = safeRoutes(JIPM_BOARD, board);
            const failed = errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
              next.addLog(routeFailedLog(wire.id, JA.routeReason[failed.reason]));
              return;
            }
            // 帯の空きスロットが尽きて他の電線と同じ位置に載った（3Dでは琥珀色で描かれる）
            if (routes.find((r) => r.wireId === wire.id)?.laneOverflow === true) {
              next.toast(JA.session.laneOverflow, 'info');
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
      }
    },
    [apply],
  );

  /**
   * 配線ガイドの索引（訓練者の下書き用）。§11.4 / 決定表#7
   * 盤の配線が変わったら電線IDが古くなるので `session` も依存に並べる
   * （`buildHighlightIndex()` の注記のとおり）。下書きが無い／割り当てられないときは undefined。
   */
  const draftGuideIndex = useMemo(
    () =>
      problem === undefined || session === undefined
        ? undefined
        : guideIndexFor({ doc: schematicDoc, problem, board: JIPM_BOARD, session }),
    [schematicDoc, problem, session],
  );
  /** 配線ガイドの索引（課題の模範回路＝回路図ヒント用）。`doc: undefined` で模範回路に落ちる。 */
  const hintGuideIndex = useMemo(
    () =>
      problem === undefined || session === undefined
        ? undefined
        : guideIndexFor({ doc: undefined, problem, board: JIPM_BOARD, session }),
    [problem, session],
  );

  /**
   * 3D側の逆引き（盤 → 回路図）は**1つしか選べない**ので、「いま大きく出ている回路図」の
   * 索引を使う。エディタが出ているとき（`assembleView !== 'board'`）は下書き、盤だけのときは
   * 模範回路（下書きが割り当てられないあいだも模範回路に落ちる）。I4
   * `onHover` は `useCallback([])` で安定させるので、最新の索引は ref 経由で読む（§15）。
   *
   * 模範回路（`hintGuideIndex`）は `showSchematic` が真のときにしか使わない（B1）。下書き
   * （`draftGuideIndex`）は訓練者自身の編集内容なので回路図の表示可否とは無関係に使ってよいが、
   * 模範回路へ落ちる側（`??` の右辺）は同じガードを通す。
   */
  const latestIndex = useRef(showSchematic ? hintGuideIndex : undefined);
  latestIndex.current =
    assembleView === 'board'
      ? showSchematic
        ? hintGuideIndex
        : undefined
      : (draftGuideIndex ?? (showSchematic ? hintGuideIndex : undefined));

  /**
   * 3Dへ渡すコールバックは安定させる。毎回作り直すとシーン全体が再構築される。§15
   *
   * 盤の端子にホバーしたら回路図の要素を光らせる（決定表#8）。3Dが返すのは物理端子ID
   * （`S1.13`）なので、索引が持つ役割ID（`CR1.13`）へ直してから引く（§6.4）。
   * ホバーは毎秒何度も走るので、**同じ選択なら書かない**（`sameSelection`）。
   *
   * 結果画面から跳んできている（`boardFocus`）あいだは**ハイライトを触らない**（Task 9 /
   * 決定表#11・#27）。疑わしい端子を光らせて連れてきたのに、盤の上でマウスが少し動いただけで
   * その光が消えてしまうと、「どこを見ればよいか」を示すという導線そのものが成り立たない。
   * ホバー中の端子（ツールチップ）は帯が出ていても要るので、`setHovered()` は先に済ませる。
   */
  const onHover = useCallback((id: TerminalId | undefined) => {
    const store = useStore.getState();
    store.setHovered(id);
    if (store.boardFocus !== undefined) return;
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
   * 回路図エディタ（下書き）の要素をクリックしたら盤の端子を光らせる（受入基準②）。§11.4
   * 索引は**出どころごとに持つ**（I4）。「並べて」では下書きと模範回路が同時に画面へ出るので、
   * 1つの索引を画面の状態で切り替えると、押した図と光る端子が食い違う。
   *
   * `onHover` と同じく、結果画面から跳んできている（`boardFocus`）あいだはハイライトを
   * 触らない（M1）。帯は「結果から: …」のままなのに、回路図の要素を押しただけで光が
   * 別物へ差し替わると、帯と光の対応が食い違って見える。
   */
  const onPickDraftCell = useCallback(
    (cellId: string | undefined): void => {
      const store = useStore.getState();
      if (store.boardFocus !== undefined) return;
      store.setHighlight(selectionFor(draftGuideIndex, cellId));
    },
    [draftGuideIndex],
  );
  /** 回路図ヒント（模範回路）の要素をクリックしたときも同じ道を通す。決定表#7 */
  const onPickHintCell = useCallback(
    (cellId: string | undefined): void => {
      const store = useStore.getState();
      if (store.boardFocus !== undefined) return;
      store.setHighlight(selectionFor(hintGuideIndex, cellId));
    },
    [hintGuideIndex],
  );

  const onPick = useCallback(
    (hit: PickHit): void => {
      const store = useStore.getState();
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
          },
          hit,
        ),
      );
    },
    [runAction],
  );

  /*
   * 視点のショートカット（上段 1/2/3、テンキー 1/3/7、Ctrl で反対側、Home で全体。§12.2）は
   * 画面に依存しないので `useViewportShortcuts` に切り出してある（モードC1/C2 からも同じものを使う）。
   */
  useViewportShortcuts({ enabled: session !== undefined });

  // キーボード操作（Esc で配線取消、Delete で電線削除。§8.2）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 入力欄で打鍵中・IME変換中は盤のショートカットを動かさない（§8.2）
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      /*
       * 盤 → 並べて → 回路図 → 盤（Plan 5 Task 7 / 決定表#1）。エディタに入っていても
       * 抜け出せるように、下のフォーカス除けより**先**に見る（F2 はエディタの割当と重ならない）。
       */
      if (event.key === 'F2') {
        event.preventDefault();
        store.setAssembleView(nextAssembleView(store.assembleView));
        return;
      }
      /*
       * 回路図エディタに入っているあいだは盤の Esc / Delete を動かさない。エディタは同じキーを
       * 「分岐をやめる」「要素を消す」に使っており（決定表#25）、窓口の購読はエディタの
       * `onKeyDown` のあとにも必ず走るので、放っておくと1打鍵で盤の電線まで消える。§11.4
       */
      if (event.target instanceof Element && event.target.closest('[data-editor-pane]') !== null) {
        return;
      }
      const state = {
        mode: store.mode,
        pendingTerminal: store.pendingTerminal,
        selectedWire: store.selectedWire,
        wireColor: store.wireColor,
      };
      if (event.key === 'Escape') runAction(escapeToAction(state));
      else if (event.key === 'Delete') {
        runAction(
          deleteKeyToAction(
            state,
            current.wires.filter((w) => w.locked).map((w) => w.id),
          ),
        );
      }
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

  /*
   * モードB以外の課題（C1/C2）もここへ届きうる（課題一覧は20題すべてを開ける。Task 1）。
   * 専用画面ができるまでは行き止まりにせず、課題を捨てて一覧へ戻る導線だけを出す
   * （`Result` の「判定結果がありません」と同じ作り）。§12.1
   */
  if (problem === undefined || session === undefined) {
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
      // 宛先はネットリスト上の部品ID。役割が無いソケットでも `S3` として必ず届く（§6.4）
      bridge.send({
        type: 'setPreset',
        partId: socketPartId(next.socketRoles, socketId),
        presetMs: mounted.presetMs,
        session: cloneSession(next),
      });
    });
  };

  /**
   * 元に戻す／やり直し。盤を作り直すので **無通電に戻る**。
   * 実機でも配線をやり直す前に電源を落とすため（§5.3.5 の手順）、この挙動を既定とする。
   */
  const restore = (
    step: { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined,
    verb: string,
  ): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setPending(undefined);
    store.setSelectedWire(undefined);
    store.clearLive();
    store.addLog(historyLog(verb, step.command.label));
    bridge.send({ type: 'load', problemId: problem.id, session: cloneSession(step.session) });
  };

  /*
   * 手順の見える化（UXレビュー #3。2026-09-19の利用者決定「分かりやすく直感的に」）。
   * モードDの手順帯（`PlcSession.tsx`）と同じ考え方で、見るのは**部品装着・配線・通電**だけ
   * （配線の中身は一切見ない。決定表#7と同じ理由）。
   */
  const partsRemaining = remainingInventory(session.inventory, mountedKinds(session)).reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const fixedWireCount = session.wires.filter((w) => w.locked).length;
  const steps = assembleSteps({
    partsRemaining,
    wireCount: session.wires.length,
    fixedWireCount,
    powered,
  });
  const currentStepKey = steps.find((step) => step.state === 'current')?.key;

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
        viewSwitch={
          <>
            <span className={styles.toolLabelInline}>{JA.schematic.viewLabel}</span>
            {ASSEMBLE_VIEWS.map(([view, label, title]) => (
              <button
                key={view}
                type="button"
                data-testid={`assemble-view-${view}`}
                aria-pressed={assembleView === view}
                title={title}
                onClick={() => {
                  useStore.getState().setAssembleView(view);
                }}
              >
                {label}
              </button>
            ))}
            <span className={styles.toolKeyBadge} data-testid="assemble-view-key">
              {JA.schematic.viewKey}
            </span>
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
        judging={judging}
        onJudge={() => {
          // 往復中は押させない（結果が返るか Worker が落ちるまで `judging` が立つ）。§8.2
          if (useStore.getState().judging) return;
          useStore.getState().setJudging(true);
          bridge.send({
            type: 'judge',
            problem,
            session: cloneSession(session),
            elapsedMs: useStore.getState().elapsedMs,
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
          policy?.toggleable
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

      {/*
        結果画面の「疑わしい配線」から跳んできたときの帯（UXレビュー #28 / 決定表#11）。
        跳んだ先で「どうして盤が開いたのか」と「どこへ戻ればよいのか」が分からなくならないよう、
        理由の1行と「結果へ戻る」を必ず一緒に出す。戻るときは光らせた選択も畳む。
      */}
      {boardFocus === undefined ? null : (
        <div className={styles.boardFocus} data-testid="board-focus">
          <span>
            {JA.result.fromResult}: {boardFocus.text}
          </span>
          <button
            type="button"
            data-testid="back-to-result"
            onClick={() => {
              const store = useStore.getState();
              store.setBoardFocus(undefined);
              store.setHighlight(NO_HIGHLIGHT);
              store.setRoute('result');
            }}
          >
            {JA.result.backToResult}
          </button>
        </div>
      )}

      {/*
        いまどの手順にいるのかを文字でも出す（UXレビュー #3。決定表#7の理由から配線の中身には
        触れない。モードDの `.plcGuide` と同じ見た目を汎用クラス名 `.stepGuide` で再現する）。
      */}
      <div className={styles.stepGuide} data-testid="step-guide">
        <ol className={styles.stepList} aria-label={JA.stepGuide.label}>
          {steps.map((step) => (
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
          {assembleStepHint(currentStepKey)}
        </p>
      </div>

      <div className={styles.sessionLayout} data-view={assembleView}>
        {/*
          3Dビューポートの JSX は**1箇所のまま**にして（`memo(BoardScene)` が効くように）、
          `display: none` ではなくマウントするかどうかで切り替える。回路図だけを見ている
          あいだは Canvas を捨ててGPUを空ける（§15 / Plan 5 決定表#1）。
        */}
        {assembleView === 'schematic' ? null : (
          <div className={styles.viewport} data-testid="viewport">
            <WarningBanner />
            <BoardScene onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
            <div className={styles.statusOverlay} data-testid="status-overlay">
              {powered ? JA.session.powered : JA.session.unpowered} /{' '}
              {wireCountText(session.wires.length, fixedWireCount)} /{' '}
              {pendingTerminal === undefined
                ? JA.session.noTerminal
                : `${JA.session.firstTerminal}: ${pendingTerminal}`}
              {selectedWire === undefined ? '' : ` / ${JA.session.selection}: ${selectedWire}`}
              {tripped ? ` / ${JA.session.tripped}` : ''}
              {webglLost ? ` / ${JA.error.webglLost}` : ''}
            </div>
            <ViewHint />
          </div>
        )}

        {/*
          回路図エディタと検算の結果。§11.4 / Plan 5 決定表#1・#4
          `data-editor-pane` は盤のショートカット（Esc / Delete）の除けにも使う（上のキー購読）。
        */}
        {assembleView === 'board' || schematicDoc === undefined ? null : (
          <div className={styles.editorPane} data-editor-pane data-testid="editor-pane">
            <SchematicEditor
              problem={problem}
              board={JIPM_BOARD}
              document={schematicDoc}
              cursor={schematicCursor}
              history={schematicHistory}
              verifying={verifying}
              verified={verifyResult?.ok === true && verifyResult.passed}
              boardWired={session.wires.some((w) => !w.locked)}
              highlightCellIds={highlightCells}
              onEdit={(edit) => useStore.getState().applySchematicEdit(edit)}
              onCursor={(next) => {
                useStore.getState().setSchematicCursor(next);
              }}
              onUndo={() => {
                useStore.getState().undoSchematicEdit();
              }}
              onRedo={() => {
                useStore.getState().redoSchematicEdit();
              }}
              onVerify={() => {
                const store = useStore.getState();
                // 往復中は押させない（判定ボタンと同じ流儀。§8.2 / 決定表#4）
                if (store.verifying || store.schematicDoc === undefined) return;
                store.setVerifying(true);
                bridge.send({
                  type: 'verify',
                  problem,
                  document: store.schematicDoc,
                  elapsedMs: store.elapsedMs,
                });
              }}
              onClear={() => {
                useStore.getState().clearSchematic();
              }}
              onPickCell={onPickDraftCell}
              onRefuse={(message) => {
                useStore.getState().toast(message, 'error');
              }}
              onNotice={(message) => {
                useStore.getState().toast(message, 'info');
              }}
            />
            {verifyResult === undefined ? null : (
              <VerifyPanel
                problem={problem}
                document={schematicDoc}
                result={verifyResult}
                onPickCell={onPickDraftCell}
              />
            )}
          </div>
        )}

        {/*
          右パネルの並びは 課題 → 部品 → 回路図 → タイムチャート（UXレビュー #9）。
          回路図ヒントは**部品パネルより後**に置く（1D2-a のレビュー指摘）。
          3級は常時表示なので、先に置くと縦長の回路図に押し出されて「部品」が画面外へ行き、
          右パネルを一番下までスクロールしないと部品を装着できなかった。§8.4 / §8.1
          ライブ記録は最初の変化点までは折りたたむので、いちばん下に置いても目障りにならない。
        */}
        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          <PartsPanel
            session={session}
            selectedSocket={selectedSocket}
            powered={powered}
            onSelectSocket={(socketId) => {
              useStore.getState().setSelectedSocket(socketId);
            }}
            onPlug={onPlug}
            onUnplug={onUnplug}
            onSwap={onSwap}
            onPreset={onPreset}
          />
          {/* --- Plan 5 Task 10: 端子リストによるキーボード配線（UXレビュー #29 / 決定表#12） --- */}
          <TerminalListPanel
            board={JIPM_BOARD}
            session={session}
            pendingTerminal={pendingTerminal}
            onPick={onPick}
            onCancel={() => {
              runAction(escapeToAction({ mode, pendingTerminal, selectedWire, wireColor }));
            }}
          />
          {/* --- /Plan 5 Task 10 --- */}
          {showSchematic ? (
            <section className={styles.panelLive} data-testid="schematic-hint">
              <h2 className={styles.liveTitle}>{JA.session.schematicHint}</h2>
              <div className={styles.schematicBox}>
                <SchematicView
                  document={problem.schematic}
                  title={JA.session.schematicHint}
                  highlightCellIds={highlightCells}
                  onPickCell={onPickHintCell}
                />
              </div>
            </section>
          ) : null}
          {spec !== undefined && spec.ok ? <TimeChartPanel chart={spec.chart} /> : null}
          {spec !== undefined && !spec.ok ? (
            <p data-testid="reference-error">{referenceErrorText(spec.errors)}</p>
          ) : null}
          <LivePanel />
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
