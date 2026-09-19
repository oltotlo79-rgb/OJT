import {
  JIPM_BOARD,
  plcUnitFor,
  socketPartId,
  toNetlist,
  withPlcUnit,
  type BoardDefinition,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import {
  applyTesterAction,
  createRelay4c,
  createTesterState,
  createTimer4c,
  readTester,
  Simulation,
  stepTester,
  TESTER_NO_PROBE_DISPLAY,
  TESTER_OFF_DISPLAY,
  TICK_MS,
  type ChatterEvent,
  type HazardEvent,
  type LogEntry,
  type Part,
  type TesterReading,
  type TesterState,
} from '@ojt/circuit-sim';
import {
  createPlcCoupling,
  injectPartFaults,
  judgeAssemble,
  judgeInspectParts,
  judgeInspectRepair,
  judgePlc,
  verifySchematic,
  type FaultSpecData,
  type PlcCoupling,
} from '@ojt/content';
import { compile, IR_COLS, type CompiledProgram, type LadderProgram } from '@ojt/ladder-core';
import type { PlcMonitorSnapshot } from '../renderer/app/store-types.js';
import { planTicks } from './runtime.js';
import {
  SNAPSHOT_INTERVAL_MS,
  type LampSnapshot,
  type RelaySnapshot,
  type SimCommand,
  type SimMessage,
  type SimSnapshot,
  type TesterSnapshot,
  type TimerSnapshot,
} from './protocol.js';

/**
 * Simulation Worker。設計仕様 §4.3 / §5.2。
 * `circuit-sim` の `Simulation` を 10ms tick で回し、約30fpsでスナップショットを返す。
 * renderer のフレーム処理をブロックしない（§15 並行性）。
 *
 * 装着・取り外し・タイマ設定は `Simulation` の差分API（`mountPart` / `unmountPart` /
 * `setTimerPreset`）で当てる。`new Simulation()` で作り直すと `tMs`・信号ログ・イベントが
 * 消えてしまい、ライブのタイムチャートと危険操作の記録が途切れるため（§5.7 / §8.3）。
 */

let simulation: Simulation | undefined;
/**
 * `load()` で盤を作り直す前に持ち越す危険操作。C1の手順は部品を1つずつ挿し替えて
 * 最後にまとめて判定するため、`new Simulation()` が作り直されるたびに前の部品で
 * 起きた `hazards()` を捨ててはいけない（§5.6 / §8.3。C2のUndo/Redoの再読込も同様）。
 * 新しいセッション（`sessionEpoch` ごとに新しい Worker）や `reset` コマンドでは空に戻す。
 */
let carriedHazards: HazardEvent[] = [];
let session: BoardSession | undefined;
let baselineMs = 0;
let lastSnapshotMs = 0;
let logCursor = 0;
let hazardCursor = 0;
let chatterCursor = 0;
let droppedTicks = 0;
/** テスターの状態（つまみ・レンジ・プローブ・針）。§9.3 */
let tester: TesterState = createTesterState();
/** 直近の読値（スナップショットに載せる）。実測の間引きについては下記 `loop()` を参照（前提D）。 */
let testerReading: TesterReading = {
  kind: tester.kind,
  mode: tester.mode,
  value: Number.NaN,
  display: 'OFF',
  targetDeg: 0,
  overRange: false,
  live: false,
  conductive: false,
};
/** いま読んでいる盤（モードDは `withPlcUnit()` 済みの派生盤）。§10.1 */
let board: BoardDefinition = JIPM_BOARD;
/** スキャンとtickの結合（モードDでラダーを載せている間だけ存在する）。§10.4 */
let plcCoupling: PlcCoupling | undefined;
/** PLCが RUN 中か。STOP の間はスキャンを回さない。§10.6 */
let plcRunning = false;
/** モニタ（`F3`）中か。true の間だけスナップショットに `plc` を載せる。決定表#5 */
let plcMonitoring = false;
/** 直近の `stepTester()` 実測からの経過tick数。§9.3 / 前提D */
let ticksSinceTesterMeasure = 0;
/** つまみ・レンジ・プローブ・盤が変わって、次tickで即座に実測し直す必要があるか。 */
let testerDirty = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function post(message: SimMessage): void {
  self.postMessage(message);
}

/**
 * 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。
 * 部品の故障（C1/C2）はここで注入する。以後 `addWire` などの差分コマンドはネットリストの
 * 同じ実体に当たるので、故障は入れ直さなくてよい（`plug` だけは新しい部品を作る＝良品に
 * 差し替えるのと同じで、それが §9.2 の「部品交換」そのものになる）。
 */
function load(
  next: BoardSession,
  partFaults: readonly FaultSpecData[] = [],
  plcModel?: string,
): void {
  session = next;
  /*
   * モードDは机上のPLC本体と壁コンセントを持つ派生盤で解く（§10.1）。`withPlcUnit()` は
   * `id` を変えないので、`BoardSession.boardId` の照合も既存の差分コマンドもそのまま通る。
   * 未対応の機種はここで断る（renderer は課題の `plc.model` をそのまま送ってくる）。
   */
  if (plcModel === undefined) {
    board = JIPM_BOARD;
  } else {
    const unit = plcUnitFor(plcModel);
    if (unit === undefined) throw new Error(`未対応のPLC機種です: ${plcModel}`);
    board = withPlcUnit(JIPM_BOARD, unit);
  }
  const netlist = toNetlist(next, board);
  const issues = injectPartFaults(netlist, partFaults);
  if (issues.length > 0) {
    throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join(' / '));
  }
  carriedHazards =
    simulation === undefined ? [] : [...carriedHazards, ...simulation.events.hazards()];
  simulation = new Simulation(netlist, { tickMs: TICK_MS });
  logCursor = 0;
  hazardCursor = 0;
  chatterCursor = 0;
  // 盤を作り直したらラダーの結合も捨てる（新しい `Simulation` を指していないため）。§10.4
  plcCoupling = undefined;
  plcRunning = false;
  plcMonitoring = false;
  /*
   * 盤を作り直したらプローブは外す（前の盤の端子IDは新しいネットリストに無いかもしれない）。
   * **つまみとレンジは残す。** テスターは盤ではなく計器であり、C1では部品を挿し替えるたびに
   * `load` を送り直すので、そのたびにΩレンジへ回し直させるのは実機の手順と食い違う（§9.1）。
   * **0Ω調整も残る**（`applyTesterAction` の `place-probe` は校正を落とさない）。校正はレンジに
   * 対して行うものでプローブ位置とは独立なため。renderer 側の `clearProbes()` も同じ。
   */
  tester = applyTesterAction(
    applyTesterAction(tester, { type: 'place-probe', probe: 'red', terminal: undefined }),
    { type: 'place-probe', probe: 'black', terminal: undefined },
  );
  testerReading = readTester(simulation, tester);
  ticksSinceTesterMeasure = 0;
  testerDirty = true;
}

