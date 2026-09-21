import type { DialectId } from '@ojt/plc-dialects';
import { JA } from '../i18n/ja.js';

export type NativeMenuId = keyof typeof JA.ladder.nativeMenus;
/** 公式画面: GX Works3 p51 / CX-Programmer p10 / PCwinカタログp2 / JW-300SP第2章。 */
export const NATIVE_MENU_ORDER: Readonly<Record<DialectId, readonly NativeMenuId[]>> = {
  mitsubishi: [
    'project',
    'edit',
    'find',
    'convert',
    'view',
    'online',
    'diagnostics',
    'tools',
    'window',
    'help',
  ],
  omron: ['file', 'edit', 'view', 'insert', 'plc', 'program', 'tools', 'window', 'help'],
  jtekt: [
    'file',
    'edit',
    'view',
    'find',
    'cpu',
    'monitor',
    'connection',
    'window',
    'menet',
    'options',
    'cad',
    'help',
  ],
  sharp: ['file', 'edit', 'view', 'online', 'block', 'tools', 'window', 'help'],
};

export function documentName(vendor: DialectId): string {
  return JA.ladder.nativeDocument[vendor];
}
