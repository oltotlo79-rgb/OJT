import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  createAssembleLabProblem,
  createPlcLabProblem,
  findBuiltinProblem,
  findLabTemplate,
  LAB_TEMPLATES,
  labTemplatesFor,
  parseProblem,
} from '../src/index.js';
import { buildLabTemplates, labDurationOf } from '../src/lab-template-build.js';

/**
 * 実験の例題（内蔵課題の模範を元の操作で動かした結果）。設計 §4.3
 * 例題が模範で合格することは `judge-lab.test.ts` が確かめる。
 */
describe('実験の例題', () => {
  it('生成物が最新（scripts/build-lab-templates.mjs で作り直すと同じ）', () => {
    expect(buildLabTemplates(findBuiltinProblem, JIPM_BOARD)).toEqual(LAB_TEMPLATES);
  });

  it('回路実験・PLC実験それぞれに4題あり、実験の課題として検証を通る', () => {
    for (const mode of ['assemble-lab', 'plc-lab'] as const) {
      const templates = labTemplatesFor(mode);
      expect(templates.map((template) => template.id)).toEqual([
        'self-hold',
        'interlock',
        'on-delay',
        'one-shot',
      ]);
      for (const template of templates) {
        const problem =
          mode === 'assemble-lab'
            ? createAssembleLabProblem(template)
            : createPlcLabProblem({ vendor: 'mitsubishi', prewired: true, ...template });
        const parsed = parseProblem(problem);
        expect(parsed.ok, `${mode}/${template.id} ${JSON.stringify(parsed)}`).toBe(true);
        expect(template.expected.length, `${mode}/${template.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('名前で引ける', () => {
    expect(findLabTemplate('plc-lab', 'on-delay')?.source).toBe('d-003');
    expect(findLabTemplate('assemble-lab', 'on-delay')?.source).toBe('b-003');
    expect(findLabTemplate('assemble-lab', 'nothing')).toBeUndefined();
  });

  it('長さは 0.1秒単位へ切り上げ、2〜60秒に収める', () => {
    expect(labDurationOf(5_000)).toBe(5_000);
    expect(labDurationOf(5_010)).toBe(5_100);
    expect(labDurationOf(500)).toBe(2_000);
    expect(labDurationOf(90_000)).toBe(60_000);
  });

  it('元にした課題が無ければ作らない', () => {
    expect(() => buildLabTemplates(() => undefined, JIPM_BOARD)).toThrow('見つかりません');
  });
});
