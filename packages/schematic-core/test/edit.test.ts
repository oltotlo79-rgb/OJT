import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  at,
  crA,
  coil,
  editLabel,
  emptySchematic,
  lamp,
  MAX_CELLS_PER_RUNG,
  MAX_RUNGS,
  nextCellId,
  nextRungId,
  pbA,
  pbB,
  rung,
  rungHasLoad,
  BUS_N,
  BUS_P,
  createDocument,
  validateDocument,
  type SchematicDocument,
} from '../src/index.js';

/** 自己保持回路（§16 Phase 5 受入基準①）を素で組んだ文書。 */
function selfHold(): SchematicDocument {
  return createDocument('d1', '自己保持', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
    rung('r2', BUS_P, { rung: 'r1', node: 1 }, [crA('c3', 'CR1')]),
    rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL1')]),
  ]);
}

describe('emptySchematic（決定表#2）', () => {
  it('starts with one empty rung between the two buses', () => {
    const doc = emptySchematic('draft-b-001', '下書き');
    expect(doc.formatVersion).toBe(1);
    expect(doc.orientation).toBe('horizontal');
    expect(doc.rungs).toHaveLength(1);
    expect(doc.rungs[0]).toMatchObject({
      id: 'r1',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [],
    });
  });

  it('is not valid yet (the editor shows the reason instead of refusing edits)', () => {
    expect(validateDocument(emptySchematic('d', 't')).map((e) => e.message)).toContain(
      '段に要素がありません: r1',
    );
  });
});

describe('nextCellId / nextRungId', () => {
  it('numbers from the highest existing id', () => {
    expect(nextCellId(selfHold())).toBe('c6');
    expect(nextRungId(selfHold())).toBe('r4');
  });

  it('starts at 1 for an id-less document', () => {
    const doc = createDocument('d', 't', []);
    expect(nextCellId(doc)).toBe('c1');
    expect(nextRungId(doc)).toBe('r1');
  });

  it('ignores ids that do not follow the pattern', () => {
    const doc = createDocument('d', 't', [rung('自己保持', BUS_P, BUS_N, [coil('コイル', 'CR1')])]);
    expect(nextCellId(doc)).toBe('c1');
    expect(nextRungId(doc)).toBe('r1');
  });
});

describe('applyEdit: insertCell', () => {
  it('inserts at the cursor and gives the new cell a fresh id', () => {
    const doc = emptySchematic('d', 't');
    const out = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.rungs[0]?.cells).toEqual([{ kind: 'pb-a', id: 'c1', device: 'PB1' }]);
    // 入力の文書は変えない（履歴がスナップショットを持つため）
    expect(doc.rungs[0]?.cells).toHaveLength(0);
  });

  it('carries presetMs for a timer coil', () => {
    const doc = emptySchematic('d', 't');
    const out = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'coil', device: 'T1', presetMs: 3000 },
    });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toEqual({
      kind: 'coil',
      id: 'c1',
      device: 'T1',
      presetMs: 3000,
    });
  });

  it('refuses a device that the kind cannot use', () => {
    const out = applyEdit(emptySchematic('d', 't'), {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'lamp', device: 'CR1' },
    });
    expect(out).toEqual({ ok: false, message: 'lamp に使えない機器名です: CR1' });
  });

  it('refuses an index outside the rung', () => {
    const out = applyEdit(emptySchematic('d', 't'), {
      kind: 'insertCell',
      rungId: 'r1',
      index: 2,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    expect(out).toEqual({ ok: false, message: '段 r1 に桁 2 はありません（0〜0）' });
  });

  it('refuses an unknown rung', () => {
    const out = applyEdit(emptySchematic('d', 't'), {
      kind: 'insertCell',
      rungId: 'r9',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    expect(out).toEqual({ ok: false, message: '段がありません: r9' });
  });

  it('refuses more than MAX_CELLS_PER_RUNG in one rung', () => {
    let doc = emptySchematic('d', 't');
    for (let i = 0; i < MAX_CELLS_PER_RUNG; i += 1) {
      const step = applyEdit(doc, {
        kind: 'insertCell',
        rungId: 'r1',
        index: i,
        draft: { kind: 'cr-a', device: 'CR1' },
      });
      expect(step.ok).toBe(true);
      if (step.ok) doc = step.doc;
    }
    const out = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: MAX_CELLS_PER_RUNG,
      draft: { kind: 'cr-a', device: 'CR1' },
    });
    expect(out).toEqual({
      ok: false,
      message: `1つの段に置ける要素は${MAX_CELLS_PER_RUNG}個までです`,
    });
  });
});

