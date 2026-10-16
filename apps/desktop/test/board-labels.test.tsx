import {
  JIPM_BOARD,
  OUTLET_ORIGIN_MM,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, OjtApi } from '../src/shared/ipc.js';
import { useStore } from '../src/renderer/app/store.js';
import { applyUiPreferences, boardLabelsVisible } from '../src/renderer/app/ui-preferences.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { Toolbar } from '../src/renderer/panels/Toolbar.js';
import {
  nameplateBackgroundColor,
  nameplateRectMm,
  plcVisualRectMm,
} from '../src/renderer/three/appearance.js';
import { labelAnchorTransform, labelRoomAttr } from '../src/renderer/three/BoardLabel.js';
import { findFixtureFootprint, fixtureLabelPlacement } from '../src/renderer/three/Fixtures.js';
import {
  fitsLabelRoom,
  labelWorldSizeMm,
  parseLabelRoom,
  pickVisibleLabels,
} from '../src/renderer/three/label-declutter.js';
import { OUTLET_PLATE_H_MM } from '../src/renderer/three/outlet-geometry.js';
import { modelLabelPlacement } from '../src/renderer/three/PlcUnit.js';
import { rackBaseNameplateRect, rackModuleBoxes } from '../src/renderer/three/PlcRack.js';

/**
 * 3Dの名札が機器を覆わないこと（v2.1.0 監査 U3）。
 *
 * - 名札は機器の**外側の縁**に端を合わせる（`BoardLabel.tsx` の `anchor`）。
 * - 名札は盤の上で「CSS の大きさ × distanceFactor ÷ ペインの高さ」mm を占める
 *   （`labelWorldSizeMm()`）。置き場（`room`）より大きく映るペインでは出さない。
 * - 銘板（型式）は HTML の名札ではなく面に刷る（`plc-face-view.test.tsx`）。
 * - 「表示・作業ファイル」の「3Dの名札を表示」で名札を消せる（状態の表示は残す）。
 */

const UNITS: readonly PlcUnitDefinition[] = [
  PLC_UNIT_FX5U,
  PLC_UNIT_CP1E,
  PLC_UNIT_PC10G,
  PLC_UNIT_JW300,
];

describe('名札の大きさと置き場（label-declutter）', () => {
  it('reads data-label-room as "width height" in mm', () => {
    expect(parseLabelRoom('64 20')).toEqual({ w: 64, h: 20 });
    expect(parseLabelRoom(' 80.5  100 ')).toEqual({ w: 80.5, h: 100 });
    expect(parseLabelRoom(undefined)).toBeUndefined();
    expect(parseLabelRoom('wide')).toBeUndefined();
    expect(parseLabelRoom('64')).toBeUndefined();
    expect(labelRoomAttr({ w: 64, h: 20 })).toBe('64 20');
  });

  it('turns the CSS size into board millimetres by distanceFactor ÷ pane height', () => {
    // 高さ 20px・distanceFactor 320 の名札は、800px のペインで 8mm、320px のペインで 20mm
    expect(labelWorldSizeMm(100, 20, 320, 800)).toEqual({ w: 40, h: 8 });
    expect(labelWorldSizeMm(100, 20, 320, 320)).toEqual({ w: 100, h: 20 });
    // ペインの高さが分からないときは「収まらない」側に倒す
    expect(fitsLabelRoom(labelWorldSizeMm(10, 10, 320, 0), { w: 1000, h: 1000 })).toBe(false);
  });

  it('hides a label that does not fit its room, even when nothing else overlaps it', () => {
    const rect = { l: 0, t: 0, r: 80, b: 20 };
    expect(fitsLabelRoom({ w: 40, h: 8 }, { w: 64, h: 20 })).toBe(true);
    expect(fitsLabelRoom({ w: 40, h: 21 }, { w: 64, h: 20 })).toBe(false);
    expect(fitsLabelRoom({ w: 400, h: 400 }, undefined)).toBe(true);
    expect(pickVisibleLabels([{ rank: 1, rect, fits: false }])).toEqual([false]);
    expect(pickVisibleLabels([{ rank: 1, rect, fits: true }])).toEqual([true]);
    expect(pickVisibleLabels([{ rank: 1, rect }])).toEqual([true]);
  });

  it('lets a lower-ranked label take the place of a hidden one', () => {
    const rect = { l: 0, t: 0, r: 80, b: 20 };
    expect(
      pickVisibleLabels([
        { rank: 1, rect, fits: false },
        { rank: 5, rect },
      ]),
    ).toEqual([false, true]);
  });
});

describe('名札の基準点の合わせ方（BoardLabel）', () => {
  it('moves the label away from the anchor in the named direction', () => {
    expect(labelAnchorTransform('top')).toBe('translate3d(-50%,0,0)');
    expect(labelAnchorTransform('bottom')).toBe('translate3d(-50%,-100%,0)');
    expect(labelAnchorTransform('top-left')).toBe('none');
    expect(labelAnchorTransform('top-right')).toBe('translate3d(-100%,0,0)');
    expect(labelAnchorTransform('bottom-right')).toBe('translate3d(-100%,-100%,0)');
  });
});

