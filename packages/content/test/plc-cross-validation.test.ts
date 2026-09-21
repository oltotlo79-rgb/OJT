import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD, plcUnitFor } from '@ojt/board-model';
import { availableDialects, convert, instructionList, JTEKT_PC10G } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { judgePlcReference } from '../src/judge-plc.js';
import { DeviceCommentsSchema } from '../src/schema/ladder.js';
import { MODEL_OF_VENDOR, PlcProblemSchema } from '../src/schema/plc.js';
import { ladderWith, plcProblemJson } from './helpers/plc.js';

/**
 * `PlcProblemSchema` のクロスフィールド検証（レビュー #2）と、内蔵モードD課題20題の
 * 4機種クロス検証（§16 Phase 4 / 決定表#14）。
 * 模範ラダー・操作列・判定設定は、すべてI/O割付にある点だけを扱えるようにする
 * （模範ラダーの参照するX/Y、操作列のPB、`judge.compareSignals` のPL）。
 */

describe('模範ラダー・操作列・判定設定はI/O割付の範囲内でなければならない', () => {
  it('GAP 1: 模範ラダーがI/O割付にないYへ書き込むと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        referenceLadder: ladderWith(7),
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    const message = JSON.stringify(p.error.issues);
    expect(message).toContain('Y7');
    expect(message).toContain('I/O割付');
  });

  it('GAP 2: 模範ラダーがI/O割付にないXを読むと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        referenceLadder: ladderWith(0, 9),
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    expect(JSON.stringify(p.error.issues)).toContain('X9');
  });

  it('GAP 3: 操作列がI/O割付にないPBを押すと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        operations: [
          { t: 0, target: 'PB3', action: 'press' },
          { t: 300, target: 'PB3', action: 'release' },
        ],
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    const issue = p.error.issues.find((i) => String(i.path.join('.')).includes('operations'));
    expect(issue?.message).toContain('PB3');
  });

  it('GAP 4: judge.compareSignals がI/O割付にないPLを指すと拒否する', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({
        judge: { compareSignals: ['PL4'] },
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    expect(JSON.stringify(p.error.issues)).toContain('PL4');
  });

  it('GAP 6: mode "fixed" で inputs だけ与えると拒否する（レビュー #M3: 両方指定するか両方省略）', () => {
    const p = PlcProblemSchema.safeParse(
      plcProblemJson({ io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }] } }),
    );
    expect(p.success).toBe(false);
    if (p.success) return;
    const issue = p.error.issues.find((i) => String(i.path.join('.')).includes('outputs'));
    expect(issue).toBeDefined();
  });

  it('sanity: 割付内に収まっていれば通る', () => {
    const parsed = PlcProblemSchema.parse(
      plcProblemJson({
        io: {
          mode: 'fixed',
          inputs: [{ x: 15, pb: 'PB1' }],
          outputs: [{ y: 15, cr: 'CR1', pl: 'PL1' }],
        },
        referenceLadder: ladderWith(15, 15),
      }),
    );
    expect(parsed.io.inputs?.[0]?.x).toBe(15);
  });
});

describe('DeviceCommentsSchema のキー範囲（レビュー #M5）', () => {
  it('rejects SP9 (存在しない特殊デバイス番号)', () => {
    expect(DeviceCommentsSchema.safeParse({ SP9: '存在しない特殊デバイス' }).success).toBe(false);
  });

  it('rejects X999999 (機種の番号帯を大きく超える桁数)', () => {
    expect(DeviceCommentsSchema.safeParse({ X999999: '範囲外' }).success).toBe(false);
  });

  it('accepts SP0〜SP2', () => {
    expect(DeviceCommentsSchema.safeParse({ SP0: 'a', SP1: 'b', SP2: 'c' }).success).toBe(true);
  });

  it('accepts ordinary in-range keys', () => {
    expect(
      DeviceCommentsSchema.safeParse({ X0: 'a', Y1: 'b', M2: 'c', T3: 'd', C4: 'e' }).success,
    ).toBe(true);
  });
});

/** 命令語リストの改行（§10.7。純正ツールに合わせて CRLF）。 */
const CRLF = '\r\n';

/**
 * 4メーカーと機種の対応（§7.6）。`MODEL_OF_VENDOR`（schema/plc.ts。バレルからも公開）を
 * そのまま使う — 表を書き写すと2箇所が食い違う余地ができるため（レビュー M9）。
 */