describe('applyEdit: replaceCell / setDevice / setPreset / removeCell / moveCell', () => {
  it('replaces a cell keeping its id (so physicalOverride and highlights survive)', () => {
    const out = applyEdit(selfHold(), {
      kind: 'replaceCell',
      cellId: 'c1',
      draft: { kind: 'pb-b', device: 'PB2' },
    });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toEqual({ kind: 'pb-b', id: 'c1', device: 'PB2' });
  });

  it('drops presetMs when a timer coil becomes a relay coil', () => {
    const doc = createDocument('d', 't', [rung('r1', BUS_P, BUS_N, [coil('c1', 'T1', 3000)])]);
    const out = applyEdit(doc, { kind: 'setDevice', cellId: 'c1', device: 'CR1' });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toEqual({ kind: 'coil', id: 'c1', device: 'CR1' });
  });

  it('gives a relay coil the default preset when it becomes a timer coil', () => {
    const doc = createDocument('d', 't', [rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1')])]);
    const out = applyEdit(doc, { kind: 'setDevice', cellId: 'c1', device: 'T1' });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toMatchObject({ device: 'T1', presetMs: 3000 });
  });

  it('sets a timer preset', () => {
    const doc = createDocument('d', 't', [rung('r1', BUS_P, BUS_N, [coil('c1', 'T1', 3000)])]);
    const out = applyEdit(doc, { kind: 'setPreset', cellId: 'c1', presetMs: 5000 });
    expect(out.ok && out.doc.rungs[0]?.cells[0]?.presetMs).toBe(5000);
  });

  it('refuses a preset on a cell that cannot hold one', () => {
    const out = applyEdit(selfHold(), { kind: 'setPreset', cellId: 'c2', presetMs: 5000 });
    expect(out).toEqual({ ok: false, message: '設定時間を持てるのはタイマコイルだけです: c2' });
  });

  it('removes a cell', () => {
    const out = applyEdit(selfHold(), { kind: 'removeCell', cellId: 'c3' });
    expect(out.ok && out.doc.rungs[1]?.cells).toEqual([]);
  });

  it('moves a cell inside its rung', () => {
    const out = applyEdit(selfHold(), { kind: 'moveCell', cellId: 'c5', toIndex: 0 });
    expect(out.ok && out.doc.rungs[2]?.cells.map((c) => c.id)).toEqual(['c5', 'c4']);
  });

  it('refuses an unknown cell', () => {
    expect(applyEdit(selfHold(), { kind: 'removeCell', cellId: 'c9' })).toEqual({
      ok: false,
      message: '要素がありません: c9',
    });
  });
});

describe('applyEdit: addRung / removeRung / setEnds', () => {
  it('adds a rung right after the given one', () => {
    const out = applyEdit(selfHold(), { kind: 'addRung', after: 'r1' });
    expect(out.ok && out.doc.rungs.map((r) => r.id)).toEqual(['r1', 'r4', 'r2', 'r3']);
    expect(out.ok && out.doc.rungs[1]).toMatchObject({
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [],
    });
  });

  it('appends when `after` is omitted', () => {
    const out = applyEdit(selfHold(), { kind: 'addRung' });
    expect(out.ok && out.doc.rungs.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('refuses more than MAX_RUNGS', () => {
    let doc = emptySchematic('d', 't');
    for (let i = 1; i < MAX_RUNGS; i += 1) {
      const step = applyEdit(doc, { kind: 'addRung' });
      if (step.ok) doc = step.doc;
    }
    expect(applyEdit(doc, { kind: 'addRung' })).toEqual({
      ok: false,
      message: `段は${MAX_RUNGS}本までです`,
    });
  });

  it('removes a rung and repoints the rungs that branched off it', () => {
    const out = applyEdit(selfHold(), { kind: 'removeRung', rungId: 'r1' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.rungs.map((r) => r.id)).toEqual(['r2', 'r3']);
    // r2 は r1 の節点へ合流していた。行き先が消えたので右母線へ付け替える
    expect(out.doc.rungs[0]?.to).toEqual({ bus: 'N' });
  });

  it('refuses removing the last rung', () => {
    expect(applyEdit(emptySchematic('d', 't'), { kind: 'removeRung', rungId: 'r1' })).toEqual({
      ok: false,
      message: '最後の1段は消せません',
    });
  });

  it('sets the ends of a rung (branch)', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r1', node: 1 },
      to: BUS_N,
    });
    expect(out.ok && out.doc.rungs[2]?.from).toEqual({ rung: 'r1', node: 1 });
  });

  it('refuses an end that points at a rung that is not there', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r9', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段がありません: r9' });
  });

  it('refuses a rung that points at itself', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r3', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段が自分自身を参照しています: r3' });
  });

  it('refuses ends that would make the rungs reference each other in a ring', () => {
    // r2 の始点は r1 の節点0（＝r1 の始点）を指している。ここで r1 の始点を r2 の節点0へ
    // 向けると `r1#0 → r2#0 → r1#0` の輪になり、`layout()` も `toSession()` も
    // 節点を解決できない（`resolveNode()` が undefined を返す）
    const doc = createDocument('d', 't', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', { rung: 'r1', node: 0 }, { rung: 'r1', node: 1 }, [crA('c3', 'CR1')]),
    ]);
    const out = applyEdit(doc, {
      kind: 'setEnds',
      rungId: 'r1',
      from: { rung: 'r2', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段の端点が循環します: r1' });
  });

  it('names whichever rung actually stopped resolving, not always the edited one (I2)', () => {
    // 同じ「輪」だが、今度は依存されている側（r2）を配列の先頭に置く。輪は r1 と r2 の
    // どちらからも解決できなくなるので、（rungId=r1 に決め打ちせず）先に見つかった方の
    // IDを文面に出す。
    const doc = createDocument('d', 't', [
      rung('r2', { rung: 'r1', node: 0 }, { rung: 'r1', node: 1 }, [crA('c3', 'CR1')]),
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
    ]);
    const out = applyEdit(doc, {
      kind: 'setEnds',
      rungId: 'r1',
      from: { rung: 'r2', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段の端点が循環します: r2' });
  });

  it('does not blame the edited rung for another rung’s pre-existing stale reference (I2)', () => {
    // r2 は最初から壊れている（r1 に無い節点9を指す）。r1 への `setEnds` は輪を作らないので、
    // r2 のもともとの壊れ方まで今回の編集のせいにして断ってはいけない。
    const doc = createDocument('d', 't', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', { rung: 'r1', node: 9 }, BUS_N, [lamp('c3', 'PL1')]),
    ]);
    const out = applyEdit(doc, { kind: 'setEnds', rungId: 'r1', from: BUS_P, to: BUS_N });
    expect(out.ok).toBe(true);
  });

  it('clamps another rung’s branch ends when removeCell shrinks the referenced rung (I1)', () => {
    // r2 は r1 の節点2（c2 と c3 のあいだ）を指す分岐。r1 から2個消して1個（coil）だけにすると、
    // 節点2は範囲外になる。新しい末尾（節点1 ＝ coil の右側 ＝ r1.to）へ引き寄せられるはず。
    const doc = createDocument('d', 't', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), pbB('c2', 'PB2'), coil('c3', 'CR1')]),
      rung('r2', BUS_P, at('r1', 2), [crA('c4', 'CR1'), lamp('c5', 'PL1')]),
    ]);
    const step1 = applyEdit(doc, { kind: 'removeCell', cellId: 'c1' });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    const step2 = applyEdit(step1.doc, { kind: 'removeCell', cellId: 'c2' });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.doc.rungs[0]?.cells).toEqual([{ kind: 'coil', id: 'c3', device: 'CR1' }]);
    expect(step2.doc.rungs[1]?.to).toEqual({ rung: 'r1', node: 1 });
    expect(validateDocument(step2.doc)).toEqual([]);
    // I1 の対象は元の文書を変えない
    expect(doc.rungs[1]?.to).toEqual({ rung: 'r1', node: 2 });
  });

  it('draws b-001 self-hold branch (受入基準①と同じ形)', () => {
    // 段1 = PB2 b接点 → PB1 a接点 → CR1 コイル、段2 = CR1 a接点（節点1 → 節点2 の分岐）
    const doc = createDocument('d', '自己保持', [
      rung('r1', BUS_P, BUS_N, [pbB('c1', 'PB2'), pbA('c2', 'PB1'), coil('c3', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c4', 'CR1')]),
      rung('r3', BUS_P, BUS_N, [crA('c5', 'CR1'), lamp('c6', 'PL1')]),
    ]);
    const out = applyEdit(doc, {
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(validateDocument(out.doc)).toEqual([]);
  });
});

/**
 * 断る場面の文面（決定表#3 の「表せない編集」だけを断る側）。
 * 指摘はそのまま画面に出るので、どの操作から来ても同じ言い回しであることを確かめる。
 */
describe('applyEdit: 断る場面', () => {
  const RANGE = 'タイマの設定時間は 100〜60000ms の整数です';

  it('refuses a timer preset outside the range, wherever it comes from', () => {
    const doc = createDocument('d', 't', [rung('r1', BUS_P, BUS_N, [coil('c1', 'T1', 3000)])]);
    expect(applyEdit(doc, { kind: 'setPreset', cellId: 'c1', presetMs: 50 })).toEqual({
      ok: false,
      message: `${RANGE}: 50`,
    });
    expect(
      applyEdit(doc, {
        kind: 'replaceCell',
        cellId: 'c1',
        draft: { kind: 'coil', device: 'T2', presetMs: 90_000 },
      }),
    ).toEqual({ ok: false, message: `${RANGE}: 90000` });
    expect(
      applyEdit(emptySchematic('d', 't'), {
        kind: 'insertCell',
        rungId: 'r1',
        index: 0,
        draft: { kind: 'coil', device: 'T1', presetMs: 1500.5 },
      }),
    ).toEqual({ ok: false, message: `${RANGE}: 1500.5` });
  });

  it('refuses every edit that names a rung that is not there', () => {
    const missing = { ok: false, message: '段がありません: r9' };
    expect(applyEdit(selfHold(), { kind: 'addRung', after: 'r9' })).toEqual(missing);
    expect(applyEdit(selfHold(), { kind: 'removeRung', rungId: 'r9' })).toEqual(missing);
    expect(
      applyEdit(selfHold(), { kind: 'setEnds', rungId: 'r9', from: BUS_P, to: BUS_N }),
    ).toEqual(missing);
  });

  it('refuses an end whose node number is outside the parent rung', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r1', node: 9 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '参照先の節点番号が範囲外です: r1#9（0〜2）' });
  });

  it('refuses moving a cell outside its own rung', () => {
    expect(applyEdit(selfHold(), { kind: 'moveCell', cellId: 'c4', toIndex: 5 })).toEqual({
      ok: false,
      message: '段 r3 に桁 5 はありません（0〜1）',
    });
  });

  it('refuses a device name that the kind cannot use when only the name changes', () => {
    expect(applyEdit(selfHold(), { kind: 'setDevice', cellId: 'c5', device: 'CR1' })).toEqual({
      ok: false,
      message: 'lamp に使えない機器名です: CR1',
    });
  });
});

describe('rungHasLoad（パレットの出し分け）', () => {
  it('tells which rung already holds a load', () => {
    const doc = selfHold();
    expect(doc.rungs.map((r) => rungHasLoad(r))).toEqual([true, false, true]);
  });
});

describe('editLabel（操作ログ）', () => {
  it('describes every edit kind in Japanese', () => {
    expect(editLabel({ kind: 'addRung' })).toBe('段を追加');
    expect(editLabel({ kind: 'removeRung', rungId: 'r1' })).toBe('段を削除（r1）');
    expect(
      editLabel({
        kind: 'insertCell',
        rungId: 'r1',
        index: 0,
        draft: { kind: 'pb-a', device: 'PB1' },
      }),
    ).toBe('押ボタン a接点 PB1 を配置');
    expect(editLabel({ kind: 'setPreset', cellId: 'c1', presetMs: 3000 })).toBe(
      '設定時間を 3.0秒 に変更',
    );
    expect(editLabel({ kind: 'setEnds', rungId: 'r1', from: BUS_P, to: BUS_N })).toBe(
      '段の両端を P母線 → N母線 に変更',
    );
  });

  it('describes the remaining kinds (the log must never show a blank line)', () => {
    expect(
      editLabel({ kind: 'replaceCell', cellId: 'c1', draft: { kind: 'lamp', device: 'PL1' } }),
    ).toBe('表示灯 PL1 に置き換え');
    expect(editLabel({ kind: 'removeCell', cellId: 'c1' })).toBe('要素を削除');
    expect(editLabel({ kind: 'setDevice', cellId: 'c1', device: 'CR2' })).toBe(
      '機器名を CR2 に変更',
    );
    expect(editLabel({ kind: 'moveCell', cellId: 'c1', toIndex: 0 })).toBe('要素を移動');
    expect(
      editLabel({ kind: 'setEnds', rungId: 'r2', from: { rung: 'r1', node: 1 }, to: BUS_N }),
    ).toBe('段の両端を r1 の節点1 → N母線 に変更');
  });
});
