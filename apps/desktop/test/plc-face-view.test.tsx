import { PLC_UNIT_FX5U, PLC_UNIT_JW300, PLC_UNIT_PC10G } from '@ojt/board-model';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CanvasTexture } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
// 型だけの読み込み（`vi.mock` の工場は巻き上げられるが、型は実行時に残らないので競合しない）
import type * as LabelsModule from '../src/renderer/three/labels.js';

/**
 * 机上のPLCの3Dを**描いて**確かめるテスト（4B レビュー B1・I3・I4・I5・M10）。
 *
 * `PlcUnit` / `PlcRack` は drei の `Html`（`Canvas` の中でしか使えない）を持つので、
 * `parts-swap.test.tsx` と同じく `Html` だけ素通しに差し替えて DOM へ描く。
 * R3F の要素（`mesh` / `group`）は React から見れば未知のホスト要素なので、そのまま生える。
 */

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

// 印字テクスチャの焼き付けは**本物を呼びつつ**引数を見る（どの色表で焼いたか。B1）
vi.mock('../src/renderer/three/labels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof LabelsModule>();
  return { ...actual, blockFaceTexture: vi.fn(actual.blockFaceTexture) };
});

const labels = await import('../src/renderer/three/labels.js');
const { PlcUnit, useLedState } = await import('../src/renderer/three/PlcUnit.js');
const { PlcRack } = await import('../src/renderer/three/PlcRack.js');
const { useStore } = await import('../src/renderer/app/store.js');

const bake = vi.mocked(labels.blockFaceTexture);

beforeEach(() => {
  bake.mockClear();
});

afterEach(() => {
  cleanup();
  useStore.setState({ plcMonitor: undefined, plcRunning: false });
  vi.restoreAllMocks();
});

