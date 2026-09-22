import { PROBLEM_TAGS } from '@ojt/content';
import { getDialect } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { hintStages, ideaText, maxHintStage } from '../src/renderer/session/hints.js';

/**
 * 段階的に開くヒント（指摘 PR-02。Phase 7 Task 25）。
 * **級による制限**（1級形式は回路図が出ないので第3段を出さない）を縛るのが主目的。
 */

describe('hintStages（段の作り方）', () => {
  it('測定とPLCでは、それぞれの確認手順を案内する', () => {
    expect(hintStages({ grade: 2, mode: 'inspect-parts' })[2]?.text).toContain('無通電');
    expect(hintStages({ grade: 2, mode: 'inspect-repair' })[2]?.text).toContain('電源を切り');
    expect(hintStages({ grade: 2, mode: 'plc' })[2]?.text).toContain('入力→接点→出力');
    expect(hintStages({ grade: 1, mode: 'plc' })).toHaveLength(2);
  });
  it('PLC点滅のヒントは選んだメーカーのクロック番号を使う', () => {
    expect(
      hintStages({ grade: 2, mode: 'plc', tags: ['flicker'], profile: getDialect('mitsubishi') })[1]
        ?.text,
    ).toContain('SM412');
    expect(
      hintStages({ grade: 2, mode: 'plc', tags: ['flicker'], profile: getDialect('jtekt') })[1]
        ?.text,
    ).toContain('V072');
    expect(
      hintStages({ grade: 2, mode: 'plc', tags: ['flicker'], texts: ['課題固有の説明'] })[1]?.text,
    ).toBe('課題固有の説明');
  });
  it('3級は3段、1級は2段（回路図が与えられない級だから）', () => {
    expect(hintStages({ grade: 3 })).toHaveLength(3);
    expect(hintStages({ grade: 2 })).toHaveLength(3);
    const grade1 = hintStages({ grade: 1 });
    expect(grade1).toHaveLength(2);
    expect(grade1.map((stage) => stage.stage)).toEqual([1, 2]);
    expect(maxHintStage(1)).toBe(2);
    expect(maxHintStage(2)).toBe(3);
    expect(maxHintStage(3)).toBe(3);
  });

  it('1級では第3段の文（回路図を見る案内）がどこにも出ない', () => {
    const texts = hintStages({ grade: 1, tags: ['self-hold'] }).map((stage) => stage.text);
    expect(texts.join('')).not.toContain(JA.hint.wire);
    // 代わりに「ここまで」の理由を言う
    expect(texts[1]).toContain(JA.hint.grade1Note);
  });

  it('第1段は手順帯の案内そのもの（取れなければ落としどころの1行）', () => {
    expect(
      hintStages({ grade: 3, stepHint: '3D盤の端子を2つクリックして配線します。' })[0],
    ).toEqual({
      stage: 1,
      title: JA.hint.stage1,
      text: '3D盤の端子を2つクリックして配線します。',
    });
    expect(hintStages({ grade: 3 })[0]?.text).toBe(JA.hint.stepFallback);
  });

  it('第2段は学習テーマから作る（最大2つまで並べる）', () => {
    const stages = hintStages({ grade: 3, tags: ['self-hold', 'timer', 'counter'] });
    expect(stages[1]?.text).toContain(JA.hintTag['self-hold']);
    expect(stages[1]?.text).toContain(JA.hintTag.timer);
    expect(stages[1]?.text).not.toContain(JA.hintTag.counter);
  });

  it('学習テーマが空の課題（b-009 / d-009）でも第2段が空にならない', () => {
    expect(hintStages({ grade: 3, tags: [] })[1]?.text).toBe(JA.hint.ideaFallback);
    expect(hintStages({ grade: 2 })[1]?.text).toBe(JA.hint.ideaFallback);
  });

  it('課題データに手書きのヒントがあればそちらを使う', () => {
    const stages = hintStages({
      grade: 2,
      tags: ['self-hold'],
      texts: ['この課題は停止優先で考えます。', 'CR1 の ⑨⑤ の組を見直します。'],
    });
    expect(stages[1]?.text).toBe('この課題は停止優先で考えます。');
    expect(stages[2]?.text).toBe('CR1 の ⑨⑤ の組を見直します。');
  });

  it('手書きのヒントが1つだけなら第3段は既定の案内に落ちる', () => {
    const stages = hintStages({ grade: 3, texts: ['考え方だけ書いた課題'] });
    expect(stages[1]?.text).toBe('考え方だけ書いた課題');
    expect(stages[2]?.text).toBe(JA.hint.wire);
  });
});

describe('ideaText（学習テーマの言い換え）', () => {
  it('14語すべてに考え方の1行がある（画面に語彙の穴が出ない）', () => {
    for (const tag of PROBLEM_TAGS) {
      expect(ideaText([tag]).length, tag).toBeGreaterThan(10);
      expect(ideaText([tag])).toBe(JA.hintTag[tag]);
    }
  });

  it('渡されなければ落としどころの1行になる', () => {
    expect(ideaText(undefined)).toBe(JA.hint.ideaFallback);
  });
});
