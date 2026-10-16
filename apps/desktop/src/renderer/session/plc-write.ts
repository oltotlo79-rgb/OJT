import type { DialectProfile } from '@ojt/plc-dialects';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { toolbarItems } from './plc-skin.js';

/**
 * PLC への書込みと RUN（v2.1.0 監査 P1）。
 *
 * 実機と同じく、PLC は**書き込まれたプログラム**で動く。以前は「変換」がそのまま書込みに
 * 当たり（意図的な差分 #2）、変換した瞬間に実行する回路が入れ替わっていた。説明書13・14章は
 * 実機どおり「変換しただけ・書込みしただけの段階を運転中と取り違えないように」と書いていて、
 * アプリの動きと食い違っていた。
 *
 * - 変換: 格子の誤りを調べて実行形式を作るだけ（PLC の動きは変えない）
 * - 書込み: 変換済みのラダーの写しを PLC のプログラムにし、Worker へ送る
 * - RUN: PLC のプログラムを動かす（プログラムが無ければ断る）
 */

/** このメーカーの「書込み」の操作の名前（道具列の文言。無ければ一般名）。 */
export function writeLabel(profile: DialectProfile): string {
  return (
    toolbarItems(profile).find((item) => item.action === 'download')?.label ??
    JA.ladder.writeGeneric
  );
}

/**
 * エディタの変換済みのラダーを PLC へ書き込む。書き込めたら true。
 *
 * 変換を通っていないラダーは書き込まない（呼び出し側が理由を出す）。運転中なら先に STOP する
 * （**RUN 中の書込みは断る前提**なので、STOP の確かめは呼び出し側が済ませてから呼ぶ）。
 * Worker は `load` で RUN とモニタを落とすので、モニタ中ならモニタだけ張り直す。RUN は STOP の
 * まま（実機も書込みのあとは STOP から RUN にし直す）。
 */
export function writeLadderToPlc(send: (action: PlcCommandAction) => void): boolean {
  const store = useStore.getState();
  const ladder = store.ladder;
  if (ladder === undefined || !store.converted) return false;
  if (store.plcRunning) {
    send({ kind: 'run', on: false });
    store.setPlcRunning(false);
  }
  send({ kind: 'load', program: ladder });
  if (store.ladderMode === 'monitor') send({ kind: 'monitor', on: true });
  store.setPlcProgram(ladder);
  return true;
}

/**
 * RUN にする。PLC にプログラムが無ければ断り、ERR の表示灯を点ける（実機の「プログラム無しで
 * RUN スイッチを入れた」状態）。運転を始められたら true。
 */
export function startPlc(send: (action: PlcCommandAction) => void): boolean {
  const store = useStore.getState();
  if (store.plcProgram === undefined) {
    store.setPlcNoProgramError(true);
    store.toast(JA.ladder.runNoProgram, 'error');
    return false;
  }
  send({ kind: 'run', on: true });
  store.setPlcRunning(true);
  return true;
}

/** STOP にする。プログラム無しの RUN の印（ERR）も消す。 */
export function stopPlc(send: (action: PlcCommandAction) => void): void {
  const store = useStore.getState();
  send({ kind: 'run', on: false });
  store.setPlcRunning(false);
  store.setPlcNoProgramError(false);
}
