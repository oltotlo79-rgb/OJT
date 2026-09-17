import { BUILTIN_INSPECT_PARTS_PROBLEMS, PART_TRUTHS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckTrayPanel } from '../src/renderer/panels/CheckTrayPanel.js';
import { DiagnosisHelp } from '../src/renderer/panels/DiagnosisHelp.js';
import { MarkSheetPanel } from '../src/renderer/panels/MarkSheetPanel.js';

/**
 * モードC1の右パネル（Plan 2B Task 9）。設計仕様 §9.1 / §17.2 #5。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

afterEach(() => {
  cleanup();
});

describe('CheckTrayPanel（§9.1 トレイ）', () => {
  it('部品を並べ、「挿す」で選べる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const onSelect = vi.fn();
    render(
      <CheckTrayPanel problem={C1} checkPartId={undefined} onSelect={onSelect} onEject={vi.fn()} />,
    );
    const first = C1.parts[0];
    if (first === undefined) return;
    expect(screen.getByTestId(`tray-${first.id}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });

  it('挿している部品には「外す」が出る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    const onEject = vi.fn();
    render(
      <CheckTrayPanel problem={C1} checkPartId={first.id} onSelect={vi.fn()} onEject={onEject} />,
    );
    fireEvent.click(screen.getByTestId(`eject-${first.id}`));
    expect(onEject).toHaveBeenCalledTimes(1);
  });

  it('本当の状態は画面に出さない（答えが漏れない）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <CheckTrayPanel problem={C1} checkPartId={undefined} onSelect={vi.fn()} onEject={vi.fn()} />,
    );
    const text = screen.getByTestId('check-tray').textContent ?? '';
    expect(text).not.toContain('レアショート');
    expect(text).not.toContain('コイル断線');
  });
});

describe('MarkSheetPanel（§9.1 回答 / §17.2 #5）', () => {
  it('部品ごとに7択のラジオを出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(<MarkSheetPanel problem={C1} answers={[]} onAnswer={vi.fn()} />);
    const first = C1.parts[0];
    if (first === undefined) return;
    for (const truth of PART_TRUTHS) {
      expect(screen.getByTestId(`answer-${first.id}-${truth}`)).toBeTruthy();
    }
  });

  it('選ぶと onAnswer が呼ばれる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const onAnswer = vi.fn();
    render(<MarkSheetPanel problem={C1} answers={[]} onAnswer={onAnswer} />);
    const first = C1.parts[0];
    if (first === undefined) return;
    fireEvent.click(screen.getByTestId(`answer-${first.id}-coil-open`));
    expect(onAnswer).toHaveBeenCalledWith(first.id, 'coil-open');
  });

  it('同じ部品の選択は排他になる（radio の name が部品ごと）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(
      <MarkSheetPanel
        problem={C1}
        answers={[{ partId: first.id, answer: 'a-weld' }]}
        onAnswer={vi.fn()}
      />,
    );
    const checked = screen.getByTestId<HTMLInputElement>(`answer-${first.id}-a-weld`);
    const other = screen.getByTestId<HTMLInputElement>(`answer-${first.id}-normal`);
    expect(checked.checked).toBe(true);
    expect(other.checked).toBe(false);
    expect(checked.name).toBe(other.name);
  });

  it('解答済みの件数を出す（§9.1 判定の n/m）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(
      <MarkSheetPanel
        problem={C1}
        answers={[{ partId: first.id, answer: 'normal' }]}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByTestId('answered-count').textContent).toContain(
      `1 / ${String(C1.parts.length)}`,
    );
  });
});

describe('DiagnosisHelp（§9.1 ヘルプ）', () => {
  it('判定表の7行としきい値を出す', () => {
    render(<DiagnosisHelp />);
    const table = screen.getByTestId('diagnosis-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(screen.getByTestId('diagnosis-note').textContent).toContain('552.5');
  });

  it('既定では折りたたまれている', () => {
    render(<DiagnosisHelp />);
    expect(screen.getByTestId<HTMLDetailsElement>('diagnosis-help').open).toBe(false);
  });

  it('溶着の優先規則の注意書きを行ごとに出す（2A レビュー fix fb09e13）', () => {
    render(<DiagnosisHelp />);
    const table = screen.getByTestId('diagnosis-table');
    expect(table.textContent).toContain('【溶着が優先】');
  });
});
