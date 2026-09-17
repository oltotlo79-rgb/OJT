import { describe, expect, it } from 'vitest';
import {
  C,
  compile,
  createPlcRuntime,
  ctu,
  endNetwork,
  network,
  no,
  out,
  program,
  rst,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  SPECIAL_CLOCK_1S,
  SPECIAL_FIRST_SCAN,
  T,
  ton,
  X,
  Y,
  type LadderProgram,
  type PlcRuntime,
} from '../src/index.js';
import {
  counterProgram,
  flickerProgram,
  oneShotProgram,
  onDelayProgram,
  rung,
  selfHoldProgram,
  TestIo,
} from './helpers/programs.js';

/** 入力操作列（スキャン番号 → 入力の変化）を与えて出力の履歴を取る。 */
function runSeries(
  source: LadderProgram,
  scanCount: number,
  operate: (io: TestIo, scanIndex: number) => void,
): boolean[][] {
  const io = new TestIo();
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(compiled.errors[0]?.message ?? '変換に失敗しました');
  const runtime = createPlcRuntime(compiled.program, { io, outputCount: 4 });
  for (let i = 0; i < scanCount; i += 1) {
    operate(io, i);
    runtime.scan();
  }
  return io.history;
}

/** 出力 n の ON 区間を [開始スキャン, 終了スキャン) の列にする。 */
function spans(history: readonly boolean[][], index: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  history.forEach((frame, i) => {
    const on = frame[index] ?? false;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, history.length]);
  return out;
}

describe('ゴールデン: 二重コイル（§14.1 #26 / §10.4）', () => {
  it('warns on conversion and lets the later network win', () => {
    const source = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      endNetwork(),
    );
    const compiled = compile(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.warnings.map((w) => w.code)).toEqual(['double-coil']);

    const io = new TestIo();
    const runtime = createPlcRuntime(compiled.program, { io });
    io.press(0);
    runtime.scan();
    // 後のネットワーク（X1 が OFF）が上書きするので Y0 は OFF のまま
    expect(io.outputs[0]).toBe(false);
    io.press(1);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.release(0);
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
  });
});

describe('ゴールデン: 特殊デバイス（§14.1 #27 / §10.3）', () => {
  it('keeps SP0 on, pulses SP1 once and toggles SP2 every 500 ms', () => {
    const history = runSeries(
      program(
        network('n1', [rung(no(SP(SPECIAL_ALWAYS_ON)), out(Y(0)))]),
        network('n2', [rung(no(SP(SPECIAL_FIRST_SCAN)), out(Y(1)))]),
        network('n3', [rung(no(SP(SPECIAL_CLOCK_1S)), out(Y(2)))]),
        endNetwork(),
      ),
      200,
      () => undefined,
    );
    expect(spans(history, 0)).toEqual([[0, 200]]);
    expect(spans(history, 1)).toEqual([[0, 1]]);
    expect(spans(history, 2)).toEqual([
      [0, 50],
      [100, 150],
    ]);
  });
});

describe('ゴールデン: 内蔵モードD課題が使うラダー', () => {
  it('self-hold: X0 で入り X1 で切れる', () => {
    const history = runSeries(selfHoldProgram(), 40, (io, i) => {
      if (i === 5) io.press(0);
      if (i === 8) io.release(0);
      if (i === 20) io.press(1);
      if (i === 23) io.release(1);
    });
    expect(spans(history, 0)).toEqual([[5, 20]]);
  });

  it('on-delay: X0 を押し続けると 3 秒（300スキャン）後に点く', () => {
    const history = runSeries(onDelayProgram(3000), 400, (io, i) => {
      if (i === 10) io.press(0);
      if (i === 13) io.release(0);
      if (i === 380) io.press(1);
    });
    // 添字10のスキャンで M0 が入り同じスキャンで計時開始（経過10ms）。300スキャン目＝添字309でタイムアップ
    expect(spans(history, 0)).toEqual([[309, 380]]);
  });

  it('one-shot: X0 の立上りで 1 秒だけ出力する', () => {
    const history = runSeries(oneShotProgram(1000), 200, (io, i) => {
      if (i === 10) io.press(0);
      if (i === 60) io.release(0);
    });
    // 添字10で SET、100スキャン目（添字109）に T0 がタイムアップし同じスキャンの n3 が RST する
    expect(spans(history, 0)).toEqual([[10, 109]]);
  });

  it('flicker: X0 の間だけ 0.5 秒周期で点滅する', () => {
    const history = runSeries(flickerProgram(500), 300, (io, i) => {
      if (i === 0) io.press(0);
      if (i === 220) io.release(0);
    });
    const onSpans = spans(history, 0);
    expect(onSpans.length).toBeGreaterThanOrEqual(2);
    for (const [from, to] of onSpans.slice(0, 2)) expect(to - from).toBe(50);
  });

  it('counter: 押した回数で Y0 → Y1 → Y2 の順に増える', () => {
    const history = runSeries(counterProgram(), 100, (io, i) => {
      if (i % 10 === 0) io.press(0);
      if (i % 10 === 2) io.release(0);
      if (i === 70) io.press(1);
      if (i === 72) io.release(1);
    });
    expect(history[9]?.slice(0, 3)).toEqual([true, false, false]);
    expect(history[19]?.slice(0, 3)).toEqual([true, true, false]);
    expect(history[29]?.slice(0, 3)).toEqual([true, true, true]);
    expect(history[75]?.slice(0, 3)).toEqual([false, false, false]);
  });

  it('timer contact is exactly one scan late, never early (§10.4)', () => {
    const history = runSeries(
      program(
        network('n1', [rung(no(X(0)), ton(T(0), 100))]),
        network('n2', [rung(no(T(0)), out(Y(0)))]),
        endNetwork(),
      ),
      40,
      (io, i) => {
        if (i === 0) io.press(0);
      },
    );
    // 1スキャン目に10ms加算され、10スキャン目で100msに達する。Y0はその同じスキャンで点く
    expect(spans(history, 0)).toEqual([[9, 40]]);
  });
});

