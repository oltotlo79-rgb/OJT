import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPushButtonInput } from '../src/renderer/session/push-button-input.js';
import { usePushButtonInput } from '../src/renderer/session/use-push-button-input.js';

afterEach(cleanup);

function fixture() {
  const pressed = new Set<string>();
  const press = vi.fn((id: string) => {
    pressed.add(id);
  });
  const release = vi.fn((id: string) => {
    pressed.delete(id);
  });
  return {
    pressed,
    press,
    release,
    input: createPushButtonInput(['PB1', 'PB2', 'PB3'], press, release, vi.fn()),
  };
}

describe('同時押下と保持', () => {
  it('PB1を保持したままPB2を押し、PB2だけ離せる', () => {
    const { input, pressed } = fixture();
    input.toggleHeld('PB1');
    input.startPointer('PB2', 1);
    expect([...pressed]).toEqual(['PB1', 'PB2']);
    input.endPointer(1);
    expect([...pressed]).toEqual(['PB1']);
    input.toggleHeld('PB1');
    expect(pressed.size).toBe(0);
  });
  it('別々の指で押したボタンを、指ごとに独立して離せる', () => {
    const { input, pressed } = fixture();
    input.startPointer('PB1', 11);
    input.startPointer('PB2', 22);
    input.endPointer(11);
    expect([...pressed]).toEqual(['PB2']);
    input.endPointer(77);
    expect([...pressed]).toEqual(['PB2']);
    input.endPointer(22);
    expect(pressed.size).toBe(0);
  });
  it('同じボタンをマウスと保持で重ねても、早く離れたり二重に押したりしない', () => {
    const { input, press, release, pressed } = fixture();
    input.startPointer('PB1', 1);
    input.toggleHeld('PB1');
    input.endPointer(1);
    expect(pressed.has('PB1')).toBe(true);
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    input.toggleHeld('PB1');
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('複数の保持と通常押下を一括解除し、後から来たpointerupを無視する', () => {
    const { input, pressed, release } = fixture();
    input.toggleHeld('PB1');
    input.toggleHeld('PB2');
    input.startPointer('PB3', 1);
    input.releaseAll();
    input.endPointer(1);
    expect(pressed.size).toBe(0);
    expect(input.held.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(3);
  });
});

describe('画面とOSの入力境界', () => {
  function hook() {
    const press = vi.fn(),
      release = vi.fn();
    const rendered = renderHook(
      ({ disabled, epoch }) =>
        usePushButtonInput({
          ids: ['PB1', 'PB2'],
          onPress: press,
          onRelease: release,
          disabled,
          epoch,
        }),
      { initialProps: { disabled: false, epoch: '1' } },
    );
    return { ...rendered, press, release };
  }
  it('キャンバスの外で離しても、同じポインターの押下だけを解除する', () => {
    const { result, release } = hook();
    act(() => {
      result.current.toggleHeld('PB1');
      result.current.startPointer('PB2', 8);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8 }));
    });
    expect(release.mock.calls).toEqual([['PB2']]);
    expect([...result.current.held]).toEqual(['PB1']);
  });
  it.each(['blur', 'Escape'])('%sで保持を解除する', (event) => {
    const { result, release } = hook();
    act(() => {
      result.current.toggleHeld('PB1');
      result.current.toggleHeld('PB2');
    });
    act(() => {
      window.dispatchEvent(
        event === 'blur' ? new Event('blur') : new KeyboardEvent('keydown', { key: event }),
      );
    });
    expect(result.current.active).toBe(false);
    expect(release.mock.calls).toEqual([['PB1'], ['PB2']]);
  });
  it('課題切替・判定中に保持を残さず、判定中の再押下を受け付けない', () => {
    const { result, rerender, press } = hook();
    act(() => result.current.toggleHeld('PB1'));
    rerender({ disabled: false, epoch: '2' });
    expect(result.current.active).toBe(false);
    act(() => result.current.toggleHeld('PB2'));
    rerender({ disabled: true, epoch: '2' });
    expect(result.current.active).toBe(false);
    act(() => {
      result.current.startPointer('PB1', 1);
    });
    expect(press).toHaveBeenCalledTimes(2);
  });
});