/** 装着した部品を circuit-sim の部品インスタンスにする。§6.6 */
function partFor(next: BoardSession, socketId: SocketId): Part | undefined {
  const mounted = next.mounted[socketId];
  if (mounted === undefined) return undefined;
  const id = socketPartId(next.socketRoles, socketId);
  return mounted.kind === 'relay-my4n'
    ? createRelay4c(id)
    : createTimer4c(id, mounted.presetMs, mounted.rangeMaxMs);
}

function lampsOf(sim: Simulation): Record<string, LampSnapshot> {
  const out: Record<string, LampSnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().lamps)) {
    out[id] = { level: runtime.level, volts: runtime.volts };
  }
  return out;
}

function relaysOf(sim: Simulation): Record<string, RelaySnapshot> {
  const out: Record<string, RelaySnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().relays)) {
    out[id] = {
      coilOn: runtime.coilOn,
      contactsOn: runtime.contactsOn,
      coilVolts: runtime.coilVolts,
    };
  }
  return out;
}

function timersOf(sim: Simulation): Record<string, TimerSnapshot> {
  const out: Record<string, TimerSnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().timers)) {
    out[id] = {
      powered: runtime.powered,
      elapsedMs: runtime.elapsedMs,
      presetMs: runtime.presetMs,
      timedOut: runtime.timedOut,
    };
  }
  return out;
}

/** 直近の読値と針の角度をスナップショットの形にする。§9.3 */
function testerSnapshot(): TesterSnapshot {
  return {
    kind: testerReading.kind,
    mode: testerReading.mode,
    value: testerReading.value,
    display: testerReading.display,
    targetDeg: testerReading.targetDeg,
    needleDeg: tester.needleDeg,
    overRange: testerReading.overRange,
    live: testerReading.live,
    conductive: testerReading.conductive,
  };
}