describe('ゴールデン: タイマ・カウンタへの SET / RST（`setOrReset` の分岐）', () => {
  /** 操作列を与えず1スキャンずつ手で回すランタイム。 */
  function boot(source: LadderProgram): { io: TestIo; runtime: PlcRuntime } {
    const io = new TestIo();
    const compiled = compile(source);
    if (!compiled.ok) throw new Error(compiled.errors[0]?.message ?? '変換に失敗しました');
    return { io, runtime: createPlcRuntime(compiled.program, { io, outputCount: 4 }) };
  }

  it('SET T0 turns the timer contact on at once and holds it until RST (§10.4)', () => {
    // n1: X0 で T0 を SET、n2: X1 で T0 を RST、n3: T0 で Y0
    const { io, runtime } = boot(
      program(
        network('n1', [rung(no(X(0)), set(T(0)))]),
        network('n2', [rung(no(X(1)), rst(T(0)))]),
        network('n3', [rung(no(T(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    io.press(0);
    runtime.scan();
    io.release(0);
    // SET は接点だけを入れる（計時はしない）。同じスキャンの n3 が読むので Y0 も点く
    expect(runtime.bit(T(0))).toBe(true);
    expect(io.outputs[0]).toBe(true);
    expect(runtime.state().timers[0]?.elapsedMs).toBe(0);
    // 条件が落ちても SET なので保持される
    runtime.scan();
    expect(io.outputs[0]).toBe(true);
    io.press(1);
    runtime.scan();
    io.release(1);
    expect(runtime.bit(T(0))).toBe(false);
    expect(io.outputs[0]).toBe(false);
  });

  it('RST T0 also clears the time the timer has already counted', () => {
    // n1: X0 の間 T0 が計時（設定値1秒）、n2: X1 で T0 を RST
    const { io, runtime } = boot(
      program(
        network('n1', [rung(no(X(0)), ton(T(0), 1000))]),
        network('n2', [rung(no(X(1)), rst(T(0)))]),
        network('n3', [rung(no(T(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    io.press(0);
    for (let i = 0; i < 20; i += 1) runtime.scan();
    expect(runtime.state().timers[0]?.elapsedMs).toBe(200);
    // X0 を押したまま X1 を押す。n1 が 10ms 足した後に n2 の RST が 0 に戻す
    io.press(1);
    runtime.scan();
    expect(runtime.state().timers[0]?.elapsedMs).toBe(0);
    expect(runtime.bit(T(0))).toBe(false);
  });

  it('RST C0 clears both the counted value and the contact', () => {
    // n1: X0 の立上りで C0 を計数（設定値2・リセット入力は X2）、n2: X1 で C0 を RST、n3: C0 で Y0
    const { io, runtime } = boot(
      program(
        network('n1', [rung(no(X(0)), ctu(C(0), 2, X(2)))]),
        network('n2', [rung(no(X(1)), rst(C(0)))]),
        network('n3', [rung(no(C(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    const pulse = (): void => {
      io.press(0);
      runtime.scan();
      io.release(0);
      runtime.scan();
    };
    pulse();
    expect(runtime.state().counters[0]?.value).toBe(1);
    expect(io.outputs[0]).toBe(false);
    pulse();
    expect(runtime.state().counters[0]?.value).toBe(2);
    expect(io.outputs[0]).toBe(true);
    // RST は計数値も 0 に戻す（同じスキャンの n3 が読むので Y0 も落ちる）
    io.press(1);
    runtime.scan();
    io.release(1);
    expect(runtime.state().counters[0]?.value).toBe(0);
    expect(runtime.bit(C(0))).toBe(false);
    expect(io.outputs[0]).toBe(false);
  });
});