describe('機種名の名札は本体（開いた端子カバーを含む）の下に置く', () => {
  it('counts the flat-open bottom cover of FX5U and CP1E as part of the unit', () => {
    // FX5U の出力側カバー（高さ26mm・下ヒンジ）は本体の下へ平らに開く
    expect(plcVisualRectMm(PLC_UNIT_FX5U.pos, PLC_UNIT_FX5U.appearance).y1).toBeCloseTo(
      PLC_UNIT_FX5U.pos.y + 90 + 26,
    );
    // 入力側カバー（上ヒンジ）は本体の上へ開く
    expect(plcVisualRectMm(PLC_UNIT_FX5U.pos, PLC_UNIT_FX5U.appearance).y0).toBeCloseTo(
      PLC_UNIT_FX5U.pos.y - 26,
    );
    expect(plcVisualRectMm(PLC_UNIT_CP1E.pos, PLC_UNIT_CP1E.appearance).y1).toBeCloseTo(
      PLC_UNIT_CP1E.pos.y + 90 + 24,
    );
    // ラックのベースはカバーを持たない（モジュールのカバーは取り外して描く）
    expect(plcVisualRectMm(PLC_UNIT_PC10G.pos, PLC_UNIT_PC10G.appearance).y1).toBe(
      PLC_UNIT_PC10G.pos.y + PLC_UNIT_PC10G.sizeMm.height,
    );
  });

  for (const unit of UNITS) {
    it(`${unit.model}: puts the label below the unit and above the outlet, clear of the board`, () => {
      const visual = plcVisualRectMm(unit.pos, unit.appearance);
      const placement = modelLabelPlacement(visual);
      expect(placement.y).toBeGreaterThan(visual.y1);
      expect(placement.x).toBeCloseTo((visual.x0 + visual.x1) / 2);
      // 置き場は「壁コンセントの板の上端まで」
      const outletTop = OUTLET_ORIGIN_MM.y - OUTLET_PLATE_H_MM / 2;
      expect(placement.room.h).toBeGreaterThan(0);
      expect(placement.y + placement.room.h).toBeLessThan(outletTop);
      // 幅は盤の右端（330mm）にかからない
      expect(placement.x - placement.room.w / 2).toBeGreaterThan(JIPM_BOARD.sizeMm.width);
    });
  }
});

describe('固定機器の名札（ブレーカ・電源スイッチ・DC24V電源）', () => {
  const breaker = findFixtureFootprint(JIPM_BOARD.footprints, 'breaker');
  const swFootprint = findFixtureFootprint(JIPM_BOARD.footprints, 'switch');
  const supply = findFixtureFootprint(JIPM_BOARD.footprints, 'supply');

  it('puts every label outside its own device', () => {
    if (breaker === undefined || swFootprint === undefined || supply === undefined) {
      throw new Error('footprint');
    }
    // DC24V 電源は下の縁から下へ
    const ps = fixtureLabelPlacement('supply', supply, JIPM_BOARD.footprints);
    expect(ps.anchor).toBe('top');
    expect(ps.y).toBeGreaterThan(supply.y + supply.h);
    // ブレーカと電源スイッチはブレーカの左の縁から左へ（盤の上段の空いた帯）
    for (const [kind, footprint] of [
      ['breaker', breaker],
      ['switch', swFootprint],
    ] as const) {
      const placement = fixtureLabelPlacement(kind, footprint, JIPM_BOARD.footprints);
      expect(placement.anchor.endsWith('right'), kind).toBe(true);
      expect(placement.x, kind).toBeLessThan(breaker.x);
      expect(placement.x - placement.room.w, kind).toBeGreaterThan(supply.x + supply.w);
    }
  });

  it('stacks the breaker and switch labels in two rows that never meet', () => {
    if (breaker === undefined || swFootprint === undefined) throw new Error('footprint');
    const cb = fixtureLabelPlacement('breaker', breaker, JIPM_BOARD.footprints);
    const sw = fixtureLabelPlacement('switch', swFootprint, JIPM_BOARD.footprints);
    expect(cb.anchor).toBe('top-right');
    expect(sw.anchor).toBe('bottom-right');
    // 右端をそろえる
    expect(sw.x).toBe(cb.x);
    // 上の段（ブレーカ）は下へ、下の段（電源スイッチ）は上へ伸び、置き場は重ならない
    expect(cb.y + cb.room.h).toBeLessThan(sw.y - sw.room.h);
    // 2段とも上段の帯（ブレーカの高さの中）に収まる
    expect(cb.y).toBeGreaterThanOrEqual(breaker.y);
    expect(sw.y).toBeLessThanOrEqual(breaker.y + breaker.h);
    // 上から見たときに重ならないよう、高さも分ける（ブレーカは機器の天面、電源スイッチは盤面の近く）
    expect(cb.z - sw.z).toBeGreaterThanOrEqual(15);
  });

  it('keeps the DC24V label within the band above the sockets', () => {
    if (supply === undefined) throw new Error('footprint');
    const socketTop = Math.min(
      ...JIPM_BOARD.footprints.filter((f) => f.kind === 'socket').map((f) => f.y),
    );
    const placement = fixtureLabelPlacement('supply', supply, JIPM_BOARD.footprints);
    expect(placement.y + placement.room.h).toBeLessThan(socketTop);
  });
});