/**
 * ラダーを載せる。§10.4
 * 変換は renderer が済ませてから送ってくる（H-1）が、保険としてここでも `compile()` を通し、
 * 落ちたら**前のラダーを残したまま**理由だけ返す（ループは回り続けるので `fatal: false`）。
 */
function loadLadder(sim: Simulation, source: LadderProgram): void {
  const compiled = compile(source);
  if (!compiled.ok) {
    throw new Error(compiled.errors.map((e) => e.message).join(' / '));
  }
  plcCoupling = createPlcCoupling(sim, compiled.program, {
    outputCount: board.plcUnit?.spec.outputs.length ?? 0,
  });
}

/**
 * モニタのスナップショット。決定表#5
 * `poweredCells` の `Record<string, boolean>`（最大1,536件）を、ネットワーク1本＝
 * 「行 × 16列」を連ねた `'0110…'` の**文字列1本**へ畳む。renderer はこの文字列を
 * ネットワーク単位で購読するので、比較も再描画の判定も文字列1本で済む。
 */
/**
 * タイマの設定値（`presetMs`）。ランタイムの `PlcTimerState` は経過だけを持つので、
 * コンパイル済みラダーのタイマセルから読む（決定表#5 / Batch 3 レビュー M4）。
 */
function timerPresetsOf(program: CompiledProgram): Record<number, number> {
  const presets: Record<number, number> = {};
  for (const net of program.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind === 'timer') presets[cell.device.index] = cell.presetMs;
      }
    }
  }
  return presets;
}

function plcSnapshot(coupling: PlcCoupling): PlcMonitorSnapshot {
  const state = coupling.runtime.state();
  const powered: Record<string, string> = {};
  for (const net of coupling.runtime.program.networks) {
    if (net.isEnd) continue;
    let bits = '';
    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < IR_COLS; col += 1) {
        bits += state.poweredCells[`${net.id}:${row}:${col}`] === true ? '1' : '0';
      }
    }
    powered[net.id] = bits;
  }
  const presets = timerPresetsOf(coupling.runtime.program);
  return {
    scanCount: state.scanCount,
    tMs: state.tMs,
    powered,
    inputs: [...state.inputs],
    outputs: [...state.outputs],
    internals: { ...state.internals },
    timers: Object.fromEntries(
      Object.entries(state.timers).map(([index, value]) => [
        index,
        { ...value, presetMs: presets[Number(index)] ?? 0 },
      ]),
    ),
    counters: Object.fromEntries(
      Object.entries(state.counters).map(([index, value]) => [index, { ...value }]),
    ),
  };
}

function buildSnapshot(sim: Simulation): SimSnapshot {
  const state = sim.state();
  const entries = sim.log.entries();
  const logDelta: LogEntry[] = entries.slice(logCursor).map((e) => ({ ...e }));
  logCursor = entries.length;
  const hazards = sim.events.hazards();
  const hazardDelta: HazardEvent[] = hazards.slice(hazardCursor).map((e) => ({ ...e }));
  hazardCursor = hazards.length;
  const chatters = sim.events.chatters();
  const chatterDelta: ChatterEvent[] = chatters.slice(chatterCursor).map((e) => ({ ...e }));
  chatterCursor = chatters.length;
  return {
    tMs: state.tMs,
    breakerOn: state.breakerOn,
    switchOn: state.switchOn,
    powered: state.powered,
    tripped: state.tripped,
    sourceAmps: state.sourceAmps,
    buttons: { ...state.buttons },
    lamps: lampsOf(sim),
    relays: relaysOf(sim),
    timers: timersOf(sim),
    logDelta,
    hazardDelta,
    chatterDelta,
    tester: testerSnapshot(),
    // モニタ中だけ載せる（決定表#5）
    ...(plcMonitoring && plcCoupling !== undefined ? { plc: plcSnapshot(plcCoupling) } : {}),
    droppedTicks,
  };
}

