import {
  SP,
  SPECIAL_ALWAYS_OFF,
  SPECIAL_ALWAYS_ON,
  SPECIAL_FIRST_SCAN,
  type Cell,
} from '@ojt/ladder-core';
import type { DialectProfile } from './profile.js';

/** 旧版の「常時ON」をJWの実リレーで表す。表示・再編集・書き出しで同じ変換を使う。 */
export function nativeContact(
  cell: Extract<Cell, { kind: 'contact' }>,
  profile: DialectProfile,
): Extract<Cell, { kind: 'contact' }> {
  if (
    cell.device.kind !== 'special' ||
    cell.device.index !== SPECIAL_ALWAYS_ON ||
    !profile.specialInverted?.includes(SPECIAL_ALWAYS_ON)
  )
    return cell;
  if (cell.type === 'NO') return { kind: 'contact', type: 'NC', device: SP(SPECIAL_ALWAYS_OFF) };
  if (cell.type === 'NC' || cell.type === 'F')
    return { kind: 'contact', type: 'NO', device: SP(SPECIAL_ALWAYS_OFF) };
  // 常時ONの立上りはRUN開始時の1スキャン。常時OFFの立下りとは等価でない。
  return { kind: 'contact', type: 'NO', device: SP(SPECIAL_FIRST_SCAN) };
}
