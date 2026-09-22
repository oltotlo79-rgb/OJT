import { PAPER_TOKENS } from '../src/shared/paper-style.mjs';

/** 画面テーマから独立したA4の操作ガイド。背景色もPDFへ出力する。 */
export const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
${PAPER_TOKENS}
:root { --navy: #122c46; --blue: #1769b3; --cyan: #46d4e7; --pale: #f1f6fb; --line: #d5e1ec; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 178mm; font-family: 'Yu Gothic UI', 'Meiryo', sans-serif;
  font-size: 10.5pt; line-height: 1.8; color: var(--ink); word-break: normal; line-break: strict;
  overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3 { page-break-after: avoid; break-after: avoid; line-height: 1.45; }
p { margin: 8px 0; orphans: 3; widows: 3; }
a { color: var(--blue); text-underline-offset: 3px; }
ul { margin: 9px 0; padding-left: 22px; }
li { margin: 5px 0; orphans: 2; widows: 2; }
strong { color: var(--navy); }

/* 表紙：情報を上から「製品・学び・入口」の3段で読む。 */
.cover { height: 252mm; display: flex; flex-direction: column; page-break-after: always; }
.cover-hero { position: relative; overflow: hidden; min-height: 145mm; padding: 13mm 12mm;
  color: white; background: linear-gradient(135deg, #10263b, #163f60); border-radius: 4mm; }
.cover-kicker { font-size: 9pt; letter-spacing: .2em; color: #9eeaf4; margin: 0 0 17mm; }
.cover-kind { font-size: 14pt; margin: 0 0 5mm; color: #d5e8f4; letter-spacing: .18em; }
.cover-title { font-size: 34pt; line-height: 1.35; font-weight: 800; margin: 0; white-space: nowrap; }
.cover-message { font-size: 17pt; margin: 7mm 0 0; color: #b2f0f7; }
.cover-art { display: block; width: 100%; height: 38mm; margin-top: 7mm; }
.cover-meta-row { display: flex; align-items: center; gap: 6mm; margin-top: 5mm; }
.cover-meta { font-size: 9pt; color: #d5e8f4; margin: 0; }
.cover-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-top: 6mm; }
.cover-mode { border-top: 3px solid var(--blue); padding: 3mm 2mm; background: var(--pale); border-radius: 0 0 2mm 2mm; }
.cover-mode b { display: block; color: var(--blue); font-size: 15pt; line-height: 1.3; }
.cover-mode span { font-size: 9pt; font-weight: 700; white-space: nowrap; }
.cover-howto { margin-top: auto; padding: 5mm 6mm; border: 1px solid var(--line); border-radius: 3mm; }
.cover-howto-title { font-size: 12pt; font-weight: 700; color: var(--navy); margin: 0 0 2mm; }
.cover-howto ol { margin: 0; padding-left: 20px; font-size: 9.5pt; }
.cover-howto li { margin: 2px 0; }
.cover-help { margin: 3mm 0 0; font-size: 9pt; color: var(--sub); }

/* 目次：章ごとにまとまりを保ち、節の行全体を押せる。 */
#toc { page-break-after: always; }
.toc-spread > h1, .toc-title { font-size: 27pt; font-weight: 700; color: var(--navy); margin: 0 0 2mm; }
.toc-spread + .toc-spread { page-break-before: always; }
.toc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8mm; }
.toc-intro { color: var(--sub); margin: 0 0 7mm; font-size: 10pt; }
#toc ol { list-style: none; margin: 0; padding: 0; }
#toc .toc-chapters { min-width: 0; }
#toc .toc-chapter { break-inside: avoid; margin: 0 0 2mm; padding: 0 0 1mm; border-bottom: 1px solid var(--line); }
#toc a { color: inherit; text-decoration: none; display: flex; align-items: baseline; gap: 2mm; }
#toc .toc-chapter > a { font-size: 10.5pt; line-height: 1.4; font-weight: 700; color: var(--navy); margin-bottom: 1mm; }
#toc .toc-sections a { font-size: 9pt; line-height: 1.55; color: var(--sub); }
#toc .toc-sections li { margin: .4mm 0; }
#toc .toc-no { flex: none; min-width: 12mm; color: var(--blue); font-variant-numeric: tabular-nums; }
#toc .toc-chapter > a > .toc-no { padding: 1mm 1.5mm; border-radius: 1mm; background: #e5f0fa; white-space: nowrap; }
#toc .toc-text { min-width: 0; }
#toc .toc-leader { flex: 1; min-width: 2mm; border-bottom: 1px dotted var(--line); }

/* 章の入口と節見出し。独立した扉だけの空白ページは増やさない。 */
.manual-chapter { page-break-before: always; }
.chapter-opening { page-break-inside: avoid; margin-bottom: 8mm; }
.chapter-opening h1 { font-size: 25pt; color: white; background: var(--navy); border-radius: 3mm;
  padding: 8mm 9mm; margin: 0; border-bottom: 2mm solid var(--cyan); }
.chapter-no { display: block; font-size: 11pt; color: #9eeaf4; letter-spacing: .14em; margin-bottom: 4mm; }
.chapter-route { display: flex; gap: 3mm; flex-wrap: wrap; padding: 3mm 1mm; border-bottom: 1px solid var(--line); }
.chapter-route a { font-size: 9pt; text-decoration: none; }
.chapter-route a::before { content: '↗'; margin-right: 1mm; }
.manual-section { margin-bottom: 5mm; }
.manual-section > h2 { display: flex; align-items: baseline; gap: 3mm; font-size: 15pt; color: var(--navy);
  margin: 6mm 0 4mm; padding: 0 0 3mm; border-bottom: 1px solid var(--line); }
.manual-section > h2 .num { flex: none; padding: 1mm 2mm; border-radius: 1.5mm;
  background: var(--blue); color: white; font-size: 10pt; font-variant-numeric: tabular-nums; }
h3 { font-size: 11.5pt; color: var(--blue); margin: 5mm 0 2mm; padding-left: 3mm; border-left: 3px solid var(--cyan); }
.procedure-title { color: var(--navy); }

/* 操作手順：番号と本文が同じカードに収まる。 */
.manual-section ol { counter-reset: step; list-style: none; padding: 0; margin: 4mm 0; }
.manual-section ol > li { position: relative; background: var(--pale); border: 1px solid #e3ebf3;
  border-radius: 2mm; margin: 2mm 0; padding: 3mm 4mm 3mm 12mm; page-break-inside: avoid; }
.manual-section ol > li::before { counter-increment: step; content: counter(step); position: absolute;
  left: 3mm; top: 3.4mm; width: 6mm; height: 6mm; line-height: 6mm; border-radius: 1.5mm;
  background: var(--blue); color: white; text-align: center; font-size: 9pt; font-weight: 700; }
/* 短い手順が続く章は、文字を縮めずカードの余白を抑える。 */
.manual-chapter:is([data-chapter-id="setup"], [data-chapter-id="mode-b"]) ol > li { padding-top: 2.3mm; padding-bottom: 2.3mm; }
.manual-chapter:is([data-chapter-id="setup"], [data-chapter-id="mode-b"]) ol > li::before { top: 2.7mm; }
.manual-chapter:is([data-chapter-id="setup"], [data-chapter-id="mode-b"], [data-chapter-id="glossary"]) h2 { margin-top: 5mm; margin-bottom: 3mm; padding-bottom: 2.5mm; }
.manual-chapter[data-chapter-id="setup"] { line-height: 1.65; }
.manual-chapter[data-chapter-id="setup"] p { margin-top: 6px; margin-bottom: 6px; }

/* 表：横方向の読み筋を優先し、濃い見出しと交互の行色で追う。 */
table { border-collapse: collapse; width: 100%; margin: 4mm 0; page-break-inside: auto; font-size: 9.5pt; line-height: 1.65; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { padding: 2mm 3mm; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
th { background: var(--navy); color: white; font-weight: 700; }
tbody tr:nth-child(even) { background: var(--pale); }
td:first-child { color: var(--navy); }
.manual-chapter[data-chapter-id="glossary"] :is(th, td) { padding-top: 1.5mm; padding-bottom: 1.5mm; line-height: 1.55; }
table[data-manual-table="problem-index"] { table-layout: fixed; font-size: 9pt; }
table[data-manual-table="problem-index"] :is(th, td) { padding-top: 2.5mm; padding-bottom: 2.5mm; }
table[data-manual-table="problem-index"] th:nth-child(1) { width: 18%; }
table[data-manual-table="problem-index"] th:nth-child(2) { width: 34%; }
table[data-manual-table="problem-index"] th:nth-child(3) { width: 24%; }
table[data-manual-table="problem-index"] th:nth-child(4) { width: 24%; }
.problem-id { font: 700 10pt 'Consolas', monospace; color: var(--blue); white-space: nowrap; }
.problem-level { display: block; color: var(--sub); font-size: 8pt; white-space: nowrap; margin-top: 1mm; }
.problem-level .mode::after { content: ' / '; }
.problem-level .grade::after { content: '級 / '; }
.problem-level .difficulty::before { content: '難度 '; }
.index-key { display: block; }
.index-level-heading { font-size: 8pt; font-weight: 400; }
table[data-manual-table="problem-index"] td:not(:first-child) { text-wrap: balance; }
code { background: #e5edf5; padding: 1px 4px; border-radius: 3px; font: 9.5pt 'Consolas', monospace; }
pre { background: var(--pale); border-left: 3px solid var(--blue); padding: 4mm;
  overflow-wrap: anywhere; white-space: pre-wrap; font-size: 9pt; line-height: 1.6; page-break-inside: avoid; }
pre code { background: transparent; padding: 0; font-size: inherit; }

/* 画面写真：版面いっぱいに載せ、図番号と説明を一つの枠にする。 */
figure { margin: 5mm 0; page-break-inside: avoid; border: 1px solid var(--line); border-radius: 2mm; overflow: hidden; background: var(--pale); }
figure img { display: block; width: 100%; max-height: 105mm; object-fit: contain; background: #111923; }
figcaption { padding: 2.5mm 4mm; margin: 0; font-size: 9pt; color: var(--sub); text-align: left; line-height: 1.6; }
figcaption .fig-no { display: inline-block; font-weight: 700; color: var(--blue); margin-right: 3mm; white-space: nowrap; }

/* 注意・ヒント・禁止を色と印の両方で区別する。 */
blockquote { margin: 4mm 0; padding: 3mm 4mm; border-left: 3px solid var(--blue); background: var(--pale); page-break-inside: avoid; border-radius: 0 2mm 2mm 0; }
blockquote p { margin: 3px 0; }
blockquote.notice { position: relative; padding: 4mm 5mm 4mm 13mm; }
blockquote.notice::before { position: absolute; left: 4mm; top: 4.5mm; width: 6mm; height: 6mm;
  line-height: 6mm; text-align: center; border-radius: 50%; color: white; font-size: 10pt; font-weight: 700; }
.notice-caution { border-left-color: var(--caution); background: #fff5de; }
.notice-caution::before { content: '!'; background: var(--caution); }
.notice-tip { border-left-color: var(--tip); background: #eaf4fc; }
.notice-tip::before { content: 'i'; background: var(--tip); }
.notice-forbid { border-left-color: var(--forbid); background: #fff0ef; }
.notice-forbid::before { content: '\\00d7'; background: var(--forbid); }
.notice > p:first-child > strong:first-child { display: block; margin-bottom: 1mm; }
.notice-caution > p:first-child > strong:first-child { color: var(--caution); }
.notice-tip > p:first-child > strong:first-child { color: var(--tip); }
.notice-forbid > p:first-child > strong:first-child { color: var(--forbid); }
`.trim();
