import { DEFAULT_TIMER_PRESET_MS } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROBLEMS } from '../src/builtin/index.js';

/**
 * 内蔵課題のタイマ既定値からの弁別（Phase 1 受け入れレビュー指摘）。
 *
 * タイマを新規装着すると `DEFAULT_TIMER_PRESET_MS` の値がダイヤルに入る。内蔵課題のどれかが
 * その既定値と同じ設定時間を要求すると、訓練者はダイヤルへ一切触れなくても
 * （＝タイマの操作を練習しないまま）その課題に合格できてしまう。
 * 内蔵課題が増えても、この抜け穴が再発したら必ず落ちるようにする。
 */

interface TimerCell {
  problemId: string;
  device: string;
  presetMs: number | undefined;
}

const TIMER_CELLS: TimerCell[] = BUILTIN_PROBLEMS.flatMap((problem) =>
  problem.schematic.rungs.flatMap((rung) =>
    rung.cells
      .filter((cell) => cell.kind === 'coil' && cell.device.startsWith('T'))
      .map((cell) => ({ problemId: problem.id, device: cell.device, presetMs: cell.presetMs })),
  ),
);

describe('内蔵課題のタイマ既定値', () => {
  it('空振り防止: タイマを使う内蔵課題が少なくとも1件ある', () => {
    expect(TIMER_CELLS.length).toBeGreaterThan(0);
  });

  it.each(TIMER_CELLS)(
    '$problemId の $device はDEFAULT_TIMER_PRESET_MSとは異なる設定時間を要求する',
    ({ presetMs }) => {
      expect(presetMs).not.toBeUndefined();
      expect(presetMs).not.toBe(DEFAULT_TIMER_PRESET_MS);
    },
  );
});
