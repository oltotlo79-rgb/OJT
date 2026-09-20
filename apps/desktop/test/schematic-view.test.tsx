import { BUILTIN_ASSEMBLE_PROBLEMS, BUILTIN_INSPECT_REPAIR_PROBLEMS } from '@ojt/content';
import { emptySchematic, layout, type SchematicDocument } from '@ojt/schematic-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCHEMATIC_LAYOUT,
  SchematicSvg,
  viewBoxOf,
} from '../src/renderer/schematic/SchematicSvg.js';
import { SchematicView } from '../src/renderer/schematic/SchematicView.js';

/**
 * 回路図ヒントの見え方（利用者要求 2026-09-19「回路図のクオリティ」）。§8.1 / §11.2
 * 記号そのものの正しさは `@ojt/schematic-core` の `test/symbols.test.ts` が見る。
 * ここが確かめるのは**画面での扱い**: 紙に収まる／切れない／拡大できる／光る。
 */

const B = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id.startsWith('b-001'));
const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);

function docOf(problem: { schematic: SchematicDocument } | undefined): SchematicDocument {
  if (problem === undefined) throw new Error('内蔵課題が見つかりません');
  return problem.schematic;
}

function viewBoxNumbers(element: Element): [number, number, number, number] {
  const raw = element.getAttribute('viewBox') ?? '';
  const parts = raw.split(' ').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

afterEach(() => {
  cleanup();
});

describe('紙に収まる（幅いっぱい・縦横比そのまま・切り落とさない）', () => {
  it('母線の見出しと段番号まで viewBox に入る（以前は負の座標で切れていた）', () => {
    const doc = docOf(B);
    const result = layout(doc, SCHEMATIC_LAYOUT);
    const busLabel = result.shapes.find((s) => s.kind === 'text' && s.text === 'P(+24V)');
    const rungNumber = result.shapes.find((s) => s.role === 'rung');
    expect(busLabel?.kind === 'text' ? busLabel.y : 0).toBeLessThan(0); // 図の外（上）にある
    expect(rungNumber).toBeDefined();

    render(<SchematicView document={doc} />);
    const [minX, minY, width, height] = viewBoxNumbers(screen.getByTestId('schematic-svg'));
    expect(minY).toBeLessThan(0);
    if (busLabel?.kind === 'text') expect(busLabel.y).toBeGreaterThan(minY);
    if (rungNumber?.kind === 'text') expect(rungNumber.x).toBeGreaterThan(minX);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('viewBoxOf は図形すべてを包み、余白は上下左右そろえる', () => {
    const shapes = layout(docOf(B), SCHEMATIC_LAYOUT).shapes;
    const [minX, minY, width, height] = viewBoxOf(shapes, 0, 0).split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    for (const s of shapes) {
      if (s.kind !== 'line') continue;
      expect(Math.min(s.x1, s.x2)).toBeGreaterThanOrEqual(minX);
      expect(Math.max(s.x1, s.x2)).toBeLessThanOrEqual(minX + width);
      expect(Math.min(s.y1, s.y2)).toBeGreaterThanOrEqual(minY);
      expect(Math.max(s.y1, s.y2)).toBeLessThanOrEqual(minY + height);
    }
    // 図形が無くても落ちない
    expect(viewBoxOf([], 10, 20)).toBe('0 0 10 20');
  });

  it('SVG は幅いっぱいで縦横比を保ち、白い紙を敷く', () => {
    render(<SchematicView document={docOf(B)} />);
    const svg = screen.getByTestId('schematic-svg');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.getAttribute('style')).toContain('width: 100%');
    const paper = svg.querySelector('[data-testid="schematic-paper"]');
    expect(paper?.getAttribute('fill')).toBe('#FFFFFF');
    // 紙は viewBox いっぱい（暗色テーマが図の下から透けない）
    const [minX, minY, width, height] = viewBoxNumbers(svg);
    expect(Number(paper?.getAttribute('x'))).toBeCloseTo(minX, 6);
    expect(Number(paper?.getAttribute('y'))).toBeCloseTo(minY, 6);
    expect(Number(paper?.getAttribute('width'))).toBeCloseTo(width, 6);
    expect(Number(paper?.getAttribute('height'))).toBeCloseTo(height, 6);
  });

  it('線は画面px固定（拡大しても太らない）で、直交する線はにじませない', () => {
    render(<SchematicView document={docOf(B)} />);
    const svg = screen.getByTestId('schematic-svg');
    const bus = svg.querySelector('line[shape-rendering="crispEdges"]');
    expect(bus?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    // 母線だけが太く、器具の線は電線と同じ太さ（印刷図の階層。2026-09-20 の記号見直し）
    const widths = [...svg.querySelectorAll('line')].map((l) =>
      Number(l.getAttribute('stroke-width')),
    );
    expect(Math.max(...widths)).toBeGreaterThan(2);
    const thin = new Set(widths.filter((w) => w > 0 && w < 2));
    expect([...thin]).toHaveLength(1);
    expect(Math.min(...thin)).toBeLessThanOrEqual(1.6);
  });

  it('銘板は読める大きさで、和文の書体を指定する', () => {
    render(<SchematicView document={docOf(B)} />);
    const label = [...screen.getByTestId('schematic-svg').querySelectorAll('text')].find(
      (t) => t.textContent === 'CR1',
    );
    expect(label).toBeDefined();
    expect(Number(label?.getAttribute('font-size'))).toBeGreaterThanOrEqual(8);
    expect(label?.getAttribute('font-family')).toContain('Noto Sans JP');
    // 端子番号は等幅で一回り小さい
    const terminal = [...screen.getByTestId('schematic-svg').querySelectorAll('text')].find(
      (t) => t.textContent === '14',
    );
    expect(terminal?.getAttribute('font-family')).toContain('mono');
    expect(Number(terminal?.getAttribute('font-size'))).toBeLessThan(
      Number(label?.getAttribute('font-size')),
    );
  });
});

describe('クリックで拡大（タイムチャートと同じ作法）', () => {
  it('⤢ボタンで拡大表示が開き、×で閉じる', () => {
    render(<SchematicView document={docOf(B)} title="回路図ヒント" />);
    expect(screen.queryByTestId('schematic-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('schematic-enlarge-button'));
    const modal = screen.getByTestId('schematic-modal');
    expect(modal.getAttribute('aria-label')).toBe('回路図ヒント');
    expect(screen.getByTestId('schematic-svg-large')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('閉じる'));
    expect(screen.queryByTestId('schematic-modal')).toBeNull();
  });

  it('Esc でも閉じ、背景クリックでも閉じる', () => {
    render(<SchematicView document={docOf(B)} />);
    fireEvent.click(screen.getByTestId('schematic-enlarge-button'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('schematic-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('schematic-enlarge-button'));
    fireEvent.click(screen.getByTestId('schematic-backdrop'));
    expect(screen.queryByTestId('schematic-modal')).toBeNull();
  });

  it('図そのものを押しても・Enter でも開く（ハイライトを使わない画面）', () => {
    render(<SchematicView document={docOf(B)} />);
    const opener = screen.getByRole('button', { name: /クリックまたはEnterで拡大表示/ });
    fireEvent.keyDown(opener, { key: 'Enter' });
    expect(screen.getByTestId('schematic-modal')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(opener);
    expect(screen.getByTestId('schematic-modal')).toBeTruthy();
  });

  it('連動ハイライトを使う画面では、図の単クリックは要素選択に譲る', () => {
    const onPickCell = vi.fn();
    render(<SchematicView document={docOf(C2)} onPickCell={onPickCell} />);
    // レビュー指摘 UI-14: 単クリックで拡大しないので読み上げ名も違う（クリックとは言わない）
    const opener = screen.getByRole('button', { name: /Enterまたはダブルクリックで拡大表示/ });
    fireEvent.click(opener);
    expect(screen.queryByTestId('schematic-modal')).toBeNull();
    // 2度押しなら開く
    fireEvent.doubleClick(opener);
    expect(screen.getByTestId('schematic-modal')).toBeTruthy();
  });

  it('拡大表示は倍率を変えられ、端で止まる', () => {
    render(<SchematicView document={docOf(B)} />);
    fireEvent.click(screen.getByTestId('schematic-enlarge-button'));
    expect(screen.getByTestId('schematic-zoom-text').textContent).toBe('表示倍率 100%');
    expect(screen.getByTestId('schematic-zoom-out')).toBeDisabled();

    fireEvent.click(screen.getByTestId('schematic-zoom-in'));
    expect(screen.getByTestId('schematic-zoom-text').textContent).toBe('表示倍率 150%');
    fireEvent.click(screen.getByTestId('schematic-zoom-in'));
    fireEvent.click(screen.getByTestId('schematic-zoom-in'));
    expect(screen.getByTestId('schematic-zoom-text').textContent).toBe('表示倍率 300%');
    expect(screen.getByTestId('schematic-zoom-in')).toBeDisabled();

    fireEvent.click(screen.getByTestId('schematic-zoom-reset'));
    expect(screen.getByTestId('schematic-zoom-text').textContent).toBe('表示倍率 100%');
  });
});

describe('連動ハイライト（§9.2）は拡大表示でも効く', () => {
  it('指定した要素は色だけでなく暈し（ハロー）で示す', () => {
    const doc = docOf(C2);
    const cellId = doc.rungs[0]?.cells[0]?.id;
    expect(cellId).toBeDefined();
    if (cellId === undefined) return;
    render(<SchematicView document={doc} highlightCellIds={[cellId]} />);
    const svg = screen.getByTestId('schematic-svg');
    expect(svg.querySelectorAll('[data-highlight="true"]').length).toBeGreaterThan(0);
    const halo = svg.querySelector('[data-halo="true"]');
    expect(halo).toBeTruthy();
    // 暈しは本体より太い
    const main = svg.querySelector(`[data-cell="${cellId}"]:not([data-halo])`);
    expect(Number(halo?.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(main?.getAttribute('stroke-width')),
    );
  });

  it('拡大表示の図も同じ要素が光る', () => {
    const doc = docOf(C2);
    const cellId = doc.rungs[0]?.cells[0]?.id ?? '';
    render(<SchematicView document={doc} highlightCellIds={[cellId]} onPickCell={vi.fn()} />);
    fireEvent.click(screen.getByTestId('schematic-enlarge-button'));
    const large = screen.getByTestId('schematic-svg-large');
    expect(large.querySelectorAll('[data-highlight="true"]').length).toBeGreaterThan(0);
  });
});

describe('どの画面でも同じ図が出る', () => {
  it('編集モードは最小寸法の床（B1）を敷きうるが、当たり矩形はいつでも同じ座標系（カーソルが記号からずれない）', () => {
    const doc = docOf(B);
    const { container, unmount } = render(<SchematicSvg document={doc} />);
    const readOnly = container.querySelector('svg')?.getAttribute('viewBox');
    unmount();
    const editing = render(
      <SchematicSvg document={doc} cursor={{ rungId: 'r1', index: 0 }} onPickSlot={vi.fn()} />,
    );
    // 編集モードだけ最小寸法の床を敷く（B1）。内蔵課題 b-001 は床未満なので紙が広がり、
    // 読取専用（ヒント欄向けの縮尺のまま）とは一致しなくなる——これは意図した挙動
    const editingView = editing.container.querySelector('svg')?.getAttribute('viewBox');
    expect(editingView).not.toBe(readOnly);
    // それでも `layout()` の論理座標そのものは動かない。当たり矩形は常に `SCHEMATIC_LAYOUT`
    // の寸法のまま（床は紙を広げて中央に置くだけで、記号や当たり矩形の座標は動かさない）
    const slot = editing.container.querySelector('[data-slot="r1#0"]');
    expect(Number(slot?.getAttribute('width'))).toBe(SCHEMATIC_LAYOUT.colWidth);
    expect(Number(slot?.getAttribute('height'))).toBe(SCHEMATIC_LAYOUT.rowHeight);
  });

  it('モードBとモードC2は同じ部品を通す（片方だけ古い図にならない）', () => {
    const b = render(<SchematicView document={docOf(B)} />);
    const bPaper = b.container.querySelector('[data-testid="schematic-paper"]');
    b.unmount();
    const c2 = render(<SchematicView document={docOf(C2)} onPickCell={vi.fn()} />);
    const c2Paper = c2.container.querySelector('[data-testid="schematic-paper"]');
    expect(bPaper?.getAttribute('fill')).toBe(c2Paper?.getAttribute('fill'));
    expect(c2.container.querySelector('[data-testid="schematic-frame"]')).toBeTruthy();
  });
});

describe('空の下書きが極端に拡大されない（UI監査バッチB・B1・2026-09-20）', () => {
  it('編集モードは空の下書きでも紙を最小寸法まで広げる（極端な拡大を防ぐ）', () => {
    const draft = emptySchematic('draft-probe', '下書き');
    // 読取専用は内容ぴったりの、とても小さい紙のまま
    const { container: readOnlyContainer, unmount } = render(<SchematicSvg document={draft} />);
    const [, , readOnlyW, readOnlyH] = viewBoxNumbers(
      readOnlyContainer.querySelector('svg') as Element,
    );
    unmount();
    // 編集モードは床（`SCHEMATIC_LAYOUT.colWidth * 6` 相当）まで広がる
    const { container } = render(
      <SchematicSvg document={draft} cursor={{ rungId: 'r1', index: 0 }} onPickSlot={vi.fn()} />,
    );
    const [, , w, h] = viewBoxNumbers(container.querySelector('svg') as Element);
    expect(w).toBeGreaterThan(readOnlyW);
    expect(h).toBeGreaterThan(readOnlyH);
    expect(w).toBeGreaterThanOrEqual((SCHEMATIC_LAYOUT.colWidth ?? 0) * 6);
    expect(h).toBeGreaterThanOrEqual((SCHEMATIC_LAYOUT.rowHeight ?? 0) * 3);
  });

  it('母線見出し（P(+24V) / N(0V)）は間隔が狭い下書きでも重ならない大きさへ自動で縮む', () => {
    const draft = emptySchematic('draft-probe', '下書き');
    const { container } = render(<SchematicSvg document={draft} />);
    const texts = [...container.querySelectorAll('text')];
    const p = texts.find((t) => t.textContent === 'P(+24V)');
    const n = texts.find((t) => t.textContent === 'N(0V)');
    expect(p).toBeDefined();
    expect(n).toBeDefined();
    if (p === undefined || n === undefined) return;
    // 既定の8論理単位のままでは重なるので、両方とも縮んでいるはず
    expect(Number(p.getAttribute('font-size'))).toBeLessThan(8);
    expect(Number(n.getAttribute('font-size'))).toBeLessThan(8);
    // 実際に重ならないことを、文字の見積り幅（描画側と同じ 0.62em）で確かめる
    const width = (t: Element): number =>
      (t.textContent ?? '').length * Number(t.getAttribute('font-size')) * 0.62;
    const pRight = Number(p.getAttribute('x')) + width(p); // P は anchor=start（右へ伸びる）
    const nLeft = Number(n.getAttribute('x')) - width(n); // N は anchor=end（左へ伸びる）
    expect(pRight).toBeLessThanOrEqual(nLeft);
  });

  it('段が育って間隔が十分あれば母線見出しは縮めない（内蔵課題 b-001）', () => {
    const { container } = render(<SchematicSvg document={docOf(B)} />);
    const texts = [...container.querySelectorAll('text')];
    const p = texts.find((t) => t.textContent === 'P(+24V)');
    expect(p).toBeDefined();
    expect(Number(p?.getAttribute('font-size'))).toBe(8);
  });
});
