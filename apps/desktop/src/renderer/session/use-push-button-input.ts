import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { createPushButtonInput } from './push-button-input.js';

/** 押下の持ち主をポインターIDで追跡する。別のボタンを離しても保持中のボタンへ干渉しない。 */
export function usePushButtonInput({
  ids,
  onPress,
  onRelease,
  disabled,
  epoch,
}: {
  ids: readonly string[];
  onPress: (id: string) => void;
  onRelease: (id: string) => void;
  disabled: boolean;
  epoch: unknown;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const idKey = ids.join(',');
  const input = useMemo(
    () => createPushButtonInput(idKey.split(','), onPress, onRelease, redraw),
    [idKey, onPress, onRelease],
  );
  useEffect(() => {
    const finish = (event: PointerEvent): void => input.endPointer(event.pointerId);
    const clear = (): void => input.releaseAll();
    const hidden = (): void => {
      if (document.hidden) clear();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', clear);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', clear);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', hidden);
      clear();
    };
  }, [input]);
  useEffect(() => {
    input.releaseAll();
  }, [input, epoch, disabled]);
  const startPointer = useCallback(
    (id: string, pointerId: number): boolean => {
      if (disabled) return false;
      input.startPointer(id, pointerId);
      return true;
    },
    [input, disabled],
  );
  const toggleHeld = useCallback(
    (id: string): void => {
      if (!disabled) input.toggleHeld(id);
    },
    [input, disabled],
  );
  const endPointer = useCallback(
    (_id: string, pointerId: number): void => input.endPointer(pointerId),
    [input],
  );
  return {
    startPointer,
    endPointer,
    toggleHeld,
    releaseAll: input.releaseAll,
    held: input.held,
    pointerActive: input.pointers.size > 0,
    active: input.pointers.size > 0 || input.held.size > 0,
  };
}
