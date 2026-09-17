import { toNetlistTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { isInspectPartsProblem } from '@ojt/content';
import { useCallback, useEffect, useRef, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { checkSessionFor, useStore } from '../app/store.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';
import {
  contactProbeLabel,
  JA,
  openedProblemLog,
  powerLog,
  referenceErrorText,
  workFileSavedText,
} from '../i18n/ja.js';
import { CheckTrayPanel } from '../panels/CheckTrayPanel.js';
import { DiagnosisHelp } from '../panels/DiagnosisHelp.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { MarkSheetPanel } from '../panels/MarkSheetPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { dispatchTester, TesterPanel } from '../panels/TesterPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import { cloneSession } from '../session/commands.js';
import { checkLoadFor, probeTargets } from '../session/inspect-parts.js';
import { shouldIgnoreShortcut, type PickHit } from '../session/interaction.js';
import { testerPickToAction, testerShortcut } from '../session/tester.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import { applyWorkFile, replayTesterToWorker, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * モードC1（部品点検）のセッション画面。設計仕様 §9.1 / §9.3 / §12.2。
 *
 * モードBとの違いは3つだけである。①盤には**配線しない**（線色パレットも削除モードも出さない）、
 * ②部品はチェック用ソケットに1個ずつ挿し、挿し替えるたびに Worker へ `load` を送り直す、
 * ③3Dの端子クリックは配線ではなく**テスターのプローブ配置**になる。
 *
 * 3Dへ渡すハンドラはすべて `useCallback` で安定させる（§15。毎レンダーで作り直すと
 * `frameloop="demand"` が実質常時描画になる）。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * スナップショットの差分から効果音を鳴らす。§15
 * `Session`（モードB）と同じ理由で専用の小さなコンポーネントに切り出す
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

/** プローブの置き場所ショートカット（コイル＋4組ぶんの a/b 接点）。§9.1 */
function ProbeShortcuts(): JSX.Element {
  return (
    <div data-testid="probe-shortcuts">
      <p className={styles.subtitle} style={{ margin: '6px 0 2px', fontSize: 11 }}>
        {JA.inspectParts.probeShortcut}
      </p>
      {probeTargets().map((target) => {
        const label =
          target.id === 'coil'
            ? JA.inspectParts.coil
            : contactProbeLabel(Number(target.id.slice(1)), target.id.startsWith('a') ? 'a' : 'b');
        return (
          <button
            key={target.id}
            type="button"
            data-testid={`probe-target-${target.id}`}
            onClick={() => {
              // 2本まとめて置く（黒＝COM側・赤＝測る側）。§9.1 測定1・測定2
              dispatchTester({ type: 'place-probe', probe: 'black', terminal: target.black });
              dispatchTester({ type: 'place-probe', probe: 'red', terminal: target.red });
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** モードC1のセッション画面。 */
export function InspectPartsSession(): JSX.Element {
  const problem = useStore((s) =>
    s.problem !== undefined && isInspectPartsProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const answers = useStore((s) => s.answers);
  const checkPartId = useStore((s) => s.checkPartId);
  const mode = useStore((s) => s.mode);
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
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  /*
   * 視点のショートカット（上段 1/2/3、テンキー 1/3/7、Ctrl で反対側、Home で全体。§12.2）は
   * 画面に依存しないので `useViewportShortcuts` に任せる（モードBの `Session` と同じもの）。
   */
  useViewportShortcuts({ enabled: session !== undefined });

  /*
   * Worker を起こして購読する。モードBと同じく `[problemId, sessionEpoch]` で張り直す。
   * 盤そのものの送信（`load`）は下の効果が `checkPartId` も見て行う。
   */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    // この画面が描けない課題では Worker を起こさない（`SessionRoute` の振り分けの安全網）
    if (current === undefined || !isInspectPartsProblem(current)) return undefined;
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: () => {
        // モードC1では届かない（モードBの判定結果）
      },
      onInspect: (message) => {
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
    store.addLog(openedProblemLog(current.title));
    return () => {
      bridge.stop();
    };
  }, [problemId, sessionEpoch]);

  /*
   * チェック用ソケットの中身が変わるたびに盤を作り直して `load` を送る。§9.1
   * 差分の `plug` / `unplug` ではなく `load` にするのは、部品の故障がネットリスト変換のたびに
   * 入れ直される必要があるためである（§5.4。Task 8 の決定）。
   */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    if (current === undefined || !isInspectPartsProblem(current)) return;
    /*
     * 盤を作り直すとプローブの端子は新しいネットリストに無いかもしれないので、
     * 画面側でも外す（Worker 側の `load` も同じことをする。Task 3）。つまみとレンジは残すので、
     * Ωレンジに回したまま次の部品を挿して測り続けられる（§9.1 の手順）。0Ω調整も残る。
     */
    store.clearProbes();
    /*
     * `load` は Worker 側のつまみ・レンジ・0Ω調整を保ったまま動くが、この画面が張り直された
     * 直後（クラッシュ復帰など）は Worker がまだ起きておらず、`applyWorkFile()` の再送が
     * `WorkerBridge.send()` の no-op で捨てられていることがある。触っていれば送り直す
     * （Plan 2B レビュー B2）。
     */
    const tester = store.tester;
    const resendTester = (): void => {
      if (tester.mode !== 'off' || tester.zeroAdjusted) replayTesterToWorker(tester);
    };
    if (checkPartId === undefined) {
      const empty = checkSessionFor(current);
      store.setSession(empty);
      bridge.send({ type: 'load', problemId: current.id, session: cloneSession(empty) });
      resendTester();
      return;
    }
    const loaded = checkLoadFor(current, checkPartId);
    if (!loaded.ok) {
      store.toast(referenceErrorText(loaded.errors.map((e) => e.message)), 'error');
      store.setCheckPart(undefined);
      return;
    }
    store.setSession(loaded.session);
    bridge.send({
      type: 'load',
      problemId: current.id,
      session: cloneSession(loaded.session),
      partFaults: loaded.partFaults,
    });
    resendTester();
    store.addLog(`${JA.inspectParts.mounted}: ${checkPartId}`);
  }, [problemId, sessionEpoch, checkPartId]);

  // 経過時間を定期更新する（§8.1）
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  /** 3Dへ渡すコールバックは安定させる。毎回作り直すとシーン全体が再構築される。§15 */
  const onHover = useCallback((id: TerminalId | undefined) => {
    useStore.getState().setHovered(id);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

  /**
   * 3Dのピック → テスター操作。§9.3
   * 3D盤が返すのは**物理端子ID**（`S7.13`）。ネットリストは**役割ID**（`CHK.13`）で組まれて
   * いるので、`toNetlistTerminal()` で直してからプローブの置き場所にする（§6.4。`runAddWire()`
   * と同じ変換をここでも1箇所だけ行う）。
   */
  const onPick = useCallback((hit: PickHit): void => {
    const store = useStore.getState();
    const current = store.session;
    if (current === undefined) return;
    const mapped: PickHit =
      hit.kind === 'terminal'
        ? { ...hit, id: toNetlistTerminal(current.socketRoles, hit.id) }
        : hit;
    const action = testerPickToAction(
      { black: store.tester.black, red: store.tester.red, next: store.nextProbe },
      mapped,
    );
    switch (action.type) {
      case 'placeProbe':
        dispatchTester({ type: 'place-probe', probe: action.probe, terminal: action.terminal });
        break;
      case 'liftProbe':
        if (action.probe === 'both') {
          dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
          dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
          // 空クリックのあとは必ず「次は黒」に戻す（2回の place-probe の順序に依存しない。M-5）
          useStore.getState().setNextProbe('black');
        } else {
          dispatchTester({ type: 'place-probe', probe: action.probe, terminal: undefined });
        }
        break;
      default:
        // 押ボタンは `three/PushButton.tsx` のポインタイベント（`onPress`/`onRelease`）で
        // 扱う。3Dの端子ピックが `pushbutton` を返すことはないのでここには来ない（M4）。
        break;
    }
  }, []);

  // キーボード操作（テスター。視点は `useViewportShortcuts` の担当。§8.2 / §9.3）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 入力欄で打鍵中・IME変換中は盤のショートカットを動かさない（§8.2）
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      const shortcut = testerShortcut(event.key);
      if (shortcut === undefined) return;
      if (shortcut.type === 'next-probe') store.setNextProbe(shortcut.probe);
      else if (shortcut.type === 'zero-adjust') dispatchTester({ type: 'zero-adjust' });
      else {
        dispatchTester({ type: 'place-probe', probe: 'black', terminal: undefined });
        dispatchTester({ type: 'place-probe', probe: 'red', terminal: undefined });
        // 空クリックと同じく「次は黒」に戻す（§9.1 / §9.3。M-5）
        store.setNextProbe('black');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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

  return (
    <>
      <SoundEffects />
      <Toolbar
        mode={mode}
        wireColor="青"
        allowedColors={[]}
        showWireTools={false}
        camera={camera}
        canUndo={false}
        canRedo={false}
        onMode={() => undefined}
        onWireColor={() => undefined}
        onCamera={(preset) => {
          useStore.getState().setCamera(preset);
        }}
        onUndo={() => undefined}
        onRedo={() => undefined}
        judging={judging}
        onJudge={() => {
          // 往復中は押させない（結果が返るか Worker が落ちるまで `judging` が立つ）。§8.2
          if (useStore.getState().judging) return;
          useStore.getState().setJudging(true);
          bridge.send({
            type: 'judgeParts',
            problem,
            answers: useStore.getState().answers,
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

      <div className={styles.sessionLayout}>
        <div className={styles.viewport} data-testid="viewport">
          <WarningBanner />
          <BoardScene onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
          <div className={styles.statusOverlay} data-testid="status-overlay">
            {powered ? JA.session.powered : JA.session.unpowered} /{' '}
            {checkPartId === undefined
              ? JA.inspectParts.tray
              : `${JA.inspectParts.mounted}: ${checkPartId}`}
            {tripped ? ` / ${JA.session.tripped}` : ''}
          </div>
          {/* 視点操作の早見表（Blender 風の割り当て）。§12.2 */}
          <div className={styles.viewHint} data-testid="view-hint">
            {JA.session.viewHint}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          <CheckTrayPanel
            problem={problem}
            checkPartId={checkPartId}
            onSelect={(partId) => {
              useStore.getState().setCheckPart(partId);
            }}
            onEject={() => {
              useStore.getState().setCheckPart(undefined);
            }}
          />
          <TesterPanel>
            <ProbeShortcuts />
          </TesterPanel>
          <DiagnosisHelp />
          <MarkSheetPanel
            problem={problem}
            answers={answers}
            onAnswer={(partId, answer) => {
              useStore.getState().setAnswer(partId, answer);
            }}
          />
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
