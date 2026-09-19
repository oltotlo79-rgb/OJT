import { describe, expect, it } from 'vitest';
import {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  crA,
  crB,
  createDocument,
  documentDevices,
  isContactCell,
  isLoadCell,
  lamp,
  pbA,
  pbB,
  rung,
  rungNodeCount,
  SCHEMATIC_FORMAT_VERSION,
  tA,
  tB,
  validateDocument,
  type SchematicCell,
} from '../src/index.js';
import { flickerDoc, interlockDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

describe('document: 展開接続図の文書モデル（§11.1）', () => {
  it('横書き・formatVersion を持つ', () => {
    const doc = selfHoldDoc();
    expect(doc.formatVersion).toBe(SCHEMATIC_FORMAT_VERSION);
    expect(doc.orientation).toBe('horizontal');
    expect(validateDocument(doc)).toEqual([]);
    expect(validateDocument(flickerDoc())).toEqual([]);
  });

  it('要素の分類と節点数', () => {
    expect(isLoadCell(coil('x', 'CR1'))).toBe(true);
    expect(isLoadCell(lamp('x', 'PL1'))).toBe(true);
    expect(isLoadCell(buzzer('x'))).toBe(true);
    expect(isContactCell(crA('x', 'CR1'))).toBe(true);
    expect(isContactCell(tB('x', 'T1'))).toBe(true);
    expect(rungNodeCount(rung('r', BUS_P, BUS_N, [crA('a', 'CR1'), coil('b', 'CR2')]))).toBe(3);
    expect(documentDevices(selfHoldDoc())).toEqual(['PB2', 'PB1', 'CR1', 'PL1']);
  });

  it('未知のバージョン・向きを弾く（§13 #8）', () => {
    const doc = { ...selfHoldDoc(), formatVersion: 99 };
    expect(validateDocument(doc)[0]?.path).toBe('formatVersion');
    const vertical = { ...selfHoldDoc(), orientation: 'vertical' as unknown as 'horizontal' };
    expect(validateDocument(vertical)[0]?.message).toBe(
      '文書モデルは常に横書き（左P・右N）で保持します',
    );
    expect(validateDocument(createDocument('x', '空', []))[0]?.path).toBe('rungs');
  });

  it('機器名の妥当性を見る', () => {
    const bad = createDocument('x', '不正', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'CR1'), coil('c2', 'PL1')]),
    ]);
    const errors = validateDocument(bad).map((e) => e.message);
    // 「〜に使えない機器名です」の種別名は日本語ラベル（`CELL_KIND_LABELS`）。edit.ts の
    // `deviceProblem()` と言い回しをそろえる（M-a）。
    expect(errors).toContain('押ボタン a接点 に使えない機器名です: CR1');
    expect(errors).toContain('コイル に使えない機器名です: PL1');
  });

  it('タイマコイルには presetMs が要る／他の要素には置けない（§5.3.2）', () => {
    const noPreset = createDocument('x', 'タイマ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), { kind: 'coil', id: 'c2', device: 'T1' }]),
    ]);
    expect(validateDocument(noPreset).map((e) => e.message)).toContain(
      'タイマコイルには presetMs が必要です: T1',
    );
    const strayPreset = createDocument('x', 'ランプ', [
      rung('r1', BUS_P, BUS_N, [{ kind: 'lamp', id: 'c1', device: 'PL1', presetMs: 100 }]),
    ]);
    expect(validateDocument(strayPreset).map((e) => e.message)).toContain(
      'presetMs を持てるのはタイマコイルだけです: c1',
    );
  });

  it('ID重複・空の段・自己参照・範囲外の節点を弾く', () => {
    const dup = createDocument('x', '重複', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1')]),
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR2')]),
    ]);
    const messages = validateDocument(dup).map((e) => e.message);
    expect(messages).toContain('段IDが重複しています: r1');
    expect(messages).toContain('要素IDが重複しています: c1');

    const empty = createDocument('x', '空段', [rung('r1', BUS_P, BUS_N, [])]);
    expect(validateDocument(empty).map((e) => e.message)).toContain('段に要素がありません: r1');

    const selfRef = createDocument('x', '自己参照', [
      rung('r1', at('r1', 0), BUS_N, [coil('c1', 'CR1')]),
    ]);
    expect(validateDocument(selfRef).map((e) => e.message)).toContain(
      '段が自分自身を参照しています: r1',
    );

    const unknown = createDocument('x', '未知参照', [
      rung('r1', at('rX', 0), BUS_N, [coil('c1', 'CR1')]),
    ]);
    expect(validateDocument(unknown).map((e) => e.message)).toContain('参照先の段がありません: rX');

    const outOfRange = createDocument('x', '範囲外', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1')]),
      rung('r2', at('r1', 5), at('r1', 1), [crA('c2', 'CR1')]),
    ]);
    expect(validateDocument(outOfRange).map((e) => e.message)).toContain(
      '参照先の節点番号が範囲外です: r1#5（0〜1）',
    );
  });

  it('右母線に至る段は負荷で終わり、分岐段には負荷を置けない（§11.1）', () => {
    const noLoad = createDocument('x', '負荷なし', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), crB('c2', 'CR1')]),
    ]);
    expect(validateDocument(noLoad).map((e) => e.message)).toContain(
      '右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: r1',
    );

    const branchLoad = createDocument('x', '分岐に負荷', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 0), at('r1', 1), [lamp('c3', 'PL1')]),
    ]);
    expect(validateDocument(branchLoad).map((e) => e.message)).toContain(
      '分岐段（右母線に至らない段）に負荷は置けません: r2',
    );

    const twoLoads = createDocument('x', '負荷2つ', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1'), lamp('c2', 'PL1')]),
    ]);
    expect(validateDocument(twoLoads).map((e) => e.message)).toContain(
      '1つの段に負荷は1つだけです: r1',
    );
  });

  it('端点は解決してから判定する（母線の向き）', () => {
    // 始点N・終点P。PB2経由でP-N間を短絡するので弾く
    const reversed = createDocument('x', '逆向き', [rung('r1', BUS_N, BUS_P, [pbA('c1', 'PB2')])]);
    const errors = validateDocument(reversed);
    expect(errors.map((e) => `${e.path}: ${e.message}`)).toContain(
      'rungs[0].from: 段の始点が N 母線です',
    );
    expect(errors.map((e) => `${e.path}: ${e.message}`)).toContain(
      'rungs[0].to: 段の終点が P 母線です',
    );
  });

  it('参照でP-N間に届く段も負荷の規則で判定する（§11.1）', () => {
    const base = (): ReturnType<typeof rung> =>
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]);

    // at(r1,0)=P / at(r1,2)=N なので、接点だけの段はP-N間の短絡になる
    const acrossBus = createDocument('x', '母線間の接点', [
      base(),
      rung('r2', at('r1', 0), at('r1', 2), [crA('c3', 'CR1')]),
    ]);
    expect(validateDocument(acrossBus).map((e) => e.message)).toContain(
      '右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: r2',
    );

    // at(r1,1)→at(r1,2) はコイルをまたぐ短絡
    const acrossCoil = createDocument('x', 'コイルをまたぐ接点', [
      base(),
      rung('r2', at('r1', 1), at('r1', 2), [crA('c3', 'CR1')]),
    ]);
    expect(validateDocument(acrossCoil).map((e) => e.message)).toContain(
      '右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: r2',
    );

    // 同じ参照でも負荷で終われば普通の並列段なので通す
    const parallel = createDocument('x', '並列段', [
      base(),
      rung('r2', at('r1', 0), at('r1', 2), [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    expect(validateDocument(parallel)).toEqual([]);
  });

  it('端点の循環参照と、始点＝終点を弾く', () => {
    const cyclic = createDocument('x', '循環', [
      rung('r1', at('r2', 0), BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 0), BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    expect(validateDocument(cyclic)).toContainEqual({
      path: 'rungs[0].from',
      message: '段の端点が循環参照しています: rungs[0].from',
    });

    // 途中の段が範囲外の節点を指していると端点は解決できない（理由はその段に出る）
    const brokenChain = createDocument('x', '解決不能', [
      rung('r1', at('r2', 0), BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r3', 9), BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [pbA('c5', 'PB2'), lamp('c6', 'PL2')]),
    ]);
    expect(validateDocument(brokenChain).map((e) => `${e.path}: ${e.message}`)).toEqual([
      'rungs[1].from: 参照先の節点番号が範囲外です: r3#9（0〜2）',
    ]);

    const sameNode = createDocument('x', '始点＝終点', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 1), at('r1', 1), [crA('c3', 'CR1')]),
    ]);
    expect(validateDocument(sameNode)).toEqual([
      { path: 'rungs[1]', message: '段の始点と終点が同じ節点です: r2' },
    ]);
  });

  it('タイマの設定時間はレンジに載る整数だけ（§5.3.2）', () => {
    const timerDoc = (presetMs: number): ReturnType<typeof createDocument> =>
      createDocument('x', 'タイマ', [
        rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', presetMs)]),
      ]);
    expect(validateDocument(timerDoc(1))).toEqual([
      {
        path: 'rungs[0].cells[1].presetMs',
        message: 'タイマの設定時間は 100〜60000ms の整数です: 1',
      },
    ]);
    expect(validateDocument(timerDoc(90_000)).map((e) => e.message)).toEqual([
      'タイマの設定時間は 100〜60000ms の整数です: 90000',
    ]);
    expect(validateDocument(timerDoc(1500.5)).map((e) => e.message)).toEqual([
      'タイマの設定時間は 100〜60000ms の整数です: 1500.5',
    ]);
    expect(validateDocument(timerDoc(100))).toEqual([]);
    expect(validateDocument(timerDoc(60_000))).toEqual([]);
  });

  it('未知の要素種別を弾く', () => {
    const doc = createDocument('x', '未知種別', [
      rung('r1', BUS_P, BUS_N, [
        { kind: 'relay' as unknown as 'coil', id: 'c1', device: 'CR1' },
        coil('c2', 'CR1'),
      ]),
    ]);
    expect(validateDocument(doc).map((e) => e.message)).toContain('未知の要素種別です: relay');
  });

  it('母線につながらない段を弾く（つないでも電流の流れない死んだ回路）', () => {
    // 互いの内部節点を指し合う2段。循環参照ではない（resolveEnd は内部節点で止まる）が、
    // どちらもP母線に届かないので、割当も配線も通るのに全く動かない回路になる
    const floating = createDocument('x', '浮いた2段', [
      rung('r1', at('r2', 1), BUS_N, [crA('c1', 'CR1'), coil('c2', 'CR2')]),
      rung('r2', at('r1', 1), BUS_N, [crA('c3', 'CR2'), coil('c4', 'CR1')]),
    ]);
    expect(validateDocument(floating)).toEqual([
      { path: 'rungs[0]', message: '段が P 母線につながっていません: r1' },
      { path: 'rungs[1]', message: '段が P 母線につながっていません: r2' },
    ]);

    // 健全な段の隣にぶら下がる孤島。N母線にしか触れていない（母線は通り抜けない）
    const island = createDocument('x', '孤島', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r3', 1), BUS_N, [crA('c3', 'CR2'), lamp('c4', 'PL1')]),
      rung('r3', at('r2', 1), BUS_N, [crA('c5', 'CR1'), coil('c6', 'CR2')]),
    ]);
    expect(validateDocument(island).map((e) => `${e.path}: ${e.message}`)).toEqual([
      'rungs[1]: 段が P 母線につながっていません: r2',
      'rungs[2]: 段が P 母線につながっていません: r3',
    ]);

    // P母線には触れるがN母線へ戻れない枝（同じく電流が流れない）
    const noReturn = createDocument('x', 'N母線へ戻れない枝', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, at('r3', 1), [crA('c3', 'CR1'), crA('c4', 'CR1')]),
      rung('r3', BUS_P, at('r2', 1), [crA('c5', 'CR1'), crA('c6', 'CR1')]),
    ]);
    expect(validateDocument(noReturn).map((e) => `${e.path}: ${e.message}`)).toEqual([
      'rungs[1]: 段が N 母線につながっていません: r2',
      'rungs[2]: 段が N 母線につながっていません: r3',
    ]);

    // 手本の回路はすべて両母線につながる
    for (const doc of [selfHoldDoc(), interlockDoc(), onDelayDoc(), flickerDoc()]) {
      expect(validateDocument(doc)).toEqual([]);
    }
  });

  it('presetMs は明示的な undefined も受ける（zod由来の文書との互換。§13 #8）', () => {
    // `.optional()` の推論は `number | undefined`。exactOptionalPropertyTypes 下でも代入できる
    const explicitUndefined: SchematicCell = {
      kind: 'coil',
      id: 'c2',
      device: 'CR1',
      presetMs: undefined,
    };
    expect(explicitUndefined).toEqual(coil('c2', 'CR1', undefined));
    expect(Object.hasOwn(coil('c2', 'CR1', undefined), 'presetMs')).toBe(false);
    const doc = createDocument('x', '明示的undefined', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), explicitUndefined]),
    ]);
    expect(validateDocument(doc)).toEqual([]);
  });

  it('要素の生成ヘルパ', () => {
    expect(pbB('c', 'PB3')).toEqual({ kind: 'pb-b', id: 'c', device: 'PB3' });
    expect(tA('c', 'T2')).toEqual({ kind: 't-a', id: 'c', device: 'T2' });
    expect(coil('c', 'T1', 500)).toEqual({ kind: 'coil', id: 'c', device: 'T1', presetMs: 500 });
    expect(buzzer('c')).toEqual({ kind: 'buzzer', id: 'c', device: 'BZ' });
  });
});
