import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, verifySchematic } from '@ojt/content';
import {
  applyEdit,
  emptySchematic,
  type RungEnd,
  type SchematicDocument,
} from '@ojt/schematic-core';
import type * as SchematicCore from '@ojt/schematic-core';
import { cleanup, render } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchematicEditor } from '../src/renderer/schematic/SchematicEditor.js';

/**
 * Plan 5 Batch B レビューの3点（B1 / I5・I6 / I7）を、それぞれ一番近いところで確かめる。
 *
 * - B1: パレットで置いたタイマコイルの設定時間を変えられないと、0.8秒のフリッカ回路（b-006）は
 *   どう描いても検算に通らない。**`@ojt/content` の検算そのもの**で通ることを確かめる
 * - I7: `onPickSlot` を `useCallback` で包まないと `SchematicSvg` の当たり矩形の `useMemo` が
 *   毎回捨てられる。`slotRects()` の呼び出し回数で見る
 * - I5 / I6: 画面の寸法は CSS にしか書けないので、規則そのものを読んで確かめる
 *   （`test/ladder-layout.test.tsx` と同じ流儀）
 */

/** `slotRects()` の呼び出しを数える（中身は本物）。 */
const spies = vi.hoisted(() => ({ slotRects: vi.fn() }));
vi.mock('@ojt/schematic-core', async (importOriginal) => {
  const actual = await importOriginal<typeof SchematicCore>();
  spies.slotRects.mockImplementation(actual.slotRects);
  return { ...actual, slotRects: spies.slotRects };
});

const foundFlicker = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-006');
const foundSelfHold = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (foundFlicker === undefined || foundSelfHold === undefined) {
  throw new Error('内蔵課題がありません');
}
/** 巻き上げられる関数宣言の中でも `undefined` を外した型でいるように、別名にしてから使う。 */
const flicker = foundFlicker;
const selfHold = foundSelfHold;

afterEach(() => {
  cleanup();
});

/**
 * 課題の模範回路を「エディタが出せる編集だけ」で描き直す（IDは付け直される）。
 * `presetMs` を渡すとタイマコイルの設定時間を `setPreset` で変える（B1 の欄がやること）。
 */
function redraw(problem: typeof flicker, presetMs?: number): SchematicDocument {
  let doc = emptySchematic(`draft-${problem.id}`, '下書き');
  const step = (edit: Parameters<typeof applyEdit>[1]): void => {
    const outcome = applyEdit(doc, edit);
    if (!outcome.ok) throw new Error(outcome.message);
    doc = outcome.doc;
  };
  /** 課題の段ID → 描き直した段ID。 */
  const ids = new Map<string, string>();
  problem.schematic.rungs.forEach((rung, index) => {
    if (index > 0) step({ kind: 'addRung' });
    const created = doc.rungs[doc.rungs.length - 1];
    if (created === undefined) throw new Error('段が作れませんでした');
    ids.set(rung.id, created.id);
  });
  const mapped = (rungId: string): string => {
    const found = ids.get(rungId);
    if (found === undefined) throw new Error(`段がありません: ${rungId}`);
    return found;
  };
  for (const rung of problem.schematic.rungs) {
    rung.cells.forEach((cell, index) => {
      step({
        kind: 'insertCell',
        rungId: mapped(rung.id),
        index,
        draft: { kind: cell.kind, device: cell.device },
      });
    });
  }
  const end = (value: RungEnd): RungEnd =>
    'bus' in value ? value : { rung: mapped(value.rung), node: value.node };
  for (const rung of problem.schematic.rungs) {
    step({ kind: 'setEnds', rungId: mapped(rung.id), from: end(rung.from), to: end(rung.to) });
  }
  if (presetMs === undefined) return doc;
  for (const rung of doc.rungs) {
    for (const cell of rung.cells) {
      if (cell.kind === 'coil' && cell.device.startsWith('T')) {
        step({ kind: 'setPreset', cellId: cell.id, presetMs });
      }
    }
  }
  return doc;
}

