import { describe, expect, it } from 'vitest';
import {
  COIL_COL,
  compile,
  createPlcRuntime,
  empty,
  endNetwork,
  hline,
  IR_COLS,
  M,
  network,
  no,
  out,
  program,
  rise,
  SCAN_MS,
  SP,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  X,
  Y,
  type LadderProgram,
  type PlcRuntime,
} from '../src/index.js';
import {
  counterProgram,
  fallProgram,
  flickerProgram,
  interlockProgram,
  masterControlProgram,
  oneShotProgram,
  onDelayProgram,
  rung,
  selfHoldProgram,
  stopPriorityProgram,
  TestIo,
} from './helpers/programs.js';

/** プログラムを変換してランタイムを作る（変換に失敗したらテストを落とす）。 */
function boot(source: LadderProgram, io: TestIo, recordPowered = true): PlcRuntime {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(`変換に失敗しました: ${compiled.errors[0]?.message ?? ''}`);
  return createPlcRuntime(compiled.program, { io, recordPowered });
}

/**
 * 通電記録を `Record` として読む。`state()` の複製から `runtime.poweredCells`（その場の
 * 見え方）へ移した（指摘 DW-1 ≡ LE-11 ③）ので、検査の書き方だけここで吸収する。
 */
function poweredOf(runtime: PlcRuntime): Record<string, boolean> {
  return Object.fromEntries(runtime.poweredCells);
}

/** n スキャン進める。 */
function scans(runtime: PlcRuntime, count: number): void {
  for (let i = 0; i < count; i += 1) runtime.scan();
}

describe('createPlcRuntime（自己保持・インターロック・停止優先）', () => {
  it('holds Y0 after X0 is released and drops it on X1 (§14.1 #5 相当)', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.release(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.press(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
    io.release(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('never lets both outputs run at once (§14.1 #6 相当)', () => {
    const io = new TestIo();
    const runtime = boot(interlockProgram(), io);
    io.press(0);
    scans(runtime, 2);
    expect([io.outputs[0], io.outputs[1]]).toEqual([true, false]);
    io.release(0);
    io.press(1);
    scans(runtime, 2);
    expect([io.outputs[0], io.outputs[1]]).toEqual([true, false]);
    io.release(1);
    io.press(2);
    scans(runtime, 2);
    io.release(2);
    io.press(1);
    scans(runtime, 2);
    expect([io.outputs[0], io.outputs[1]]).toEqual([false, true]);
  });

  it('gives the stop button priority when both are pressed', () => {
    const io = new TestIo();
    const runtime = boot(stopPriorityProgram(), io);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.press(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });
});

describe('createPlcRuntime（タイマ・カウンタ）', () => {
  it('turns the timer contact on exactly at the preset (§10.4)', () => {
    const io = new TestIo();
    const runtime = boot(onDelayProgram(3000), io);
    io.press(0);
    // n1 で M0 を書き、同じスキャンの n2 のタイマがそれを読む。よって 300スキャン目で 3000ms に届く
    scans(runtime, 299);
    expect(io.outputs[0]).toBe(false);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(3000);
  });

  it('resets the timer the moment its condition drops (PLCタイマに復帰時間は無い)', () => {
    const io = new TestIo();
    const runtime = boot(onDelayProgram(3000), io);
    io.press(0);
    scans(runtime, 100);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(1000);
    io.press(1);
    runtime.scan();
    io.release(1);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(0);
    expect(runtime.bit(T(0))).toBe(false);
  });

  it('flickers with a 0.5 s half period while X0 is held', () => {
    const io = new TestIo();
    const runtime = boot(flickerProgram(500), io);
    io.press(0);
    const seen: boolean[] = [];
    for (let i = 0; i < 200; i += 1) {
      runtime.scan();
      seen.push(io.outputs[0] ?? false);
    }
    const transitions = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    // 2秒間（200スキャン）で 0.5秒ごとに反転するので3回前後
    expect(transitions).toBeGreaterThanOrEqual(3);
    expect(transitions).toBeLessThanOrEqual(4);
    io.release(0);
    scans(runtime, 60);
    expect(io.outputs[0]).toBe(false);
  });

  it('counts the rising edges of X0 and resets on X1 (§17.2 #8)', () => {
    const io = new TestIo();
    const runtime = boot(counterProgram(), io);
    const press = (): void => {
      io.press(0);
      runtime.scan();
      io.release(0);
      runtime.scan();
    };
    press();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, false, false]);
    press();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, true, false]);
    press();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, true, true]);
    expect(runtime.state().counters[0]?.value).toBe(3);
    io.press(1);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([false, false, false]);
    expect(runtime.state().counters[2]?.value).toBe(0);
  });
});

