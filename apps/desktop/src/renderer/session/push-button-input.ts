/** マウス・タッチと「押し続ける」を別々に持ち、最後の操作が終わった時だけ離す。 */
export function createPushButtonInput(
  ids: readonly string[],
  press: (id: string) => void,
  release: (id: string) => void,
  changed: () => void,
) {
  const allowed = new Set(ids);
  const held = new Set<string>();
  const pointers = new Map<number, string>();
  const active = (id: string): boolean => held.has(id) || [...pointers.values()].includes(id);
  const endPointer = (pointerId: number): void => {
    const id = pointers.get(pointerId);
    if (id === undefined) return;
    pointers.delete(pointerId);
    if (!active(id)) release(id);
    changed();
  };
  return {
    held,
    pointers,
    startPointer(id: string, pointerId: number): void {
      if (!allowed.has(id) || pointers.get(pointerId) === id) return;
      endPointer(pointerId);
      const wasActive = active(id);
      pointers.set(pointerId, id);
      if (!wasActive) press(id);
      changed();
    },
    endPointer,
    toggleHeld(id: string): void {
      if (!allowed.has(id)) return;
      const wasActive = active(id);
      if (held.has(id)) held.delete(id);
      else held.add(id);
      if (!wasActive && active(id)) press(id);
      else if (wasActive && !active(id)) release(id);
      changed();
    },
    releaseAll(this: void): void {
      const pressed = new Set([...held, ...pointers.values()]);
      held.clear();
      pointers.clear();
      for (const id of pressed) release(id);
      if (pressed.size > 0) changed();
    },
  };
}
