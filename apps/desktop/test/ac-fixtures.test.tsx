import { JIPM_BOARD, type Footprint } from '@ojt/board-model';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Breaker,
  BREAKER_HANDLE_TILT_RAD,
  breakerHandlePoseAt,
  breakerHandleTilt,
  LEVER_TWEEN_MS,
  PowerLever,
  PowerSwitch,
  stepRotation,
  SWITCH_ROCKER_TILT_RAD,
  switchRockerTilt,
} from '../src/renderer/three/AcFixtures.js';
import { findFixtureFootprint } from '../src/renderer/three/Fixtures.js';
import { intentOf, type InteractionState } from '../src/renderer/session/interaction.js';

/**
 * 3Dのブレーカ・電源スイッチを**押して**電源を入切する（Phase 7 Task 27 / 利用者要望9
 * 「3D図をクリックして電源をON/OFFしたり」）。設計 §7.3.2。
 *
 * 3Dの絵そのものは単体テストから見られないので、①操作部だけがクリックを受けること
 * ②押すと次の状態が飛ぶこと ③レバーの補間の速さ、の3つを要素木と純粋な値で縛る。
 */

const HEIGHT_MM = 22;

function footprintOf(kind: Footprint['kind']): Footprint {
  const footprint = findFixtureFootprint(JIPM_BOARD.footprints, kind);
  if (footprint === undefined) throw new Error(`no footprint: ${kind}`);
  return footprint;
}

function terminalsOf(partId: string): typeof JIPM_BOARD.terminals {
  return JIPM_BOARD.terminals.filter((terminal) => terminal.id.startsWith(`${partId}.`));
}

const CB = footprintOf('breaker');
const SW = footprintOf('switch');

/**
 * 要素木を辿る。`PowerLever` は `useFrame` を持ち `Canvas` の外では展開できないので、
 * 要素のまま積んで props だけを見る（`three-fidelity.test.tsx` と同じ流儀）。
 */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === 'function' && element.type !== PowerLever) {
    const renderFn = element.type as (props: unknown) => ReactNode;
    return collect(renderFn(element.props), out);
  }
  out.push(element);
  collect(element.props.children, out);
  return out;
}

/** 名前で1つ取り出す（操作部は必ず名前を持つ）。 */
function byName(node: ReactNode, name: string): Record<string, unknown> {
  const found = collect(node).find(
    (element) => (element.props as Record<string, unknown>)['name'] === name,
  );
  if (found === undefined) throw new Error(`要素が見つかりません: ${name}`);
  return found.props as Record<string, unknown>;
}

/** クリックのイベント（伝播を止めたかも見る）。 */
function clickEvent(): { stopPropagation: () => void } {
  return { stopPropagation: vi.fn() };
}

