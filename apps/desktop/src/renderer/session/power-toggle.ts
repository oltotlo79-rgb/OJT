import { useStore } from '../app/store.js';
import { JA, powerLog } from '../i18n/ja.js';
import type { PowerFixture } from './interaction.js';
import { bridge } from './worker-bridge.js';

/** 4モードの3D操作から、ツールバーと同じ電源コマンドを送る。 */
export function togglePowerFixture(fixture: PowerFixture): void {
  const store = useStore.getState();
  if (store.session === undefined || store.replay !== undefined) return;
  const breaker = fixture === 'breaker';
  const on = breaker ? !store.snapshot.breakerOn : !store.snapshot.switchOn;
  bridge.send(breaker ? { type: 'breaker', on } : { type: 'switch', on });
  store.addLog(powerLog(breaker ? JA.session.breaker : JA.session.switch, on));
}
