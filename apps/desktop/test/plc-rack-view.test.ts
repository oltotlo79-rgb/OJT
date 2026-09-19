import { PLC_UNIT_JW300, PLC_UNIT_PC10G, type PlcUnitDefinition } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { RACK_BODY_Z_MM } from '../src/renderer/three/appearance.js';
import { rackModuleBoxes, rackTerminalsOf } from '../src/renderer/three/PlcRack.js';

/**
 * ラック形の3D（設計仕様 §10.1 / §17 #21 / §16 Phase 4 受入基準③⑤）。決定表#17
 * 端子は `unit.terminals` の平らな1本の配列のままで、モジュールに分け直さない（4A H-6）。
 */

describe('ラックの3D（§10.1 / §16 Phase 4 受入基準③⑤）', () => {
  it('lays the four TOYOPUC modules across the base, front of it', () => {
    const boxes = rackModuleBoxes(PLC_UNIT_PC10G);
    expect(boxes.map((box) => box.model)).toEqual(['POWER1', 'PC10G-1SP', 'IN-12', 'OUT-12']);
    for (const box of boxes) {
      expect(box.depthMm).toBe(RACK_BODY_Z_MM);
      // ベースの外形の内側に収まる
      expect(box.origin.x).toBeGreaterThanOrEqual(PLC_UNIT_PC10G.pos.x);
      expect(box.origin.x + box.appearance.faceMm.width).toBeLessThanOrEqual(
        PLC_UNIT_PC10G.pos.x + PLC_UNIT_PC10G.sizeMm.width,
      );
      expect(box.origin.y).toBeGreaterThanOrEqual(PLC_UNIT_PC10G.pos.y);
      expect(box.origin.y + box.appearance.faceMm.height).toBeLessThanOrEqual(
        PLC_UNIT_PC10G.pos.y + PLC_UNIT_PC10G.sizeMm.height,
      );
    }
    // 左から右へ、重ならずに並ぶ
    const xs = boxes.map((box) => box.origin.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('lays the four JW300 modules likewise', () => {
    expect(rackModuleBoxes(PLC_UNIT_JW300).map((box) => box.model)).toEqual([
      'JW-301PU',
      'JW-312CU',
      'JW-212NA',
      'JW-214SA',
    ]);
  });

  it('keeps every terminal on the rack, not on a module (4A H-6 / 決定表#17)', () => {
    const terminals = rackTerminalsOf(PLC_UNIT_PC10G);
    expect(terminals).toHaveLength(PLC_UNIT_PC10G.terminals.length);
    expect(terminals.map((t) => String(t.id))).toContain('PLC.ICOM0');
    // モジュール名は端子IDに入らない
    expect(terminals.every((t) => !String(t.id).includes('IN-12'))).toBe(true);
  });

  it('returns nothing for a one-piece unit', () => {
    /*
     * `modules: undefined` と**書かない**（レビュー I8）。`PlcUnitDefinition.modules` は
     * 任意の欄なので、`exactOptionalPropertyTypes` の下では `undefined` を明示的に代入できない。
     * 鍵ごと落とす。
     */
    const onePiece: PlcUnitDefinition = { ...PLC_UNIT_PC10G, form: 'unit' };
    delete onePiece.modules;
    expect(rackModuleBoxes(onePiece)).toEqual([]);
    // ラックのままなら4枚出る（`form` だけで分けていることの裏返し）
    expect(rackModuleBoxes(PLC_UNIT_PC10G)).toHaveLength(4);
  });
});
