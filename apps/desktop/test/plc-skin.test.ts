import { PLC_UNITS } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, SUPPORTED_PLC_MODELS } from '@ojt/content';
import { availableDialects, DIALECT_IDS, getDialect, type DialectId } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  autoConvert,
  plcForVendor,
  plcUnitForVendor,
  PLC_STEP_KEYS,
  skinGridCols,
  skinMonitorColor,
  skinStepKeys,
  toolbarItems,
  TOOLBAR_ACTIONS_BY_DIALECT,
} from '../src/renderer/session/plc-skin.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

describe('ツールバーの項目 → 操作（§10.6 / 決定表#2）', () => {
  it('has exactly one action per toolbar label in every dialect', () => {
    for (const profile of availableDialects()) {
      expect(TOOLBAR_ACTIONS_BY_DIALECT[profile.id], profile.id).toHaveLength(
        profile.panels.toolbar.length,
      );
      const items = toolbarItems(profile);
      expect(items.map((item) => item.label)).toEqual([...profile.panels.toolbar]);
      expect(items.map((item) => item.index)).toEqual(items.map((_unused, i) => i));
    }
  });

  it('shows a 変換 button only where the skin asks for one (受入基準①)', () => {
    const has = (id: DialectId): boolean =>
      toolbarItems(getDialect(id)).some((item) => item.action === 'convert');
    expect(has('mitsubishi')).toBe(true);
    expect(has('sharp')).toBe(true);
    expect(has('omron')).toBe(false);
    expect(has('jtekt')).toBe(false);
  });

  it('keeps every dialect able to write, run and monitor', () => {
    for (const profile of availableDialects()) {
      const actions = new Set(toolbarItems(profile).map((item) => item.action));
      /*
       * PCwin風の `panels.toolbar`（4A `jtekt.ts` L257 の9項目）には転送の項目が無く、
       * `JP1` / `DGR` / `MOB` / `RDY` は本アプリでは動かない（決定表#4）。そのスキンで
       * プログラムをPLCへ載せるのは自動変換（決定表#3）の役目である。
       */
      expect(actions.has('download') || autoConvert(profile), profile.id).toBe(true);
      expect(actions.has('monitor-start'), profile.id).toBe(true);
      expect(actions.has('monitor-stop'), profile.id).toBe(true);
      expect(
        actions.has('plc-run') || actions.has('online'),
        `${profile.id} には運転にできる項目が要る`,
      ).toBe(true);
    }
  });

  it('marks the PCwin-only buttons as inert (決定表#4)', () => {
    const jtekt = toolbarItems(getDialect('jtekt'));
    expect(jtekt.filter((item) => item.action === 'vendor-only').map((item) => item.label)).toEqual(
      ['JP1', 'DGR', 'MOB', 'RDY'],
    );
    expect(jtekt.find((item) => item.label === 'RUN')?.action).toBe('plc-run');
    expect(jtekt.find((item) => item.label === 'STP')?.action).toBe('plc-stop');
    expect(jtekt.find((item) => item.label === 'RES')?.action).toBe('plc-reset');
  });
});

describe('変換の要否（§10.6 / 決定表#3）', () => {
  it('auto-converts exactly where there is no 変換 button', () => {
    for (const profile of availableDialects()) {
      expect(autoConvert(profile), profile.id).toBe(!profile.convertStep);
    }
  });

  it('drops the 変換 step from the guide when the skin has none', () => {
    expect(skinStepKeys(getDialect('mitsubishi'))).toEqual([...PLC_STEP_KEYS]);
    expect(skinStepKeys(getDialect('omron'))).toEqual(['wire', 'ladder', 'run', 'judge']);
    expect(skinStepKeys(getDialect('jtekt'))).toEqual(['wire', 'ladder', 'run', 'judge']);
    expect(skinStepKeys(getDialect('sharp'))).toEqual([...PLC_STEP_KEYS]);
  });
});

describe('表示列数と通電色（§10.6 / 決定表#8）', () => {
  it('falls back to the dialect default when the setting says "follow the vendor"', () => {
    for (const profile of availableDialects()) {
      expect(skinGridCols(profile, 0), profile.id).toBe(profile.gridCols);
      expect(skinMonitorColor(profile, ''), profile.id).toBe(profile.monitorColors.powered);
    }
    expect(skinMonitorColor(getDialect('omron'), '')).toBe('#2FA02C');
    expect(skinMonitorColor(getDialect('jtekt'), '')).toBe('#E08A1E');
    expect(skinMonitorColor(getDialect('sharp'), '')).toBe('#00A0C8');
  });

  it('lets the setting win and clamps it to 8..15', () => {
    const profile = getDialect('omron');
    expect(skinGridCols(profile, 9)).toBe(9);
    expect(skinGridCols(profile, 99)).toBe(15);
    expect(skinGridCols(profile, 3)).toBe(8);
    expect(skinMonitorColor(profile, '#FF00AA')).toBe('#FF00AA');
  });
});

describe('メーカー → 機種（§7.6 / 決定表#9）', () => {
  it('finds one unit per vendor', () => {
    for (const id of DIALECT_IDS) {
      const unit = plcUnitForVendor(id);
      expect(unit?.vendor, id).toBe(id);
      expect(SUPPORTED_PLC_MODELS as readonly string[]).toContain(unit?.model);
    }
    expect(Object.keys(PLC_UNITS)).toHaveLength(4);
  });

  it('swaps the problem model to the chosen vendor (受入基準①③⑤)', () => {
    for (const id of DIALECT_IDS) {
      const swapped = plcForVendor(problem, id);
      expect(swapped?.plc.vendor, id).toBe(id);
      expect(swapped?.plc.model, id).toBe(plcUnitForVendor(id)?.model);
      // 課題の中身（割付・操作列・判定設定）は触らない
      expect(swapped?.io).toEqual(problem.io);
      expect(swapped?.id).toBe(problem.id);
    }
  });

  it('returns the same object when the vendor already matches', () => {
    expect(plcForVendor(problem, 'mitsubishi')).toBe(problem);
  });

  it('refuses a model that cannot host the assignment (決定表#10)', () => {
    // CP1E の出力は12点しかない（4A 前提#23）
    const wide = {
      ...problem,
      io: {
        ...problem.io,
        mode: 'fixed' as const,
        inputs: [{ x: 0, pb: 'PB1' as const }],
        outputs: [{ y: 12, cr: 'CR1' as const, pl: 'PL1' as const }],
      },
    };
    expect(plcForVendor(wide, 'omron')).toBeUndefined();
    expect(plcForVendor(wide, 'mitsubishi')).toBe(wide);
  });
});