const MODELS = Object.entries(MODEL_OF_VENDOR).map(([vendor, model]) => ({ vendor, model }));

describe('内蔵モードD課題20題は4機種すべてで成立する（§16 Phase 4）', () => {
  it('検証対象は20題・4機種から欠けない', () => {
    expect(BUILTIN_PLC_PROBLEMS).toHaveLength(20);
    expect(MODELS).toHaveLength(4);
  });
  // 20題を1件にまとめると、計装時に合計時間だけで失敗して課題を特定できない。
  // 全80通りを独立させ、各課題の採点・静的検査の期待値は維持する。
  it.each(
    MODELS.flatMap((plc) =>
      BUILTIN_PLC_PROBLEMS.map((problem) => ({ model: plc.model, id: problem.id, plc, problem })),
    ),
  )('$model / $id が読めて模範が合格する', ({ plc, problem }) => {
    const swapped = PlcProblemSchema.parse({ ...problem, plc });
    const judged = judgePlcReference(swapped, JIPM_BOARD);
    expect(judged.ok, `${problem.id} / ${plc.model}`).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mismatches, `${problem.id} / ${plc.model}`).toEqual([]);
    expect(judged.value.staticChecks.filter((c) => !c.ok)).toEqual([]);
    expect(judged.value.passed).toBe(true);
  });

  it('模範ラダーはベンダ中立で、4方言すべてで変換が通る（受入基準②）', () => {
    // TOYOPUC の「X と Y の同番号禁止」は **アドレス**で判定する（決定表#16）。20題はすべて
    // `X(0)`〜`X(2)` と `Y(0)`〜`Y(3)` を使うので、出力が `1Y010` から始まる限り衝突しない。
    // ここが `device-conflict` で落ちたら `jtekt.ts` の `OUTPUT_BASE` を疑う
    expect(availableDialects()).toHaveLength(4);
    for (const profile of availableDialects()) {
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const result = convert(problem.referenceLadder, profile);
        expect(result.errors, `${problem.id} / ${profile.id}`).toEqual([]);
        expect(result.ok).toBe(true);
      }
    }
  });

  it('命令語リストが4方言すべてで書き出せる（受入基準⑥）', () => {
    for (const profile of availableDialects()) {
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const list = instructionList(problem.referenceLadder, profile);
        expect(list.errors, `${problem.id} / ${profile.id}`).toEqual([]);
        expect(list.lines.length).toBeGreaterThan(0);
        expect(list.text.endsWith(CRLF)).toBe(true);
      }
    }
  });

  it('TOYOPUC の出力表記と端子の印字が16点とも揃っている（決定表#16）', () => {
    // `OUTPUT_BASE = 0x010` は `jtekt.ts`（方言）と `plc-unit.ts`（端子）に二重にある。
    // 片方だけ動かすと模範配線の端子名とラダーの表記がすれるので、ここで縛る
    const unit = plcUnitFor('PC10G-1SP');
    expect(unit).toBeDefined();
    if (unit === undefined) return;
    expect(unit.spec.outputs).toHaveLength(16);
    unit.spec.outputs.forEach((output, index) => {
      const device = JTEKT_PC10G.formatDevice({ kind: 'output', index });
      expect(device, `Y(${index})`).toMatch(/^1Y0[0-9A-F]{2}$/u);
      expect(
        device.endsWith(output.name.slice(1)),
        `Y(${index}) = ${device} / ${output.name}`,
      ).toBe(true);
    });
    // 入力はずらさない（`1X000` が `X(0)`）
    unit.spec.inputs.forEach((input, index) => {
      expect(JTEKT_PC10G.formatDevice({ kind: 'input', index }).endsWith(input.name.slice(1))).toBe(
        true,
      );
    });
  });
});

describe('方言はテスト限定の依存である（3A 決定表#7）', () => {
  /** `src` 以下の `.ts` をすべて集める。 */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    });
  }

  it('packages/content/src は @ojt/plc-dialects を import しない', () => {
    const src = join(fileURLToPath(new URL('../src/', import.meta.url)));
    const offenders = sourceFiles(src).filter((path) =>
      readFileSync(path, 'utf8').includes('@ojt/plc-dialects'),
    );
    expect(offenders).toEqual([]);
  });
});