describe('ブレーカの操作部（設計 §7.3.2）', () => {
  it('ハンドル窓を押すと「次の状態」が飛ぶ（切→入・入→切）', () => {
    for (const on of [false, true]) {
      const onToggle = vi.fn<(next: boolean) => void>();
      const well = byName(
        <Breaker
          footprint={CB}
          terminals={terminalsOf('CB')}
          color="#DCDCD6"
          heightMm={HEIGHT_MM}
          on={on}
          onToggle={onToggle}
        />,
        'breaker-well',
      );
      const event = clickEvent();
      (well['onClick'] as (e: unknown) => void)(event);
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(!on);
      // 下の盤面まで抜けさせない（押したつもりが配線の取り消しになる、を作らない）
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    }
  });

  it('可動部（ハンドル）も同じ入切を持ち、倒れきる角度と補間の全幅を受け取る', () => {
    const onToggle = vi.fn<(next: boolean) => void>();
    const lever = byName(
      <Breaker
        footprint={CB}
        terminals={terminalsOf('CB')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on={false}
        onToggle={onToggle}
      />,
      'breaker-handle',
    );
    expect(lever['target']).toBeCloseTo(breakerHandleTilt(false), 10);
    expect(lever['travelRad']).toBeCloseTo(BREAKER_HANDLE_TILT_RAD * 2, 10);
    expect(lever['nextOn']).toBe(true);
    expect((lever['handlers'] as { onToggle?: unknown }).onToggle).toBe(onToggle);
  });

  it('`onToggle` を渡さなければ従来どおり飾りに戻る（レイキャストを受けない）', () => {
    const well = byName(
      <Breaker
        footprint={CB}
        terminals={terminalsOf('CB')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on={false}
      />,
      'breaker-well',
    );
    expect(well['onClick']).toBeUndefined();
    const intersects: unknown[] = [];
    (well['raycast'] as (a: unknown, b: unknown[]) => void)({}, intersects);
    expect(intersects).toEqual([]);
  });

  it('ハンドルは ON と OFF で倒れる向きが逆になる（位置も角度も変わる）', () => {
    const on = breakerHandlePoseAt(CB, breakerHandleTilt(true), HEIGHT_MM);
    const off = breakerHandlePoseAt(CB, breakerHandleTilt(false), HEIGHT_MM);
    expect(Math.sign(on.rotationX)).toBe(-Math.sign(off.rotationX));
    expect(on.position[1]).not.toBeCloseTo(off.position[1], 3);
  });
});

describe('電源スイッチの操作部（設計 §7.3.2）', () => {
  it('ロッカー窓を押すと「次の状態」が飛ぶ', () => {
    const onToggle = vi.fn<(next: boolean) => void>();
    const well = byName(
      <PowerSwitch
        footprint={SW}
        terminals={terminalsOf('SW')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on={false}
        onToggle={onToggle}
      />,
      'switch-well',
    );
    (well['onClick'] as (e: unknown) => void)(clickEvent());
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('ロッカーは倒れきる角度と補間の全幅を受け取る', () => {
    const lever = byName(
      <PowerSwitch
        footprint={SW}
        terminals={terminalsOf('SW')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on
        onToggle={() => undefined}
      />,
      'switch-rocker',
    );
    expect(lever['target']).toBeCloseTo(switchRockerTilt(true), 10);
    expect(lever['travelRad']).toBeCloseTo(SWITCH_ROCKER_TILT_RAD * 2, 10);
  });

  it('ホバーの通知も操作部だけが持つ', () => {
    const onHover = vi.fn<(entered: boolean) => void>();
    const well = byName(
      <PowerSwitch
        footprint={SW}
        terminals={terminalsOf('SW')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on={false}
        onToggle={() => undefined}
        onHover={onHover}
      />,
      'switch-well',
    );
    (well['onPointerOver'] as (e: unknown) => void)(clickEvent());
    expect(onHover).toHaveBeenCalledWith(true);
    (well['onPointerOut'] as () => void)();
    expect(onHover).toHaveBeenLastCalledWith(false);
  });
});

describe('レバーの補間（設計 §7.3.2「レバーが倒れる（150ms）」）', () => {
  const travel = BREAKER_HANDLE_TILT_RAD * 2;
  const from = breakerHandleTilt(false);
  const to = breakerHandleTilt(true);

  it('150ms かけて倒れきる（1フレームでは着かない）', () => {
    expect(stepRotation(from, to, 16, travel)).not.toBeCloseTo(to, 6);
    expect(stepRotation(from, to, LEVER_TWEEN_MS, travel)).toBeCloseTo(to, 10);
    // 行き過ぎない（半分の時間なら半分だけ進む）
    expect(stepRotation(from, to, LEVER_TWEEN_MS / 2, travel)).toBeCloseTo((from + to) / 2, 10);
  });

  it('目標に着いたらそれ以上動かない', () => {
    expect(stepRotation(to, to, 999, travel)).toBe(to);
    expect(stepRotation(from, to, LEVER_TWEEN_MS * 10, travel)).toBe(to);
  });
});

describe('電源操作の手順違反は止めない（§5.6 #5 / 設計 §7.3.2）', () => {
  const state: InteractionState = {
    mode: 'wire',
    pendingTerminal: undefined,
    selectedWire: undefined,
    wireColor: '青',
  };

  it('ブレーカが切でも電源スイッチは押せる（エンジンが危険操作として数える）', () => {
    // 押させないのではなく、押させたうえで `power-sequence-violation` に載せる
    expect(intentOf(state, { kind: 'fixture', fixture: 'switch' })).toEqual({
      type: 'togglePower',
      fixture: 'switch',
    });
  });
});
