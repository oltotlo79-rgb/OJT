import {
  JIPM_BOARD,
  socketPartId,
  toNetlist,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import {
  createRelay4c,
  createTimer4c,
  Simulation,
  TICK_MS,
  type ChatterEvent,
  type HazardEvent,
  type LogEntry,
  type Part,
} from '@ojt/circuit-sim';
import { judgeAssemble } from '@ojt/content';
import { planTicks } from './runtime.js';
import {
  SNAPSHOT_INTERVAL_MS,
  type LampSnapshot,
  type RelaySnapshot,
  type SimCommand,
  type SimMessage,
  type SimSnapshot,
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
let session: BoardSession | undefined;
let baselineMs = 0;
let lastSnapshotMs = 0;
let logCursor = 0;
let hazardCursor = 0;
let chatterCursor = 0;
let droppedTicks = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function post(message: SimMessage): void {
  self.postMessage(message);
}

/** 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。 */
function load(next: BoardSession): void {
  session = next;
  simulation = new Simulation(toNetlist(next, JIPM_BOARD), { tickMs: TICK_MS });
  logCursor = 0;
  hazardCursor = 0;
  chatterCursor = 0;
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
    droppedTicks,
  };
}

/** 追従ループの1周期。`performance.now()` 基準で遅れぶんだけ進める（§5.2）。 */
function loop(): void {
  timer = undefined;
  const sim = simulation;
  if (sim === undefined) return;
  const now = performance.now();
  const plan = planTicks(now, baselineMs, TICK_MS);
  baselineMs = plan.nextBaselineMs;
  droppedTicks += plan.dropped;
  for (let i = 0; i < plan.ticks; i += 1) sim.step(TICK_MS);
  if (now - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotMs = now;
    post({ type: 'snapshot', snapshot: buildSnapshot(sim) });
  }
  timer = setTimeout(loop, 4);
}

function start(): void {
  baselineMs = performance.now();
  lastSnapshotMs = 0;
  droppedTicks = 0;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(loop, 4);
}

function handle(command: SimCommand): void {
  if (command.type === 'load') {
    load(command.session);
    start();
    return;
  }
  const sim = simulation;
  if (sim === undefined) throw new Error('課題が読み込まれていません');
  switch (command.type) {
    case 'addWire':
      sim.addWire(command.wire);
      if (session !== undefined) session.wires.push(command.wire);
      break;
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
      sim.setTimerPreset(command.role, command.presetMs);
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
      logCursor = 0;
      hazardCursor = 0;
      chatterCursor = 0;
      start();
      break;
    case 'resetTrip':
      // §5.1.1 の復帰手順そのもの: スイッチOFF → ブレーカOFF → ブレーカON → スイッチON
      sim.setSwitch(false);
      sim.setBreaker(false);
      sim.setBreaker(true);
      sim.setSwitch(true);
      break;
    case 'judge': {
      const result = judgeAssemble(command.problem, JIPM_BOARD, command.session, {
        elapsedMs: command.elapsedMs,
        sessionHazards: sim.events.hazards(),
      });
      post({ type: 'judgeResult', result });
      break;
    }
  }
}

self.onmessage = (event: MessageEvent<SimCommand>): void => {
  try {
    handle(event.data);
  } catch (cause) {
    post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) });
  }
};