/** happy-dom は 2D コンテキストを返さないので、テクスチャを焼くぶんだけ偽物を挿す。 */
function stubCanvas2d(): void {
  const ctx = {
    clearRect: () => undefined,
    fillText: () => undefined,
    fillStyle: '',
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
}

function renderUnit(): ReturnType<typeof render> {
  return render(
    <PlcUnit
      unit={PLC_UNIT_FX5U}
      terminals={PLC_UNIT_FX5U.terminals}
      hoveredTerminal={undefined}
      pendingTerminal={undefined}
      onHoverTerminal={() => undefined}
      onPickTerminal={() => undefined}
    />,
  );
}

function renderRack(unit = PLC_UNIT_PC10G): ReturnType<typeof render> {
  return render(
    <PlcRack
      unit={unit}
      terminals={unit.terminals}
      hoveredTerminal={undefined}
      pendingTerminal={undefined}
      onHoverTerminal={() => undefined}
      onPickTerminal={() => undefined}
    />,
  );
}

/** 名札の文字（`title` を持つのはモジュールの名札だけ）。 */
function labelTexts(container: HTMLElement, titled: boolean): (string | null)[] {
  const selector = titled ? 'span.block-label[title]' : 'span.block-label:not([title])';
  return [...container.querySelectorAll(selector)].map((el) => el.textContent);
}

describe('端子の印字は端子台の色に合わせて焼く（4B レビュー B1）', () => {
  it('bakes the rack print with the light table (the module terminal blocks are black)', () => {
    renderRack();
    expect(PLC_UNIT_PC10G.appearance.terminalBlockColor).toBe('#22262B');
    const call = bake.mock.calls.at(-1);
    expect(call?.[0]).toHaveLength(PLC_UNIT_PC10G.terminals.length);
    expect(call?.[2]).toBe(labels.SOCKET_ROLE_COLOR);
  });

  it('bakes the JW300 print with the light table too', () => {
    renderRack(PLC_UNIT_JW300);
    expect(labels.plateLuminance(PLC_UNIT_JW300.appearance.terminalBlockColor)).toBeLessThan(
      labels.PLATE_DARK_LUMINANCE,
    );
    expect(bake.mock.calls.at(-1)?.[2]).toBe(labels.SOCKET_ROLE_COLOR);
  });

  it('picks the table from the plate, not the model (FX5U / 明るい台座は濃い字のまま)', () => {
    renderUnit();
    /*
     * FX5U も端子台は黒（`#1F2226`）なので明るい字になる。カバーを開けて描くようになった今
     * （決定表#16 / I2）、印字の背板は明るいカバーではなく**端子台**である。
     * 明るい台座（盤の端子台 `#F1EFE9`）は今までどおり濃い字のまま＝既存の呼び出しは無変更。
     */
    expect(bake.mock.calls.at(-1)?.[2]).toBe(
      labels.roleColorsFor(PLC_UNIT_FX5U.appearance.terminalBlockColor),
    );
    expect(bake.mock.calls.at(-1)?.[2]).toBe(labels.SOCKET_ROLE_COLOR);
    expect(labels.roleColorsFor('#F1EFE9')).not.toBe(labels.SOCKET_ROLE_COLOR);
    expect(labels.roleColorsFor('#F1EFE9').com).toBe('#1B1E23');
  });
});

describe('焼いたテクスチャの解放（4B レビュー M10）', () => {
  it('disposes the PLC print texture on unmount', () => {
    stubCanvas2d();
    const dispose = vi.spyOn(CanvasTexture.prototype, 'dispose');
    const { unmount } = renderUnit();
    expect(dispose).not.toHaveBeenCalled();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the rack print texture on unmount', () => {
    stubCanvas2d();
    const dispose = vi.spyOn(CanvasTexture.prototype, 'dispose');
    const { unmount } = renderRack();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('ラックの名札と銘板（4B レビュー I3・I4）', () => {
  it('labels every module with its short model and hides the long name in the title', () => {
    const { container } = renderRack();
    expect(labelTexts(container, true)).toEqual(['POWER1', 'PC10G-1SP', 'IN-12', 'OUT-12']);
    const titles = [...container.querySelectorAll('span.block-label[title]')].map((el) =>
      el.getAttribute('title'),
    );
    expect(titles).toEqual([
      '電源モジュール',
      'CPUモジュール',
      'DC入力16点（THK-2750）',
      'リレー出力16点（THK-2752）',
    ]);
    // 長い名前は名札そのものには出さない（35mmピッチでは隣と重なって読めない）
    expect(labelTexts(container, true)).not.toContain('DC入力16点（THK-2750）');
  });

  it('draws the base nameplate (PC10G-1SP / JW-300) that the hand-drawn base used to drop', () => {
    const toyopuc = renderRack();
    // ベースの銘板＋CPUモジュールの銘板で2枚（モジュールの名札は `title` 付きなので別勘定）
    expect(
      labelTexts(toyopuc.container, false).filter((text) => text === 'PC10G-1SP'),
    ).toHaveLength(2);
    cleanup();
    const sharp = renderRack(PLC_UNIT_JW300);
    expect(labelTexts(sharp.container, false)).toContain('JW-300');
    expect(labelTexts(sharp.container, false)).toContain(PLC_UNIT_JW300.displayName);
  });
});

/** モニタのスナップショット（LEDが見る欄だけ本物にする）。 */
function monitor(inputs: boolean[], outputs: boolean[] = []): PlcMonitorSnapshot {
  return {
    scanCount: 1,
    tMs: 0,
    powered: {},
    inputs,
    outputs,
    internals: {},
    timers: {},
    counters: {},
  };
}

describe('LEDの購読（4B レビュー I5）', () => {
  it('re-renders only when a lamp actually changes', () => {
    const seen: (readonly boolean[] | undefined)[] = [];
    function Probe(): null {
      seen.push(useLedState().inputs);
      return null;
    }
    render(<Probe />);
    expect(seen).toHaveLength(1);
    act(() => {
      useStore.setState({ plcMonitor: monitor([false, true]) });
    });
    expect(seen).toHaveLength(2);
    // 同じ点灯状態のスナップショットが続いても再描画しない（配列は毎スキャン作り直される）
    act(() => {
      useStore.setState({ plcMonitor: monitor([false, true]) });
    });
    expect(seen).toHaveLength(2);
    act(() => {
      useStore.setState({ plcMonitor: monitor([true, true]) });
    });
    expect(seen).toHaveLength(3);
    expect(seen.at(-1)).toEqual([true, true]);
  });
});
