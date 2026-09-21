import { BUILTIN_INSPECT_PARTS_PROBLEMS, PART_TRUTHS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  vi.unstubAllGlobals();
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

  it('広い欄は部品を行・原因を列にし、狭くすると同じ回答のカードへ切り替わる', () => {
    if (C1 === undefined) throw new Error('fixture');
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const first = C1.parts[0];
    if (first === undefined) throw new Error('fixture');
    render(
      <MarkSheetPanel
        problem={C1}
        answers={[{ partId: first.id, answer: 'coil-open' }]}
        onAnswer={vi.fn()}
      />,
    );
    const setWidth = (width: number): void => {
      act(() =>
        resize?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver),
      );
    };
    setWidth(900);
    expect(screen.getAllByRole('columnheader')).toHaveLength(PART_TRUTHS.length + 1);
    expect(screen.getAllByRole('rowheader')).toHaveLength(C1.parts.length);
    expect(screen.getAllByRole('radio')).toHaveLength(C1.parts.length * PART_TRUTHS.length);
    expect(screen.getByTestId<HTMLInputElement>(`answer-${first.id}-coil-open`).checked).toBe(true);
    setWidth(380);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId<HTMLInputElement>(`answer-${first.id}-coil-open`).checked).toBe(true);
    expect(screen.getByTestId('mark-sheet').querySelectorAll('details')).toHaveLength(
      C1.parts.length,
    );
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

  it('ラジオに部品名入りの aria-label が付く（読み上げが部品名を読める。レビュー指摘 M3）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(<MarkSheetPanel problem={C1} answers={[]} onAnswer={vi.fn()} />);
    const first = C1.parts[0];
    if (first === undefined) return;
    const radio = screen.getByTestId(`answer-${first.id}-coil-open`);
    // UXレビュー #6a: 内部ID（`p1`）ではなく番号＋型番で読み上げる（①リレー MY4N）
    expect(radio.getAttribute('aria-label')).toContain('①');
    expect(radio.getAttribute('aria-label')).not.toContain(first.id);
    expect(radio.getAttribute('aria-label')).toContain('コイル断線');
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
    expect(table.textContent).toContain('552');
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

  it('レアショートの説明はパネル内で1回しか出ない（UI監査 I4）', () => {
    render(<DiagnosisHelp />);
    const panel = screen.getByTestId('diagnosis-help');
    const occurrences =
      (panel.textContent ?? '').split('動作を見るだけでは正常品と区別できない').length - 1;
    expect(occurrences).toBe(1);
    // しきい値は552.5Ω（本アプリの既定）の一箇所だけに書く。0/000のような別表記は出さない。
    expect(panel.textContent).not.toContain('552.5');
  });
});
