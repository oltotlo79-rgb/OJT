import {
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  program,
  T,
  ton,
  X,
  type Cell,
  type LadderProgram,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  coerceTimerBases,
  defaultTimerBase,
  instructionList,
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
  timerBaseChoices,
  unitLabelOf,
} from '../src/index.js';

/**
 * タイマの時間単位を命令で選ぶ（v2.0.0 設計 §3.6）。
 *
 * - 三菱 OUT/OUTH/OUTHS、オムロン TIM/TIMH/TMHH、ジェイテクト TMR/TMRH、シャープ TMR。
 * - IR の `base` は表記（命令名・設定値の書き方）と検査にだけ効き、`presetMs` が動作の正本。
 * - 三菱の旧来の番号帯（T200〜=10ms・T256〜=1ms）は `base` の無いセルの読みに残す（互換）。
 */

const PROFILES = [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300];

/** 接点1つとタイマ1つの段（タイマは右母線に付くようコイル列まで横線で詰める）。 */
function timerProgram(presetMs: number, base?: 100 | 10 | 1): LadderProgram {
  const row: Cell[] = [no(X(0))];
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(ton(T(0), presetMs, base));
  return program(network('n1', [row]), endNetwork());
}

describe('時間単位の一覧と命令名', () => {
  it('4社とも既定は 100ms で、選べる単位は仕様どおり', () => {
    expect(MITSUBISHI_FX5U.timerBases).toEqual([100, 10, 1]);
    expect(OMRON_CP1E.timerBases).toEqual([100, 10, 1]);
    expect(JTEKT_PC10G.timerBases).toEqual([100, 10]);
    expect(SHARP_JW300.timerBases).toEqual([100]);
    for (const profile of PROFILES) expect(defaultTimerBase(profile)).toBe(100);
  });

  it('単位ごとの命令名は実機の名前で、同じ機種の中で重ならない', () => {
    expect(MITSUBISHI_FX5U.timerInstructionName(100)).toBe('OUT T');
    expect(MITSUBISHI_FX5U.timerInstructionName(10)).toBe('OUTH T');
    expect(MITSUBISHI_FX5U.timerInstructionName(1)).toBe('OUTHS T');
    expect(OMRON_CP1E.timerInstructionName(100)).toBe('TIM');
    expect(OMRON_CP1E.timerInstructionName(10)).toBe('TIMH');
    expect(OMRON_CP1E.timerInstructionName(1)).toBe('TMHH');
    expect(JTEKT_PC10G.timerInstructionName(100)).toBe('TMR');
    expect(JTEKT_PC10G.timerInstructionName(10)).toBe('TMRH');
    expect(SHARP_JW300.timerInstructionName(100)).toBe('TMR');
    for (const profile of PROFILES) {
      const names = profile.timerBases.map((base) => profile.timerInstructionName(base));
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('画面の選択肢は命令名と単位名を持つ', () => {
    expect(timerBaseChoices(MITSUBISHI_FX5U)).toEqual([
      { base: 100, name: 'OUT T', label: '0.1秒' },
      { base: 10, name: 'OUTH T', label: '0.01秒' },
      { base: 1, name: 'OUTHS T', label: '0.001秒' },
    ]);
    expect(unitLabelOf(100)).toBe('0.1秒');
    expect(unitLabelOf(10)).toBe('0.01秒');
    expect(unitLabelOf(1)).toBe('0.001秒');
  });
});

describe('設定値の書き方は命令で選んだ単位で決まる', () => {
  it('500ms は 100ms 単位なら K5、10ms 単位なら K50（三菱）', () => {
    expect(MITSUBISHI_FX5U.timerPreset(500, T(0), 100)).toMatchObject({ text: 'K5' });
    expect(MITSUBISHI_FX5U.timerPreset(500, T(0), 10)).toMatchObject({ text: 'K50' });
    expect(MITSUBISHI_FX5U.timerPreset(500, T(0), 1)).toMatchObject({ text: 'K500' });
    // 読み戻しも単位に従う
    expect(MITSUBISHI_FX5U.parseTimerPreset('K50', T(0), 10)).toBe(500);
    expect(MITSUBISHI_FX5U.parseTimerPreset('K5', T(0), 100)).toBe(500);
  });

  it('オムロンは #BCD 4桁、ジェイテクトは H 16進4桁で、単位に応じてカウントが変わる', () => {
    expect(OMRON_CP1E.timerPreset(500, T(0), 10)).toMatchObject({ text: '#0050' });
    expect(OMRON_CP1E.timerPreset(500, T(0), 1)).toMatchObject({ text: '#0500' });
    expect(OMRON_CP1E.parseTimerPreset('#0050', T(0), 10)).toBe(500);
    expect(JTEKT_PC10G.timerPreset(500, T(0), 10)).toMatchObject({ text: 'H0032' });
    expect(JTEKT_PC10G.parseTimerPreset('H0032', T(0), 10)).toBe(500);
  });

  it('250ms は 100ms 単位では表せず、10ms 単位なら表せる', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G]) {
      expect(profile.timerPreset(250, T(0), 100), profile.id).toBeInstanceOf(Error);
      expect(profile.timerPreset(250, T(0), 10), profile.id).not.toBeInstanceOf(Error);
    }
  });

  it('1ms 単位でも、本アプリの演算刻み（10ms）に合わない設定値は断る', () => {
    const mitsubishi = MITSUBISHI_FX5U.timerPreset(15, T(0), 1);
    expect(mitsubishi).toBeInstanceOf(Error);
    if (mitsubishi instanceof Error) expect(mitsubishi.message).toContain('10ms');
    const omron = OMRON_CP1E.timerPreset(15, T(0), 1);
    expect(omron).toBeInstanceOf(Error);
    expect(OMRON_CP1E.timerPreset(20, T(0), 1)).toMatchObject({ text: '#0020' });
  });

  it('三菱: base の無いセルは旧来の番号帯で読む（互換）、base があれば番号に関わらずその単位', () => {
    expect(MITSUBISHI_FX5U.timerBaseMs(T(0))).toBe(100);
    expect(MITSUBISHI_FX5U.timerBaseMs(T(200))).toBe(10);
    expect(MITSUBISHI_FX5U.timerBaseMs(T(256))).toBe(1);
    expect(MITSUBISHI_FX5U.timerBaseMs(T(200), 100)).toBe(100);
    expect(MITSUBISHI_FX5U.timerBaseMs(T(0), 10)).toBe(10);
    // 旧来の作業ファイル（base 無し）の T200 K50 は 500ms のまま
    expect(MITSUBISHI_FX5U.parseTimerPreset('K50', T(200))).toBe(500);
  });
});

