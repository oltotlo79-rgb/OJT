import { JIPM_BOARD, removeWire } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, buildReferenceSession, wiringSuspects } from '@ojt/content';
import type { WiringSuspect } from '@ojt/content';
import { terminalId } from '@ojt/circuit-sim';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuspectList } from '../src/renderer/result/SuspectList.js';

/**
 * 疑わしい配線の一覧（UXレビュー #28）。§8.3 / 決定表#9・#9b・#11・#27
 *
 * 一覧そのものの正しさ（節点分割の差の求め方）は `@ojt/content` の `wiring-diff.test.ts` が
 * 見ている。ここで確かめるのは**画面**の約束: 各行に「盤で見る」があること、押すと
 * その疑いがそのまま呼び出し側へ渡ること、空のとき・切り捨てたときの文言が出ること。
 */

const found = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (found === undefined) throw new Error('b-001 が見つかりません');
/** 巻き上げられる関数宣言の中でも `undefined` を外した型でいるように、別名にしてから使う。 */
const problem = found;

/** 模範回路から固定でない電線を1本抜いた盤（必ず `missing` が出る）。 */
function brokenSession() {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路が作れません');
  const victim = built.value.session.wires.find((w) => !w.locked);
  if (victim !== undefined) removeWire(built.value.session, victim.id);
  return built.value.session;
}

afterEach(() => {
  cleanup();
});

describe('SuspectList（UXレビュー #28）', () => {
  it('lists the suspects with a 盤で見る button each', () => {
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, brokenSession());
    expect(suspects.length).toBeGreaterThan(0);
    render(<SuspectList suspects={suspects} onShowOnBoard={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: '盤で見る' })).toHaveLength(suspects.length);
    expect(screen.getByTestId('suspect-list')).toHaveTextContent('つながっていません');
  });

  it('hands the terminals, wires and cells to the caller', () => {
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, brokenSession());
    const onShowOnBoard = vi.fn();
    render(<SuspectList suspects={suspects} onShowOnBoard={onShowOnBoard} />);
    fireEvent.click(screen.getAllByRole('button', { name: '盤で見る' })[0] as HTMLElement);
    expect(onShowOnBoard).toHaveBeenCalledWith(suspects[0]);
  });

  it('says so when there is nothing to suspect', () => {
    render(<SuspectList suspects={[]} onShowOnBoard={vi.fn()} />);
    expect(screen.getByTestId('no-suspect')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: '盤で見る' })).toHaveLength(0);
  });

  it('tells the trainee when the list was cut short (決定表#27)', () => {
    const many: WiringSuspect[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'missing' as const,
      terminals: [terminalId('CR1', String(i + 1)), terminalId('P', '1')] as const,
      devices: ['CR1', 'P'],
      cellIds: [`c${String(i)}`],
      wireIds: [],
      message: `CR1.${String(i + 1)}（CR1）と P.1（P）がつながっていません`,
    }));
    render(<SuspectList suspects={many} onShowOnBoard={vi.fn()} truncated={3} />);
    expect(screen.getByTestId('suspect-more')).toHaveTextContent('3');
  });

  it('warns that a different contact pair also shows up here (決定表#9b)', () => {
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, brokenSession());
    render(<SuspectList suspects={suspects} onShowOnBoard={vi.fn()} />);
    expect(screen.getByTestId('suspect-note')).toHaveTextContent('接点の組');
  });

  /*
   * UI監査: 疑いが5件など多いと、一覧だけで `.card` の頭打ち（420px）を超え、
   * 以前は末尾にあった断り（`suspect-note`）が折り返しの外へ落ちて見えなかった。
   * 断りを見出しの直後（一覧より前）に置き、スクロールは一覧の行だけに閉じ込める。
   */
  it('keeps the contact-pair note above the list, not below the fold, with 5 suspects', () => {
    const many: WiringSuspect[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'missing' as const,
      terminals: [terminalId('CR1', String(i + 1)), terminalId('P', '1')] as const,
      devices: ['CR1', 'P'],
      cellIds: [`c${String(i)}`],
      wireIds: [],
      message: `CR1.${String(i + 1)}（CR1）と P.1（P）がつながっていません`,
    }));
    render(<SuspectList suspects={many} onShowOnBoard={vi.fn()} />);
    const card = screen.getByTestId('suspect-list');
    const note = screen.getByTestId('suspect-note');
    const list = card.querySelector('ul');
    expect(list).not.toBeNull();
    if (list === null) return;
    // 断りは一覧より前（DOM順）に置く。一覧が長くても常に見える位置にとどまる。
    expect(
      Boolean(note.compareDocumentPosition(list) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });
});
