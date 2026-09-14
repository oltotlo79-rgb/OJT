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
} from '../src/index.js';
import { flickerDoc, selfHoldDoc } from './helpers/docs.js';

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
    expect(errors).toContain('pb-a に使えない機器名です: CR1');
    expect(errors).toContain('coil に使えない機器名です: PL1');
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

  it('未知の要素種別を弾く', () => {
    const doc = createDocument('x', '未知種別', [
      rung('r1', BUS_P, BUS_N, [
        { kind: 'relay' as unknown as 'coil', id: 'c1', device: 'CR1' },
        coil('c2', 'CR1'),
      ]),
    ]);
    expect(validateDocument(doc).map((e) => e.message)).toContain('未知の要素種別です: relay');
  });

  it('要素の生成ヘルパ', () => {
    expect(pbB('c', 'PB3')).toEqual({ kind: 'pb-b', id: 'c', device: 'PB3' });
    expect(tA('c', 'T2')).toEqual({ kind: 't-a', id: 'c', device: 'T2' });
    expect(coil('c', 'T1', 500)).toEqual({ kind: 'coil', id: 'c', device: 'T1', presetMs: 500 });
    expect(buzzer('c')).toEqual({ kind: 'buzzer', id: 'c', device: 'BZ' });
  });
});
