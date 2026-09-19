import {
  PC10G_SPEC,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { litLedKeys, RACK_BODY_Z_MM, type PlcLedState } from '../src/renderer/three/appearance.js';
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

describe('ラックの外観の記述（4B レビュー M12）', () => {
  const OFF: PlcLedState = {
    running: false,
    convertFailed: false,
    inputs: undefined,
    outputs: undefined,
  };

  it('keeps every drawn rect inside the face, base and modules alike (面からはみ出さない)', () => {
    for (const unit of [PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
      const faces = [unit.appearance, ...(unit.modules ?? []).map((m) => m.appearance)];
      for (const face of faces) {
        const rects = [
          ...face.covers.map((cover) => cover.rect),
          ...face.features.map((feature) => feature.rect),
          ...face.leds.map((led) => led.rect),
          face.nameplateRect,
        ];
        for (const rect of rects) {
          const where = `${unit.model}/${face.nameplate}`;
          expect(rect.x, where).toBeGreaterThanOrEqual(0);
          expect(rect.y, where).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w, where).toBeLessThanOrEqual(face.faceMm.width);
          expect(rect.y + rect.h, where).toBeLessThanOrEqual(face.faceMm.height);
        }
      }
    }
  });

  it('keeps the CPU fault lamps dark while the session is idle', () => {
    for (const unit of [PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
      for (const module of unit.modules ?? []) {
        const lit = litLedKeys(module.appearance, OFF);
        expect(lit.has('status:ERR'), module.model).toBe(false);
        expect(lit.has('status:FLT'), module.model).toBe(false);
        expect(lit.has('status:RUN'), module.model).toBe(false);
      }
    }
    // 電源モジュールの POWER だけは常時点灯（本アプリはAC電源を解かない。決定表#20）
    const power = (PLC_UNIT_PC10G.modules ?? [])[0];
    expect([...litLedKeys(power!.appearance, OFF)]).toEqual(['status:POWER']);
  });

  it('orders the point lamps the way the monitor snapshot is indexed', () => {
    const input = (PLC_UNIT_PC10G.modules ?? []).find((m) => m.model === 'IN-12');
    const output = (PLC_UNIT_PC10G.modules ?? []).find((m) => m.model === 'OUT-12');
    expect(input?.appearance.leds.map((led) => led.name)).toEqual(
      PC10G_SPEC.inputs.map((i) => i.name),
    );
    expect(output?.appearance.leds.map((led) => led.name)).toEqual(
      PC10G_SPEC.outputs.map((o) => o.name),
    );
    // `spec.inputs` の3番目が ON なら、3番目のLEDが光る（`litLedKeys` は群ごとに数える）
    const inputs = PC10G_SPEC.inputs.map((_unused, index) => index === 3);
    expect([...litLedKeys(input!.appearance, { ...OFF, inputs })]).toEqual([
      `input:${PC10G_SPEC.inputs[3]?.name ?? ''}`,
    ]);
    const outputs = PC10G_SPEC.outputs.map((_unused, index) => index === 9);
    expect([...litLedKeys(output!.appearance, { ...OFF, outputs })]).toEqual([
      `output:${PC10G_SPEC.outputs[9]?.name ?? ''}`,
    ]);
  });

  it('pins the nameplates the 3D prints (型式の文字列だけ。§17)', () => {
    expect(PLC_UNIT_PC10G.appearance.nameplate).toBe('PC10G-1SP');
    expect(PLC_UNIT_JW300.appearance.nameplate).toBe('JW-300');
    for (const unit of [PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
      // モジュールの銘板＝形式名（3Dの名札もこれを出す。4B レビュー I4）
      for (const box of rackModuleBoxes(unit)) {
        expect(box.appearance.nameplate).toBe(box.model);
        expect(box.displayName).not.toBe(box.model);
      }
    }
    expect(rackModuleBoxes(PLC_UNIT_JW300).map((box) => box.displayName)).toEqual([
      '電源ユニット',
      'コントロールユニット',
      'DC入力16点（18P着脱式端子台）',
      'リレー出力16点',
    ]);
  });
});
