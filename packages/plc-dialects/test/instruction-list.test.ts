import {
  C,
  ctu,
  empty,
  endNetwork,
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
  set,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
  type LadderProgram,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  instructionList,
  INSTRUCTION_LIST_MESSAGES,
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
  type DialectProfile,
} from '../src/index.js';

/** 行の末尾までを横線で埋めて出力セルをコイル列に置く。 */
function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

/** `count` 個の横線。 */
function hlines(count: number): Cell[] {
  return Array.from({ length: count }, () => hline());
}

/** 自己保持（X0 で入り X1 で切れる）。内蔵課題 d-001 の n1 と同じ形。 */
const selfHold = program(
  network('n1', [rung(no(X(0)), vline(), nc(X(1)), out(Y(0))), [no(Y(0))]], {
    comment: '自己保持',
  }),
  endNetwork(),
);

const mnemonics = (profile: DialectProfile, source: LadderProgram): string[] =>
  instructionList(source, profile).lines.map((line) => `${line.mnemonic} ${line.operand}`.trim());

describe('instructionList（§10.7 / §16 Phase 4 受入基準⑥）', () => {
  it('turns a self-holding rung into the textbook Mitsubishi list', () => {
    expect(mnemonics(MITSUBISHI_FX5U, selfHold)).toEqual([
      'LD X0',
      'OR Y0',
      'ANI X1',
      'OUT Y0',
      'END',
    ]);
  });

  it('writes the same rung in each dialect mnemonics', () => {
    expect(mnemonics(OMRON_CP1E, selfHold)).toEqual([
      'LD 0.00',
      'OR 100.00',
      'AND NOT 0.01',
      'OUT 100.00',
      'END',
    ]);
    expect(mnemonics(JTEKT_PC10G, selfHold)).toEqual([
      'LD 1X000',
      'OR 1Y010',
      'ANI 1X001',
      'OUT 1Y010',
      'END',
    ]);
    expect(mnemonics(SHARP_JW300, selfHold)).toEqual([
      'STR 000000',
      'OR 000020',
      'AND NOT 000001',
      'OUT 000020',
      'F-40',
    ]);
  });

  it('uses the edge-contact and SET mnemonics', () => {
    const p = program(network('n1', [rung(rise(X(0)), set(M(0)))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LDP X0', 'SET M0', 'END']);
    expect(mnemonics(SHARP_JW300, p)).toEqual(['STR POS 000000', 'SET 001000', 'F-40']);
  });

  it('loads the always-on device as a b-contact where the dialect needs one (H-4)', () => {
    // 接点の無い行は「常時ON」を読む。シャープの `007366` は**b接点**で常時ONなので
    // `STR NOT` で読む（`specialInverted`。§10.5 / §17 #22 / 4B 引き渡し H-4）
    const p = program(network('n1', [rung(hline(), out(Y(0)))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD M8000', 'OUT Y0', 'END']);
    expect(mnemonics(OMRON_CP1E, p)).toEqual(['LD P_On', 'OUT 100.00', 'END']);
    expect(mnemonics(SHARP_JW300, p)).toEqual(['STR NOT 007366', 'OUT 000020', 'F-40']);
  });

  it('merges the timer mnemonic with its device when the dialect spells it that way', () => {
    const p = program(network('n1', [rung(no(X(0)), ton(T(0), 3000))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT T0 K30', 'END']);
    expect(mnemonics(OMRON_CP1E, p)).toEqual(['LD 0.00', 'TIM T0 #0030', 'END']);
    expect(mnemonics(JTEKT_PC10G, p)).toEqual(['LD 1X000', 'OUT 1T000 H001E', 'END']);
    expect(mnemonics(SHARP_JW300, p)).toEqual(['STR 000000', 'TMR00000 0030', 'F-40']);
  });

  it('writes the counter and its reset the way the manual does', () => {
    const p = program(network('n1', [rung(no(X(0)), ctu(C(0), 5, X(1)))]), endNetwork());
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT C0 K5', 'LD X1', 'RST C0', 'END']);
    // CX-Programmer は種別の文字を落として `CNT 0 #0005` と書くが、本アプリは
    // `parseDevice()` が一意に読める `CNT C0 #0005` に統一する（意図的な差分#2）
    expect(mnemonics(OMRON_CP1E, p)).toEqual([
      'LD 0.00',
      'CNT C0 #0005',
      'LD 0.01',
      'RSET C0',
      'END',
    ]);
    expect(mnemonics(JTEKT_PC10G, p)).toEqual([
      'LD 1X000',
      'OUT 1C000 H0005',
      'LD 1X001',
      'RST 1C000',
      'END',
    ]);
    expect(mnemonics(SHARP_JW300, p)).toEqual([
      'STR 000000',
      'CNT00000 0005',
      'STR 000001',
      'RST CNT00000',
      'F-40',
    ]);
  });

  it('writes MC / MCR with the master-control mnemonics of the dialect', () => {
    const p = program(
      network('n1', [rung(no(X(0)), mc(M(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      network('n3', [rung(no(X(0)), mcr(M(0)))]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toContain('MC M0');
    expect(mnemonics(MITSUBISHI_FX5U, p)).toContain('MCR M0');
    expect(mnemonics(OMRON_CP1E, p)).toContain('IL W0.00');
  });

  it('emits a block instruction when a branch is itself a series', () => {
    // X0 と（X1 AND X2）の並列 → LD X0 / LD X1 / AND X2 / ORB / OUT Y0。
    // 分岐は2列ぶん伸びるので、合流の縦線は 2列目に置く（下の行の X2 の右側）
    const p = program(
      network('n1', [
        [no(X(0)), hline(), vline(), ...hlines(IR_COLS - 4), out(Y(0))],
        [no(X(1)), no(X(2))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual([
      'LD X0',
      'LD X1',
      'AND X2',
      'ORB',
      'OUT Y0',
      'END',
    ]);
  });

  it('chains two parallel groups with a block instruction', () => {
    // （X0 OR X2）AND（X1 OR X3）。分岐の合流は縦線、下の行は横線で右へ渡る。
    // 中央の縦線は渡り（条件の無い枝）なので両端は同じ節点で、ブリッジ回路にはならない
    const p = program(
      network('n1', [
        [no(X(0)), vline(), no(X(1)), vline(), ...hlines(IR_COLS - 5), out(Y(0))],
        [no(X(2)), hline(), no(X(3))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual([
      'LD X0',
      'OR X2',
      'LD X1',
      'OR X3',
      'ANB',
      'OUT Y0',
      'END',
    ]);
  });

  it('prunes a dangling branch that never reaches the coil without affecting the live path', () => {
    // X1 は縦線で本線に触れるだけで、そこから先はどこにも繋がっていない（配線ミスの分岐）。
    // 左母線からコイルへは X0 だけの直列で届くので、行き止まりの枝を落として X0 だけが残る
    const p = program(
      network('n1', [
        [no(X(0)), ...hlines(5), vline(), ...hlines(IR_COLS - 8), out(Y(0))],
        [...Array.from({ length: 6 }, () => empty()), no(X(1))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT Y0', 'END']);
  });

  it('does not repeat the condition when two outputs share a rung', () => {
    // 出力の分岐はコイル列の手前で縦線に落とす。下の行の0列目を横線にすると左母線と
    // 直結してしまい、実機どおり「常時ON」の回路になってしまう（ランタイムの `solve()` と同じ）
    const p = program(
      network('n1', [
        [no(X(0)), ...hlines(IR_COLS - 3), vline(), out(Y(0))],
        [...Array.from({ length: IR_COLS - 2 }, () => empty()), hline(), out(Y(1))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT Y0', 'OUT Y1', 'END']);
  });

  it('re-emits the LD after a counter shares a rung with the next output (B1)', () => {
    // カウンタの実体は「OUT C0 K5 / LD X1 / RST C0」で終わり、最後の LD はリセット条件（X1）
    // になる。次の出力が元の条件（X0）と同じ exprKey でも LD を省略すると、実機では
    // Y0 がリセット条件（X1）で駆動されてしまう
    const p = program(
      network('n1', [
        [no(X(0)), ...hlines(IR_COLS - 3), vline(), ctu(C(0), 5, X(1))],
        [...Array.from({ length: IR_COLS - 2 }, () => empty()), hline(), out(Y(0))],
      ]),
      endNetwork(),
    );
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual([
      'LD X0',
      'OUT C0 K5',
      'LD X1',
      'RST C0',
      'LD X0',
      'OUT Y0',
      'END',
    ]);
  });

  it('numbers the steps and renders CRLF text with a heading per network (§10.7)', () => {
    const result = instructionList(selfHold, MITSUBISHI_FX5U);
    expect(result.errors).toEqual([]);
    expect(result.lines.map((l) => l.step)).toEqual([0, 1, 2, 3, 4]);
    expect(result.lines[0]?.networkId).toBe('n1');
    expect(result.text).toContain('\r\n');
    expect(result.text).not.toMatch(/[^\r]\n/u);
    expect(result.text.endsWith('\r\n')).toBe(true);
    expect(result.text).toContain('; n1  自己保持');
    expect(result.text).toContain('0000  LD');
  });

  it('reports a ladder it cannot convert', () => {
    const broken = program(network('n1', [[no(X(0))]]));
    const result = instructionList(broken, MITSUBISHI_FX5U);
    expect(result.lines).toEqual([]);
    expect(result.text).toBe('');
    expect(result.errors[0]?.code).toBe('compile-failed');
    expect(INSTRUCTION_LIST_MESSAGES['compile-failed']).toBeDefined();
    expect(INSTRUCTION_LIST_MESSAGES['not-series-parallel']).toBeDefined();
    expect(INSTRUCTION_LIST_MESSAGES['coil-unconnected']).toBeDefined();
  });

  it('reports a coil that never reaches the left rail as coil-unconnected, not not-series-parallel (I3)', () => {
    // 2行目のコイルはどの接点を閉じても左母線まで繋がらない（配線忘れ）。ブリッジ回路
    // （直並列に分解できないが左母線には繋がる）とは別の指摘にする
    const p = program(
      network('n1', [
        [no(X(0)), ...hlines(IR_COLS - 2), out(Y(0))],
        [...Array.from({ length: IR_COLS - 2 }, () => empty()), hline(), out(Y(1))],
      ]),
      endNetwork(),
    );
    const result = instructionList(p, MITSUBISHI_FX5U);
    expect(result.errors.map((e) => e.code)).toEqual(['coil-unconnected']);
    expect(result.errors[0]?.row).toBe(1);
    expect(result.errors[0]?.networkId).toBe('n1');
    expect(mnemonics(MITSUBISHI_FX5U, p)).toEqual(['LD X0', 'OUT Y0', 'END']);
  });

  it('reports a genuine bridge circuit as not-series-parallel (I3)', () => {
    // ホイートストンブリッジ（5枝・4節点）: L=左母線, A=(0,1)+(0,2)+(1,1) を渡りで束ねた節点、
    // B=(1,2)+(2,1)+(2,2) を渡りで束ねた節点、R=コイル手前（(1,4) を含む渡りの節点）。
    // 5本の枝（X0: L-A、X4: A-B、X1: L-B、X2: A-R、X3: B-R）のどれを落としても直並列には
    // 分解できない（次数3以上の節点が残る）。コイルは2行目、`vline` は (0,1)・(1,2)・(0,4) の3本
    const bridge: Cell[][] = [
      [empty(), vline(), no(X(2)), hline(), vline()],
      [no(X(0)), no(X(4)), vline(), no(X(3)), ...hlines(IR_COLS - 5), out(Y(0))],
      [no(X(1)), hline()],
    ];
    const p = program(network('n1', bridge), endNetwork());
    const result = instructionList(p, MITSUBISHI_FX5U);
    expect(result.errors.map((e) => e.code)).toEqual(['not-series-parallel']);
    expect(result.errors[0]?.networkId).toBe('n1');
  });

  it('marks a preset the dialect cannot express instead of guessing', () => {
    const p = program(network('n1', [rung(no(X(0)), ton(T(0), 150))]), endNetwork());
    const result = instructionList(p, SHARP_JW300);
    expect(result.errors.map((e) => e.code)).toEqual(['preset-unavailable']);
    expect(result.lines.map((l) => l.operand)).toContain('?');
  });

  it('marks a counter preset the dialect cannot express instead of guessing (B2)', () => {
    const p = program(network('n1', [rung(no(X(0)), ctu(C(0), 20_000, X(1)))]), endNetwork());
    for (const profile of [OMRON_CP1E, SHARP_JW300]) {
      const result = instructionList(p, profile);
      expect(
        result.errors.map((e) => e.code),
        profile.id,
      ).toEqual(['preset-unavailable']);
      const operands = result.lines.map((l) => l.operand);
      expect(
        operands.some((operand) => operand === '?' || operand.endsWith(' ?')),
        `${profile.id}: ${operands.join('|')}`,
      ).toBe(true);
    }
  });

  it('falls back to the plain number when a dialect has no counter spelling', () => {
    // `counterPresetText` / `parseCounterPreset` は対の任意項目なので、持たない方言でも
    // 命令語リストは作れる（B2 の往復検査は `parseCounterPreset` が無ければ働かない）
    const bare: DialectProfile = { ...MITSUBISHI_FX5U };
    delete bare.counterPresetText;
    delete bare.parseCounterPreset;
    const p = program(network('n1', [rung(no(X(0)), ctu(C(0), 5, X(1)))]), endNetwork());
    expect(mnemonics(bare, p)).toContain('OUT C0 5');
  });
});
