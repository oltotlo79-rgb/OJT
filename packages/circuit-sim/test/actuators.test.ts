import { describe, expect, it } from 'vitest';
import {
  applyPowerAction,
  createPushButton,
  isContactClosed,
  isPowerOn,
  RESET_SEQUENCE,
  setButtonPressed,
} from '../src/index.js';
import type { PowerSwitches } from '../src/index.js';

const OFF: PowerSwitches = { breakerOn: false, switchOn: false };
const BOTH: PowerSwitches = { breakerOn: true, switchOn: true };

describe('actuators', () => {
  it('ON手順はブレーカ→スイッチ（§5.3.5）', () => {
    const first = applyPowerAction(OFF, 'breaker', true);
    expect(first.violation).toBe(false);
    const second = applyPowerAction(first.switches, 'switch', true);
    expect(second.violation).toBe(false);
    expect(isPowerOn(second.switches)).toBe(true);
  });

  it('OFF手順はスイッチ→ブレーカ（§5.3.5）', () => {
    const first = applyPowerAction(BOTH, 'switch', false);
    expect(first.violation).toBe(false);
    const second = applyPowerAction(first.switches, 'breaker', false);
    expect(second.violation).toBe(false);
    expect(isPowerOn(second.switches)).toBe(false);
  });

  it('逆手順は violation になるが操作自体は受理される（決定事項#12）', () => {
    const bad = applyPowerAction(OFF, 'switch', true);
    expect(bad.violation).toBe(true);
    expect(bad.switches.switchOn).toBe(true);
    // 既にブレーカON（かつスイッチON）の状態でブレーカONを再度押すのは同一状態への
    // no-op であり、手順違反ではない。
    expect(applyPowerAction(BOTH, 'breaker', true).violation).toBe(false);
    expect(applyPowerAction(BOTH, 'breaker', false).violation).toBe(true);
  });

  it('押ボタンは押下でa閉・b開（§5.3.3）', () => {
    const pb = createPushButton('PB1');
    const a = pb.elements[0];
    const b = pb.elements[1];
    if (a?.kind !== 'contact' || b?.kind !== 'contact') throw new Error('contacts');
    setButtonPressed(pb, true);
    expect(isContactClosed(a)).toBe(true);
    expect(isContactClosed(b)).toBe(false);
    setButtonPressed(pb, false);
    expect(isContactClosed(a)).toBe(false);
    expect(isContactClosed(b)).toBe(true);
  });

  it('保護復帰手順は4手（§5.1.1）', () => {
    expect(RESET_SEQUENCE.map((s) => `${s.device}:${String(s.on)}`)).toEqual([
      'switch:false',
      'breaker:false',
      'breaker:true',
      'switch:true',
    ]);
  });
});