describe('検査と命令語リスト', () => {
  it('切替先に無い単位（シャープへ 10ms）は検査で「timer-unit」になる', () => {
    const issues = SHARP_JW300.validate(timerProgram(500, 10));
    expect(issues.map((issue) => issue.code)).toEqual(['timer-unit']);
    expect(issues[0]?.message).toContain('0.01秒');
    expect(SHARP_JW300.validate(timerProgram(500, 100))).toEqual([]);
    expect(JTEKT_PC10G.validate(timerProgram(500, 1)).map((i) => i.code)).toEqual(['timer-unit']);
  });

  it('命令語リストは単位の命令名で書く（OUTH T0 K50 / TIMH T0 #0050 / TMRH T0 H0032）', () => {
    const lines = (profile: typeof MITSUBISHI_FX5U, base: 100 | 10 | 1): string[] =>
      instructionList(timerProgram(500, base), profile).lines.map((line) =>
        `${line.mnemonic} ${line.operand}`.trim(),
      );
    expect(lines(MITSUBISHI_FX5U, 10)).toContain('OUTH T0 K50');
    expect(lines(MITSUBISHI_FX5U, 100)).toContain('OUT T0 K5');
    expect(lines(MITSUBISHI_FX5U, 1)).toContain('OUTHS T0 K500');
    expect(lines(OMRON_CP1E, 10)).toContain('TIMH T0 #0050');
    expect(lines(JTEKT_PC10G, 10)).toContain('TMRH 1T000 H0032');
    // base の無い旧来のセルは既定の命令名のまま
    const legacy = instructionList(timerProgram(500), MITSUBISHI_FX5U).lines.map((line) =>
      `${line.mnemonic} ${line.operand}`.trim(),
    );
    expect(legacy).toContain('OUT T0 K5');
  });

  it('切替先に無い単位のタイマは既定の単位へ寄せ、設定値をその刻みへ丸める', () => {
    const source = timerProgram(250, 10);
    const { program: coerced, changed } = coerceTimerBases(source, SHARP_JW300);
    expect(changed).toEqual([
      {
        networkId: 'n1',
        row: 0,
        col: IR_COLS - 1,
        fromBase: 10,
        toBase: 100,
        fromMs: 250,
        toMs: 300,
      },
    ]);
    const cell = coerced.networks[0]?.cells[0]?.[IR_COLS - 1];
    expect(cell).toMatchObject({ kind: 'timer', presetMs: 300, base: 100 });
    // 元のプログラムは書き換えない
    expect(source.networks[0]?.cells[0]?.[IR_COLS - 1]).toMatchObject({ presetMs: 250, base: 10 });
    // 寄せるものが無ければ同じプログラムを返す
    expect(coerceTimerBases(source, OMRON_CP1E).program).toBe(source);
  });
});