describe('createPlcRuntime（微分・SET/RST・特殊デバイス・MC）', () => {
  it('conducts a rising-edge contact for exactly one scan', () => {
    const io = new TestIo();
    const runtime = boot(program(network('n1', [rung(rise(X(0)), out(Y(0)))]), endNetwork()), io);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
    io.release(0);
    io.press(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('conducts a falling-edge contact for exactly one scan', () => {
    const io = new TestIo();
    const runtime = boot(fallProgram(), io);
    io.press(0);
    scans(runtime, 2);
    expect(io.outputs[0]).toBe(false);
    io.release(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('holds SET until RST fires (§10.4)', () => {
    const io = new TestIo();
    const runtime = boot(oneShotProgram(1000), io);
    io.press(0);
    runtime.scan();
    io.release(0);
    expect(io.outputs[0]).toBe(true);
    // 1スキャン目で M0 が入り経過10ms。98スキャン追加で経過990ms（まだタイムアップしない）
    scans(runtime, 98);
    expect(io.outputs[0]).toBe(true);
    // 100スキャン目で経過1000ms → 同じスキャンの n3 が RST するので Y0 は落ちる
    runtime.scan();
    expect(io.outputs[0]).toBe(false);
  });

  it('drives the three special devices (§10.3 / §14.1 #27)', () => {
    const io = new TestIo();
    const source = program(
      network('n1', [rung(no(SP(0)), out(Y(0)))]),
      network('n2', [rung(no(SP(SPECIAL_FIRST_SCAN)), out(Y(1)))]),
      network('n3', [rung(no(SP(SPECIAL_CLOCK_1S)), out(Y(2)))]),
      endNetwork(),
    );
    const runtime = boot(source, io);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, true, true]);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1], io.outputs[2]]).toEqual([true, false, true]);
    // bit() はスキャン開始時点の elapsedMs を読むので、500ms に達した次のスキャンで反転する
    scans(runtime, 49); // 合計51スキャン（開始時 500ms）
    expect(io.outputs[2]).toBe(false);
    scans(runtime, 50); // 合計101スキャン（開始時 1000ms）
    expect(io.outputs[2]).toBe(true);
  });

  it('turns the MC region off but keeps SET outside it (§10.3)', () => {
    const io = new TestIo();
    const runtime = boot(masterControlProgram(), io);
    io.press(0);
    io.press(1);
    runtime.scan();
    expect([io.outputs[0], io.outputs[1]]).toEqual([true, true]);
    io.release(0);
    runtime.scan();
    // 区間が非成立になると OUT は落ちるが、SET で保持した M1 は残る
    expect([io.outputs[0], io.outputs[1]]).toEqual([false, true]);
  });
});

describe('createPlcRuntime（状態・決定論）', () => {
  it('reports the scan count and the elapsed time', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    scans(runtime, 3);
    expect(runtime.scanCount).toBe(3);
    expect(runtime.tMs).toBe(3 * SCAN_MS);
    expect(runtime.state().scanCount).toBe(3);
  });

  it('clears every device on reset and writes the cleared outputs out (§10.4 の RUN停止・リセット)', () => {
    const io = new TestIo();
    const runtime = boot(oneShotProgram(1000), io);
    io.press(0);
    scans(runtime, 5);
    expect(runtime.bit(M(0))).toBe(true);
    expect(io.outputs[0]).toBe(true);
    runtime.reset();
    expect(runtime.bit(M(0))).toBe(false);
    expect(runtime.tMs).toBe(0);
    expect(runtime.scanCount).toBe(0);
    expect(runtime.state().timers[0]?.elapsedMs ?? 0).toBe(0);
    expect(runtime.poweredCells.size).toBe(0);
    // reset() は `writeOutputs()` も呼ぶので、外側（`Simulation`）のY接点も開く
    expect(io.outputs[0]).toBe(false);
  });

  it('records which cells are energized so the 3B monitor can colour them (§10.7)', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    runtime.scan();
    // X0 を押していないので、通電しているのは 0列目（X0のa接点）の左だけ
    expect(poweredOf(runtime)['n1:0:0']).toBe(true);
    expect(poweredOf(runtime)['n1:0:1']).toBe(false);
    io.press(0);
    runtime.scan();
    const cells = poweredOf(runtime);
    // 導通したので X0 の右（縦線）から右のコイル列まで通電する
    expect(cells['n1:0:1']).toBe(true);
    expect(cells[`n1:0:${COIL_COL}`]).toBe(true);
    // 自己保持の分岐（2行目）も縦線でつながる
    expect(cells['n1:1:1']).toBe(true);
  });

  it('drops the cells behind an open contact and never records the END network', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io);
    io.press(0);
    io.press(1); // 停止（b接点が開く）
    runtime.scan();
    const cells = poweredOf(runtime);
    expect(cells['n1:0:1']).toBe(true); // X0 は導通している
    expect(cells['n1:0:3']).toBe(false); // X1 の b接点で切れる
    expect(cells[`n1:0:${COIL_COL}`]).toBe(false);
    expect(Object.keys(cells).some((key) => key.startsWith('end:'))).toBe(false);
  });

  it('KNOWN QUIRK: an empty column-0 cell on a blank row is never reported as powered (M4)', () => {
    const io = new TestIo();
    const p = program(
      network('n1', [
        [...Array.from({ length: IR_COLS - 1 }, () => hline()), out(Y(0))],
        Array.from({ length: IR_COLS }, () => empty()),
      ]),
      endNetwork(),
    );
    const runtime = boot(p, io);
    runtime.scan();
    const cells = poweredOf(runtime);
    // 行0は無条件導通（横線だけ）なので通電するが、行1は何も置かれていない
    // 空行で、左母線には実配線どおり繋がる（solve() は変えない）が、モニタ表示では
    // 浮いた青い節に見えないよう false を報告する。
    expect(cells['n1:0:0']).toBe(true);
    expect(cells['n1:1:0']).toBe(false);
  });

  it('produces the same output series twice for the same input series (§5.2 の決定論)', () => {
    const run = (): boolean[][] => {
      const io = new TestIo();
      const runtime = boot(counterProgram(), io);
      for (let i = 0; i < 40; i += 1) {
        if (i % 7 === 0) io.press(0);
        if (i % 7 === 3) io.release(0);
        if (i === 30) io.press(1);
        if (i === 32) io.release(1);
        runtime.scan();
      }
      return io.history;
    };
    expect(run()).toEqual(run());
  });

  it('recordPowered: false でも出力・タイマ・カウンタの結果が同一（指摘 LE-11。決定論）', () => {
    const run = (recordPowered: boolean): { history: boolean[][]; state: unknown } => {
      const io = new TestIo();
      const runtime = boot(counterProgram(), io, recordPowered);
      for (let i = 0; i < 40; i += 1) {
        if (i % 7 === 0) io.press(0);
        if (i % 7 === 3) io.release(0);
        if (i === 30) io.press(1);
        if (i === 32) io.release(1);
        runtime.scan();
      }
      return { history: io.history, state: runtime.state() };
    };
    const off = run(false);
    const on = run(true);
    expect(off.history).toEqual(on.history);
    // `state()` は通電記録を持たないので、出力・タイマ・カウンタがそのまま比べられる
    expect(off.state).toEqual(on.state);
  });

  it('recordPowered: false のあいだは通電セルを1件も作らない（指摘 DW-1 ①）', () => {
    const io = new TestIo();
    const runtime = boot(selfHoldProgram(), io, false);
    io.press(0);
    scans(runtime, 3);
    expect(runtime.bit(Y(0))).toBe(true); // 実行そのものは変わらない
    expect(runtime.poweredCells.size).toBe(0);
    // モニタを開いたら次のスキャンから記録が始まる
    runtime.setRecordPowered(true);
    runtime.scan();
    expect(poweredOf(runtime)[`n1:0:${COIL_COL}`]).toBe(true);
    // 閉じたら捨てる（古い通電が次に開いた瞬間だけ見えるのを防ぐ）
    runtime.setRecordPowered(false);
    expect(runtime.poweredCells.size).toBe(0);
  });

  it('rejects a coil that writes an input device at compile time (coil-on-read-only-device)', () => {
    const result = compile(program(network('n1', [rung(no(SP(0)), out(X(0)))]), endNetwork()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain('coil-on-read-only-device');
  });
});