describe('銘板（面に刷る型式）', () => {
  it('prints FX5U on the black front panel and CP1E on its light body', () => {
    expect(nameplateBackgroundColor(PLC_UNIT_FX5U.appearance)).toBe(
      PLC_UNIT_FX5U.appearance.features.find((f) => f.kind === 'panel')?.color,
    );
    expect(nameplateBackgroundColor(PLC_UNIT_CP1E.appearance)).toBe(
      PLC_UNIT_CP1E.appearance.bodyColor,
    );
  });

  for (const unit of [PLC_UNIT_PC10G, PLC_UNIT_JW300]) {
    it(`${unit.model}: keeps the base nameplate on the base, below every module`, () => {
      const base = rackBaseNameplateRect(unit);
      expect(base.y1).toBeLessThanOrEqual(unit.pos.y + unit.sizeMm.height);
      expect(base.x0).toBeGreaterThanOrEqual(unit.pos.x);
      expect(base.x1).toBeLessThanOrEqual(unit.pos.x + unit.sizeMm.width);
      for (const box of rackModuleBoxes(unit)) {
        expect(base.y0, box.model).toBeGreaterThanOrEqual(
          box.origin.y + box.appearance.faceMm.height,
        );
        const plate = nameplateRectMm(box.origin, box.appearance.nameplateRect);
        expect(plate.y1, box.model).toBeLessThanOrEqual(
          box.origin.y + box.appearance.faceMm.height,
        );
      }
    });
  }
});

describe('「3Dの名札を表示」の切替（表示・作業ファイル）', () => {
  let setSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setSettings = vi.fn((patch: Partial<AppSettings>) => Promise.resolve(patch as AppSettings));
    window.ojt = { setSettings } as unknown as OjtApi;
    applyUiPreferences({ uiScale: 1, contrast: 'normal', showBoardLabels: true });
  });

  afterEach(() => {
    cleanup();
    delete (window as { ojt?: OjtApi }).ojt;
    delete document.documentElement.dataset['boardLabels'];
    useStore.setState({ toasts: [] });
  });

  function renderToolbar(): void {
    render(
      <Toolbar
        mode="wire"
        wireColor="青"
        allowedColors={['青']}
        camera="front"
        canUndo={false}
        canRedo={false}
        judging={false}
        onMode={vi.fn()}
        onWireColor={vi.fn()}
        onCamera={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onJudge={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        schematicVisible={false}
        onToggleSchematic={undefined}
      />,
    );
  }

  it('applies the saved setting to the page at start-up', () => {
    applyUiPreferences({ uiScale: 1, contrast: 'normal', showBoardLabels: false });
    expect(document.documentElement.dataset['boardLabels']).toBe('off');
    expect(boardLabelsVisible()).toBe(false);
    applyUiPreferences({ uiScale: 1, contrast: 'normal', showBoardLabels: true });
    expect(boardLabelsVisible()).toBe(true);
  });

  it('turns the labels off and on from the overflow menu and saves the choice', () => {
    renderToolbar();
    fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
    const toggle = screen.getByTestId('toggle-board-labels');
    expect(toggle.textContent).toBe(JA.toolbarOverflow.boardLabels);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(document.documentElement.dataset['boardLabels']).toBe('off');
    expect(setSettings).toHaveBeenLastCalledWith({ showBoardLabels: false });
    fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
    const again = screen.getByTestId('toggle-board-labels');
    expect(again.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(again);
    expect(document.documentElement.dataset['boardLabels']).toBe('on');
    expect(setSettings).toHaveBeenLastCalledWith({ showBoardLabels: true });
  });

  it('keeps the switch on screen and tells the user when saving fails', async () => {
    setSettings.mockRejectedValueOnce(new Error('disk full'));
    renderToolbar();
    fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
    fireEvent.click(screen.getByTestId('toggle-board-labels'));
    expect(document.documentElement.dataset['boardLabels']).toBe('off');
    await vi.waitFor(() => {
      expect(useStore.getState().toasts.map((toast) => toast.text)).toContain(
        JA.toolbarOverflow.boardLabelsSaveFailed,
      );
    });
  });

  it('hides names but keeps state displays (hover tips, power labels, running) in the CSS', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/app/global.css'), 'utf8');
    const from = css.indexOf(":root[data-board-labels='off'] .socket-label");
    const rule = css.slice(from, css.indexOf('display: none;', from));
    expect(rule).toContain('.block-label:not(.fixture-label)');
    expect(rule).toContain('.part-label:not(.part-status)');
    expect(rule).not.toContain('terminal-tooltip');
    expect(rule).not.toContain('probe-label');
    expect(rule).not.toContain('fixture-state');
  });
});
