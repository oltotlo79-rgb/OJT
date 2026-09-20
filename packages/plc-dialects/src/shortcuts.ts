import type { ShortcutEntry, ShortcutTable } from './profile.js';

/**
 * GX Works3風のキー割当表。設計仕様 §10.6 / §17 #19 / Phase 7 設計 §5.2。
 *
 * PCwin風（JTEKT）と JW-300SP風（シャープ）は一次資料が未確認のため**この表を流用する**のが
 * §17.1 の前提方針である。ただし流用した表はそのまま出さず、`assumedTable()` で全行を
 * `confirmed: false` ＋ 注記に落としてから使う（Phase 7 Task 20 step 4）。
 *
 * `confirmed: true` は一次資料で裏が取れた割当（◎）、`false` は §17.1 の前提方針で採用した
 * 慣例（△）である。UIは △ に注記と `source` を出す（§12.1）。出典の記号は
 * `docs/reference/ladder-skin-sources.md` の S1〜S8 を指す。
 */
export const GX_STYLE_SHORTCUTS: ShortcutTable = [
  { action: 'contact-no', keys: 'F5', label: 'a接点', confirmed: true, source: 'S1' },
  { action: 'contact-nc', keys: 'F6', label: 'b接点', confirmed: true, source: 'S1' },
  { action: 'or-contact-no', keys: 'Shift+F5', label: 'OR a接点', confirmed: true, source: 'S1' },
  { action: 'or-contact-nc', keys: 'Shift+F6', label: 'OR b接点', confirmed: true, source: 'S1' },
  { action: 'coil', keys: 'F7', label: 'コイル', confirmed: true, source: 'S1' },
  {
    /*
     * Phase 7 Task 20 step 2 / 指摘 LE-8: 以前は `enabled: false`（表には出すが効かない）
     * だった。本アプリが扱える命令（SET / RST / MC / MCR / T / C）を入れる「応用命令」欄を
     * 開く行き先ができたので、ふつうに使える行にする。
     */
    action: 'application',
    keys: 'F8',
    label: '応用命令',
    confirmed: true,
    source: 'S1',
    note: '本アプリが扱えるのは SET / RST / MC / MCR / T / C です',
  },
  { action: 'hline', keys: 'F9', label: '横線', confirmed: true, source: 'S1' },
  { action: 'vline', keys: 'Shift+F9', label: '縦線', confirmed: true, source: 'S1' },
  { action: 'delete-hline', keys: 'Ctrl+F9', label: '横線の削除', confirmed: true, source: 'S1' },
  { action: 'delete-vline', keys: 'Ctrl+F10', label: '縦線の削除', confirmed: true, source: 'S1' },
  {
    action: 'pulse-rise',
    keys: 'Shift+F7',
    label: '立上り微分接点',
    confirmed: false,
    source: 'S2',
  },
  {
    action: 'pulse-fall',
    keys: 'Shift+F8',
    label: '立下り微分接点',
    confirmed: false,
    source: 'S2',
  },
  {
    action: 'rule-line',
    keys: 'Ctrl+←↑↓→',
    label: '罫線（縦線・横線の作図）',
    confirmed: true,
    note: '押した向きへ罫線を引きます',
  },
  { action: 'convert', keys: 'F4', label: '変換', confirmed: true, source: 'S3' },
  { action: 'toggle-no-nc', keys: '/', label: 'a接点・b接点の切換', confirmed: true },
  { action: 'toggle-pulse', keys: 'Alt+/', label: '微分・SET/RST の切換', confirmed: true },
  { action: 'write-mode', keys: 'F2', label: '書込みモード', confirmed: true, source: 'S3' },
  { action: 'read-mode', keys: 'Shift+F2', label: '読出しモード', confirmed: true, source: 'S3' },
  { action: 'monitor', keys: 'F3', label: 'モニタ', confirmed: true, source: 'S3' },
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

/** 流用した表の全行に付ける注記（Phase 7 Task 20 step 4）。 */
export const ASSUMED_KEY_NOTE = '実機マニュアル未確認のため本アプリの表記です';

/**
 * 別メーカーの表を流用したスキン（PCwin風・JW-300SP風）のための変換。§17.1 / Phase 7 §5.2
 *
 * 借り元（三菱）で裏が取れているというだけの `confirmed: true` と `source` をそのまま出すと、
 * 「この**メーカーの実機**で確認できた」と読めてしまう。全行を `confirmed: false` に落とし、
 * 出典の記号を外し、どの行にも「本アプリの表記です」と断りを入れる。
 */
export function assumedTable(table: ShortcutTable): ShortcutTable {
  return table.map((entry): ShortcutEntry => {
    const assumed: ShortcutEntry = {
      action: entry.action,
      keys: entry.keys,
      label: entry.label,
      confirmed: false,
      note: entry.note === undefined ? ASSUMED_KEY_NOTE : `${entry.note} ${ASSUMED_KEY_NOTE}`,
    };
    // `source`（借り元の出典）は載せ替えない。`enabled: false` の印だけは引き継ぐ
    return entry.enabled === undefined ? assumed : { ...assumed, enabled: entry.enabled };
  });
}