/** 追従ループを止める（多重に張られないよう、必ずここを通す）。 */
function stopLoop(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

/**
 * 追従ループを張り直す。基準時刻を現在に引き直すので、止まっていた間の遅れは
 * 「捨てた tick」として数えない（判定などこちらの都合で止めた時間のため）。
 */
function resumeLoop(): void {
  stopLoop();
  baselineMs = performance.now();
  timer = setTimeout(loop, 4);
}

/**
 * 追従ループの1周期。`performance.now()` 基準で遅れぶんだけ進める（§5.2）。
 *
 * `Simulation.step()` は解けない回路で例外を投げうる（§13 #3）。素通しすると
 * `setTimeout` の連鎖がそこで切れ、renderer からは「スナップショットが凍ったまま
 * 理由が分からない」状態になる。ここで受け止めて**ループを畳み、理由を送り、
 * 最後の状態を1枚送る**（§13 #6。renderer は例外バナーから立て直せる）。
 */
function loop(): void {
  timer = undefined;
  const sim = simulation;
  if (sim === undefined) return;
  try {
    const now = performance.now();
    const plan = planTicks(now, baselineMs, TICK_MS);
    baselineMs = plan.nextBaselineMs;
    droppedTicks += plan.dropped;
    /*
     * 1tick ＝「回路を進める」→「必要なら測る」の順。§9.3 / 前提D
     * `stepTester()`（内部で `readTester()` が回路解析を行う）は1tickの回路更新より3桁重い
     * （前提D。実端子数156の実盤でDCV/Ωいずれのモードでも0.4〜0.8ms）。renderer への描画も
     * スナップショット（`SNAPSHOT_INTERVAL_MS` = 33ms）でしか動かないので、実測を間引いても
     * 見た目は変わらない:
     * ① つまみOFF、またはプローブが片方でも未配置なら `stepTester()` を呼ばない
     *    （測る対象が無い。既定表示に戻すだけで、針は直近の位置のまま止まる）。
     * ② それ以外は `SNAPSHOT_INTERVAL_MS` ごと、またはつまみ・レンジ・プローブ・盤を
     *    変えた直後（`testerDirty`）だけ実測し直す。`stepTester()` に渡す `dtMs` を
     *    「前回実測からの経過tick数 × TICK_MS」にすることで、時定数100msの指数移動平均は
     *    経過時間どおりに進む（10msごとに3回進めるのと数学的に等価。指数減衰の合成則）。
     * `range-exceeded` は実測した tick の `sim.events` に流れる（`hazardDelta` にそのまま乗る）。
     */
    for (let i = 0; i < plan.ticks; i += 1) {
      /*
       * 1 tick ＝ 1 スキャン（§10.4 / 3A 決定表#4）。順序は
       * 「①`runtime.scan()` が `sim.plcInputs()` で入力を読む（＝直前のtickの解）
       *  →②ネットワークを上から順に実行 →③`sim.setPlcOutputs()` でY接点を書く」
       * のあとに `sim.step()` が今tickの回路を解く。実機と同じく入力は1スキャンぶん遅れる。
       */
      if (plcRunning && plcCoupling !== undefined) plcCoupling.beforeTick(sim, sim.tMs);
      sim.step(TICK_MS);
      ticksSinceTesterMeasure += 1;
      const measurable =
        tester.mode !== 'off' && tester.black !== undefined && tester.red !== undefined;
      if (!measurable) {
        /*
         * 測れなくても**つまみの現在位置は出す**。直前の読値をそのまま写すと、実測を挟まずに
         * 種別・レンジを回した間は古い `kind` / `mode` がスナップショットに残り、画面の
         * テスターが実際のつまみと食い違う（Plan 2B Batch 1 レビュー）。
         * 読値まわり（値・目標角・振り切れ・活線・導通）は測っていないので全部倒す。
         * 針（`tester.needleDeg`）だけは直近の位置のまま止まる。
         */
        testerReading = {
          kind: tester.kind,
          mode: tester.mode,
          value: Number.NaN,
          targetDeg: 0,
          display: tester.mode === 'off' ? TESTER_OFF_DISPLAY : TESTER_NO_PROBE_DISPLAY,
          overRange: false,
          live: false,
          conductive: false,
        };
        // 測れない間は経過tickを積み増さない。再開後の最初の実測が古いdtで一気に収束しないように
        ticksSinceTesterMeasure = 0;
        continue;
      }
      if (testerDirty || ticksSinceTesterMeasure * TICK_MS >= SNAPSHOT_INTERVAL_MS) {
        const stepped = stepTester(sim, tester, ticksSinceTesterMeasure * TICK_MS);
        tester = stepped.state;
        testerReading = stepped.reading;
        ticksSinceTesterMeasure = 0;
        testerDirty = false;
      }
    }
    if (now - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
      lastSnapshotMs = now;
      post({ type: 'snapshot', snapshot: buildSnapshot(sim) });
    }
    timer = setTimeout(loop, 4);
  } catch (cause) {
    post({
      type: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
      fatal: true,
    });
    stopLoop();
    try {
      post({ type: 'snapshot', snapshot: buildSnapshot(sim) });
    } catch {
      // 最後の1枚すら作れないなら諦める（エラーは既に送ってある）
    }
  }
}

function start(): void {
  lastSnapshotMs = 0;
  droppedTicks = 0;
  resumeLoop();
}

function handle(command: SimCommand): void {
  if (command.type === 'load') {
    load(command.session, command.partFaults ?? [], command.plcModel);
    start();
    return;
  }
  const sim = simulation;
  if (sim === undefined) throw new Error('課題が読み込まれていません');
  switch (command.type) {
    case 'addWire': {
      /*
       * 上限（1端子2本）を超える電線は `Simulation` が**入れずに**危険操作
       * `over-wires-per-terminal` を発行して false を返す（§5.6 #5）。
       * renderer は断られた電線もここへ送ってくるので、戻り値を見て控えを合わせる。
       */
      const added = sim.addWire(command.wire);
      if (added && session !== undefined) session.wires.push(command.wire);
      break;
    }
    case 'removeWire':
      sim.removeWire(command.wireId);
      if (session !== undefined) {
        session.wires = session.wires.filter((w) => w.id !== command.wireId);
      }
      break;
    case 'plug': {
      // 差分で当てるので tMs・ログ・イベントは切れない
      const part = partFor(command.session, command.socketId);
      if (part !== undefined) sim.mountPart(part);
      session = command.session;
      break;
    }
    case 'unplug':
      sim.unmountPart(command.partId);
      session = command.session;
      break;
    case 'setPreset':
      sim.setTimerPreset(command.partId, command.presetMs);
      session = command.session;
      break;
    case 'press':
      sim.press(command.pbId);
      break;
    case 'release':
      sim.release(command.pbId);
      break;
    case 'breaker':
      sim.setBreaker(command.on);
      break;
    case 'switch':
      sim.setSwitch(command.on);
      break;
    case 'reset':
      // 時刻・ログ・イベント・保護状態を初期化する（課題のやり直し）
      sim.reset();
      plcCoupling?.runtime.reset();
      logCursor = 0;
      hazardCursor = 0;
      chatterCursor = 0;
      carriedHazards = [];
      start();
      break;
    case 'resetTrip':
      // §5.1.1 の復帰手順そのもの: スイッチOFF → ブレーカOFF → ブレーカON → スイッチON
      sim.setSwitch(false);
      sim.setBreaker(false);
      sim.setBreaker(true);
      sim.setSwitch(true);
      break;
    case 'tester':
      /*
       * つまみ・レンジ・プローブ・0Ω調整。状態の更新は Plan 2A のリデューサ1本に任せる。
       * 読値の更新は次の tick の `loop()` が行うので、ここでは測らない
       * （ここで測ると1tickに2回測ることになり、`ohm-on-live` が二重に計上される）。
       * `testerDirty` を立てて、次tickで間引かずに即座に実測させる（前提D）。
       */
      tester = applyTesterAction(tester, command.action);
      testerDirty = true;
      break;
    case 'plc': {
      const action = command.action;
      if (action.kind === 'load') {
        loadLadder(sim, action.program);
        break;
      }
      if (action.kind === 'run') {
        plcRunning = action.on;
        if (!action.on) {
          /*
           * STOP はPLCのデバイスを初期化する。`runtime.reset()` は `io.writeOutputs()` も
           * 呼ぶので（3A 引渡し表）Y接点が開く。盤に反映するために1tick進める。
           */
          plcCoupling?.runtime.reset();
          sim.step(TICK_MS);
        }
        break;
      }
      if (action.kind === 'monitor') {
        plcMonitoring = action.on;
        break;
      }
      if (action.kind === 'reset') {
        plcCoupling?.runtime.reset();
        sim.step(TICK_MS);
        break;
      }
      action satisfies never;
      break;
    }
    case 'judgePlc': {
      /*
       * 模範と訓練者の2回ぶんを最後まで回すので 0.3〜1 秒かかる（H-4）。判定中にループを
       * 回したままにすると `MAX_CATCHUP_TICKS`（200ms相当）の窓を超え、訓練者が何もして
       * いないのに「捨てた tick」が計上される。`judgeRepair` と同じ扱いにする。
       */
      stopLoop();
      try {
        const outcome = judgePlc(command.problem, JIPM_BOARD, command.session, command.ladder, {
          elapsedMs: command.elapsedMs,
          sessionHazards: [...carriedHazards, ...sim.events.hazards()],
        });
        post({
          type: 'plcResult',
          result: outcome.ok
            ? { ok: true, value: outcome.value }
            : { ok: false, errors: outcome.errors },
        });
      } finally {
        resumeLoop();
      }
      break;
    }
    case 'judge': {
      /*
       * 判定は模範回路と訓練者回路を丸ごと並走させるので 240〜440ms かかる（§8.3）。
       * その間ループを回したままにすると `MAX_CATCHUP_TICKS`（200ms相当）の窓を超え、
       * 訓練者が何もしていないのに「捨てた tick」が計上されてしまう。
       * 判定中は止め、終わったら基準時刻を引き直して再開する（UI は結果画面へ移る）。
       */
      stopLoop();
      try {
        const result = judgeAssemble(command.problem, JIPM_BOARD, command.session, {
          elapsedMs: command.elapsedMs,
          sessionHazards: [...carriedHazards, ...sim.events.hazards()],
        });
        post({ type: 'judgeResult', result });
      } finally {
        resumeLoop();
      }
      break;
    }
    case 'verify': {
      /*
       * 検算は模範回路と訓練者の**回路図**を並走させるので、判定とほぼ同じ 0.3〜0.6 秒かかる
       * （§11.4 / 決定表#4）。`judge` と同じく、その間は追従ループを止めて「捨てた tick」を
       * 誤って計上しない。危険操作（`sessionHazards`）は渡さない（机上の作業に危険操作は
       * 無い。決定表#6）。例外は `self.onmessage` の `catch` が `{ type: 'error', fatal: false }`
       * として返すので、検算が失敗してもセッションは続く。
       */
      stopLoop();
      try {
        const result = verifySchematic(command.problem, JIPM_BOARD, command.document, {
          elapsedMs: command.elapsedMs,
        });
        post({ type: 'verifyResult', result });
      } finally {
        resumeLoop();
      }
      break;
    }
    case 'judgeParts': {
      /*
       * C1の採点は解答の突き合わせだけなので速いが、危険操作の回数（§5.6）は
       * `sim.events.hazards()` にしか無いので Worker で判定する（モードBと同じ流儀）。
       */
      const result = judgeInspectParts(command.problem, command.answers, {
        elapsedMs: command.elapsedMs,
        sessionHazards: [...carriedHazards, ...sim.events.hazards()],
      });
      post({ type: 'inspectResult', result: { ok: true, value: result } });
      break;
    }
    case 'judgeRepair': {
      /*
       * C2の判定は模範回路と訓練者の盤を並走させるので 200〜850ms かかる（§8.3。レビュー実測）。
       * モードBの `judge` と同じく、その間は追従ループを止めて「捨てた tick」を
       * 誤って計上しないようにする（C1の `judgeParts` は突き合わせだけなので止めない）。
       */
      stopLoop();
      try {
        const outcome = judgeInspectRepair(
          command.problem,
          JIPM_BOARD,
          command.circuit,
          command.reports,
          {
            elapsedMs: command.elapsedMs,
            sessionHazards: [...carriedHazards, ...sim.events.hazards()],
          },
        );
        post({
          type: 'inspectResult',
          result: outcome.ok
            ? { ok: true, value: outcome.value }
            : { ok: false, errors: outcome.errors },
        });
      } finally {
        resumeLoop();
      }
      break;
    }
  }
}

self.onmessage = (event: MessageEvent<SimCommand>): void => {
  try {
    handle(event.data);
  } catch (cause) {
    /*
     * コマンド1件が失敗しただけならループは回り続けるのでトーストで足りる（§13 #6）。
     * ただし `load` の失敗（盤の食い違い・壊れた保存データ）は別で、盤を読み込めていないので
     * 以後どのコマンドも通らない＝実質止まっている。ループを止めて致命扱いにし、
     * renderer に例外バナー（「セッションをリセット」「課題一覧へ戻る」）を出させる（§13 #5）。
     */
    const fatal = event.data.type === 'load';
    if (fatal) stopLoop();
    post({
      type: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
      fatal,
    });
  }
};
