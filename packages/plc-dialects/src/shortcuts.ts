import type { ShortcutTable } from './profile.js';

/**
 * GX Works3風のキー割当表。設計仕様 §10.6 / §17 #19。
 *
 * PCwin風（JTEKT）と JW-300SP風（シャープ）は一次資料が未確認のため**この表を流用する**のが
 * §17.1 の前提方針である。実機の割当が判明したら、その方言のプロファイルでこの表を使うのを
 * やめて自前の表を置けばよい（修正箇所はスキン定義1箇所）。
 *
 * `confirmed: true` は PLC調査資料 §1-D で確認済みの割当（◎）、`false` は §17.1 の前提方針で
 * 採用した三菱系ツールの慣例（△）である。UIは △ に注記を出せる（§12.1）。
 */
export const GX_STYLE_SHORTCUTS: ShortcutTable = [
  { action: 'contact-no', keys: 'F5', label: 'a接点', confirmed: true },
  { action: 'contact-nc', keys: 'F6', label: 'b接点', confirmed: false },
  { action: 'or-contact-no', keys: 'Shift+F5', label: 'OR a接点', confirmed: false },
  { action: 'or-contact-nc', keys: 'Shift+F6', label: 'OR b接点', confirmed: false },
  { action: 'coil', keys: 'F7', label: 'コイル', confirmed: true },
  {
    action: 'application',
    keys: 'F8',
    label: '応用命令',
    confirmed: true,
    enabled: false,
    note: '本アプリのラダーIRには応用命令に対応するセル種別がありません（§10.3）',
  },
  { action: 'hline', keys: 'F9', label: '横線', confirmed: false },
  { action: 'vline', keys: 'Shift+F9', label: '縦線', confirmed: false },
  {
    action: 'rule-line',
    keys: 'Ctrl+←↑↓→',
    label: '罫線（縦線・横線の作図）',
    confirmed: true,
    note: '`setVerticalLink()` / `setCell()`（`ladder-core` の編集API）に対応する',
  },
  { action: 'convert', keys: 'F4', label: '変換', confirmed: false },
  { action: 'toggle-no-nc', keys: '/', label: 'a接点・b接点の切換', confirmed: true },
  { action: 'toggle-pulse', keys: 'Alt+/', label: '微分・SET/RST の切換', confirmed: true },
  { action: 'write-mode', keys: 'F2', label: '書込みモード', confirmed: true },
  { action: 'read-mode', keys: 'Shift+F2', label: '読出しモード', confirmed: true },
  { action: 'monitor', keys: 'F3', label: 'モニタ', confirmed: true },
  { action: 'monitor-write', keys: 'Shift+F3', label: 'モニタ（書込み）', confirmed: true },
  { action: 'insert-toggle', keys: 'Ins', label: '挿入・上書きの切換', confirmed: true },
  { action: 'next-symbol', keys: 'Tab', label: '次の回路記号', confirmed: true },
  { action: 'help', keys: 'F1', label: 'ヘルプ', confirmed: true },
];

/**
 * 「変換」の行を落とした表を返す。§10.6
 * `convertStep: false` のスキン（CX-Programmer風・PCwin風）は変換操作を持たないので、
 * 押しても何も起きないキーを一覧に出さない（決定表#5）。
 */
export function withoutConvert(table: ShortcutTable): ShortcutTable {
  return table.filter((entry) => entry.action !== 'convert');
}