describe('設定時間（レビュー B1: `setPreset` が無いと b-006 は絶対に通らない）', () => {
  it('passes 検算 only once the timer coils are set to 0.8 s', () => {
    // 置いたまま（既定の 3.0 秒）では点滅が合わず不合格になる
    const asPlaced = verifySchematic(flicker, JIPM_BOARD, redraw(flicker));
    expect(asPlaced.ok).toBe(true);
    if (asPlaced.ok) expect(asPlaced.passed).toBe(false);
    // 設定時間の欄で 0.8 秒にすると合格する（受入基準の「b-006 が描ける」）
    const asSet = verifySchematic(flicker, JIPM_BOARD, redraw(flicker, 800));
    expect(asSet.ok).toBe(true);
    if (asSet.ok) expect(asSet.passed).toBe(true);
  });
});

describe('当たり矩形の作り直し（レビュー I7）', () => {
  function props(overrides: Record<string, unknown> = {}) {
    return {
      problem: selfHold,
      board: JIPM_BOARD,
      document: selfHold.schematic,
      cursor: { rungId: 'r1', index: 0 },
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(() => true),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    spies.slotRects.mockClear();
  });

  it('keeps the slot rects while the document does not change', () => {
    const { rerender } = render(<SchematicEditor {...props()} />);
    const first = spies.slotRects.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    // 中身の同じ別物を渡して描き直させる（親が毎回作り直す props の再現）
    rerender(<SchematicEditor {...props({ history: { done: [], undone: [] } })} />);
    expect(spies.slotRects.mock.calls.length).toBe(first);
  });

  it('rebuilds them when the document changes', () => {
    const { rerender } = render(<SchematicEditor {...props()} />);
    const first = spies.slotRects.mock.calls.length;
    const added = applyEdit(selfHold.schematic, { kind: 'addRung' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    rerender(<SchematicEditor {...props({ document: added.doc })} />);
    expect(spies.slotRects.mock.calls.length).toBeGreaterThan(first);
  });
});

/* --- 画面の寸法（CSS）。`test/ladder-layout.test.tsx` と同じ読み方 --- */

function read(rel: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/desktop')]) {
    const path = resolve(base, rel);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${rel} が見つからない（cwd: ${process.cwd()}）`);
}

/** コメントを落とす（注釈に書いた寸法まで拾わないように）。 */
function declarations(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '');
}

/** その規則の中身（`.schematicBox { … }`）。 */
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

const SCREENS_CSS = declarations(read('src/renderer/screens/screens.module.css'));
const VIEW_CSS = declarations(read('src/renderer/schematic/schematic-view.module.css'));

describe('回路図ヒントの箱（レビュー I5: 「⤢ 拡大」が切り落とされない）', () => {
  it('leaves room above the drawing for the enlarge button', () => {
    // ボタンは紙の上（`top: -28px`）に出る
    const offset = /top:\s*(-?\d+)px/u.exec(block(VIEW_CSS, '.enlargeButton'))?.[1];
    expect(offset).toBeDefined();
    const needed = Math.abs(Number(offset));
    const box = block(SCREENS_CSS, '.schematicBox');
    // `overflow: auto` の箱なので、上に同じだけの余白が無いとボタンが隠れて押せない
    expect(box).toContain('overflow: auto');
    const padding = /padding:\s*(\d+)px/u.exec(box)?.[1];
    expect(padding).toBeDefined();
    expect(Number(padding)).toBeGreaterThanOrEqual(needed);
    // 高さの頭打ち（右パネルが回路図で埋まらないようにする）はそのまま
    expect(box).toContain('max-height: 320px');
  });
});

describe('「並べて」の折り返し（レビュー I6: 1280×800 で回路図が潰れない）', () => {
  it('stacks the split view below 1440px', () => {
    const found = /@media \(max-width: (\d+)px\) \{\s*\.sessionLayout\[data-view='split'\]/u.exec(
      SCREENS_CSS,
    );
    expect(found).not.toBeNull();
    const breakpoint = Number(found?.[1]);
    // 1280px は3列（360 + 360 + 380）が入らないので、積み替える側に入っていること
    expect(breakpoint).toBeGreaterThanOrEqual(1439);
    expect(breakpoint).toBeGreaterThanOrEqual(1280);
  });
});
