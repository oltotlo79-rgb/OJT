import {
  C,
  ctu,
  endNetwork,
  fall,
  hline,
  IR_COLS,
  M,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rise,
  rst,
  set,
  SP,
  SPECIAL_ALWAYS_ON,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
  type LadderProgram,
  type PlcIoPort,
} from '../../src/index.js';

/** 最後のセルをコイル列に置き、手前を横線で埋めた1行を作る。 */
export function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** 入力を差し替えられ、出力を覚えておく `PlcIoPort`。 */
export class TestIo implements PlcIoPort {
  inputs: boolean[];
  outputs: boolean[] = [];
  readonly history: boolean[][] = [];

  constructor(inputCount = 4) {
    this.inputs = Array.from({ length: inputCount }, () => false);
  }

  readInputs(): readonly boolean[] {
    return this.inputs;
  }

  writeOutputs(values: readonly boolean[]): void {
    this.outputs = [...values];
    this.history.push([...values]);
  }

  press(index: number): void {
    this.inputs[index] = true;
  }

  release(index: number): void {
    this.inputs[index] = false;
  }
}

/** 自己保持: X0で起動、X1で停止、Y0が自分を保持する。 */
export function selfHoldProgram(): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(Y(0)),
      ],
      [no(Y(0))],
    ]),
    endNetwork(),
  );
}

/** インターロック: X0でY0、X1でY1、互いのコイルのb接点で排他、X2で両方停止。 */
export function interlockProgram(): LadderProgram {
  const branch = (start: number, other: number, coil: number): Cell[][] => [
    [
      no(X(start)),
      vline(),
      nc(X(2)),
      nc(Y(other)),
      ...Array.from({ length: IR_COLS - 5 }, () => hline()),
      out(Y(coil)),
    ],
    [no(Y(coil))],
  ];
  return program(network('n1', branch(0, 1, 0)), network('n2', branch(1, 0, 1)), endNetwork());
}

/** ONディレー: X0を押している間 T0 が計時し、3秒でY0が点く。X1で停止。 */
export function onDelayProgram(presetMs = 3000): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(M(0)),
      ],
      [no(M(0))],
    ]),
    network('n2', [rung(no(M(0)), ton(T(0), presetMs))]),
    network('n3', [rung(no(T(0)), out(Y(0)))]),
    endNetwork(),
  );
}

/** ワンショット: X0の立上りでM0をSETし、T0（1秒）でRSTする。Y0はM0に従う。 */
export function oneShotProgram(presetMs = 1000): LadderProgram {
  return program(
    network('n1', [rung(rise(X(0)), set(M(0)))]),
    network('n2', [rung(no(M(0)), ton(T(0), presetMs))]),
    network('n3', [rung(no(T(0)), rst(M(0)))]),
    network('n4', [rung(no(M(0)), out(Y(0)))]),
    endNetwork(),
  );
}

/** フリッカ: X0の間、T0/T1が交互に計時してY0が0.5秒周期で点滅する。 */
export function flickerProgram(halfMs = 500): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), nc(T(1)), ton(T(0), halfMs))]),
    network('n2', [rung(no(T(0)), ton(T(1), halfMs))]),
    network('n3', [rung(no(X(0)), no(T(0)), out(Y(0)))]),
    endNetwork(),
  );
}

/** カウンタ: X0を押した回数で Y0→Y1→Y2 が順に点く。X1でリセット。 */
export function counterProgram(): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), ctu(C(0), 1, X(1)))]),
    network('n2', [rung(no(X(0)), ctu(C(1), 2, X(1)))]),
    network('n3', [rung(no(X(0)), ctu(C(2), 3, X(1)))]),
    network('n4', [rung(no(C(0)), out(Y(0)))]),
    network('n5', [rung(no(C(1)), out(Y(1)))]),
    network('n6', [rung(no(C(2)), out(Y(2)))]),
    endNetwork(),
  );
}

/** 停止優先: X0で起動、X1で停止（停止が直列で後ろにあるので同時押しでは停止が勝つ）。 */
export function stopPriorityProgram(): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(Y(0)),
      ],
      [no(Y(0))],
    ]),
    network('n2', [rung(no(X(2)), out(Y(3)))]),
    endNetwork(),
  );
}

/** 常時ONとMC/MCRの確認用。X0が区間の条件。 */
export function masterControlProgram(): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), mc(M(9)))]),
    network('n2', [rung(no(SP(SPECIAL_ALWAYS_ON)), out(Y(0)))]),
    network('n3', [rung(no(X(1)), set(M(1)))]),
    network('n4', [rung(no(SP(SPECIAL_ALWAYS_ON)), mcr(M(9)))]),
    network('n5', [rung(no(M(1)), out(Y(1)))]),
    endNetwork(),
  );
}

/** 立下り微分の確認用。 */
export function fallProgram(): LadderProgram {
  return program(network('n1', [rung(fall(X(0)), out(Y(0)))]), endNetwork());
}
