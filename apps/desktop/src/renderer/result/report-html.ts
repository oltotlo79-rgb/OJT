import {
  measurementDisplay,
  measurementSetting,
  measurementTime,
  type MeasurementRecord,
  type DiagnosisNote,
} from '../../shared/diagnosis.js';
import type { SupportedProblem, WiringSuspect } from '@ojt/content';
import { PAPER_TOKENS } from '../../shared/paper-style.mjs';
import { formatElapsed } from '../../worker/runtime.js';
import type { AnyJudgeResult } from '../app/store-session.js';
import { APP_NAME, correctCountText, difficultyLabel, gradeLabel, JA } from '../i18n/ja.js';
import { mismatchLine, verdictSummary } from './verdict-summary.js';

/** 必要な情報だけを投影する。利用者名・保存場所・作業ファイルそのものは受け取らない。 */
export interface ReportInput {
  measurements?: readonly MeasurementRecord[];
  diagnosisNotes?: readonly DiagnosisNote[];
  problem: Pick<SupportedProblem, 'id' | 'title' | 'grade' | 'difficulty' | 'mode'>;
  result: AnyJudgeResult;
  sessionOpenedAtMs: number;
  restoredHazardCount: number;
  hintStage: number;
  schematicOpenCount: number;
  suspects?: readonly WiringSuspect[];
  suspectTotal?: number;
}

/** ユーザー課題の文言もHTMLとして解釈させず、内部の線IDや絶対パスを持ち出さない。 */
function text(value: unknown, limit = 180): string {
  const raw = String(value)
    .replace(/\b(?:s?w)-\d+\b/gi, JA.report.redacted)
    .replace(/(?:[a-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|mnt)\/)[^\s<>"']*/gi, JA.report.redacted)
    .replace(/(?:https?|file):[^\s<>"']*/gi, JA.report.redacted);
  const chars = [...raw];
  const bounded = chars.length > limit ? `${chars.slice(0, limit).join('')}…` : raw;
  return bounded.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char,
  );
}

function count(value: number): string {
  return String(Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
}

function pair(label: string, value: string): string {
  return `<div><dt>${text(label)}</dt><dd>${text(value)}</dd></div>`;
}

function list(title: string, lines: readonly string[], total = lines.length): string {
  return `<section><h2>${text(title)} <span class="count">${count(total)}</span></h2><ul>${lines.map((line) => `<li>${text(line, 90)}</li>`).join('')}</ul></section>`;
}

const CSS = `
${PAPER_TOKENS}
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 178mm; color: var(--ink); font: 10pt/1.55 'Yu Gothic UI', Meiryo, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow-wrap: anywhere; }
header { border-top: 3mm solid var(--accent); padding: 5mm 0 4mm; border-bottom: 1px solid var(--hair); }
.kicker { color: var(--sub); font-size: 9pt; letter-spacing: .09em; margin: 0 0 2mm; }
h1 { font-size: 23pt; line-height: 1.2; margin: 0; }
.problem { font-weight: 700; font-size: 13pt; line-height: 1.45; margin: 4mm 0 1mm; }
.meta, .note { color: var(--sub); font-size: 9pt; margin: 1mm 0; }
.verdict { display: flex; align-items: flex-start; gap: 5mm; padding: 4mm 0 2mm; }
.badge { flex: none; border: 1px solid currentColor; color: var(--accent); padding: 2mm 4mm; font-size: 15pt; font-weight: 700; }
.failed { color: var(--forbid); }
.summary { margin: 1mm 0 0; }
dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; padding: 3mm 4mm; background: var(--tint); margin: 0 0 2mm; }
dt { font-size: 8.5pt; color: var(--sub); }
dd { margin: 1mm 0 0; font-size: 11pt; font-weight: 600; }
h2 { font-size: 11pt; margin: 0 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid var(--hair); }
.count { font-weight: 400; color: var(--sub); font-size: 9pt; }
section { margin-top: 3mm; break-inside: avoid; }
section.records { break-inside: auto; }
.records p { break-inside: avoid; }
.records strong { display: inline-block; max-width: 100%; }
ul { margin: 0; padding-left: 5mm; }
li { margin: .5mm 0; }
.checks { display: grid; grid-template-columns: repeat(2, 1fr); list-style: none; padding: 0; gap: 1mm 5mm; }
.checks li { font-size: 9pt; }
.ng { color: var(--forbid); font-weight: 700; }
footer { margin-top: 3mm; border-top: 1px solid var(--hair); padding-top: 2mm; color: var(--sub); font-size: 8.5pt; }
`;

/** 基本結果はA4 1枚の要約。測定・診断記録は必要に応じて続くページへ出力する。 */
export function resultReportHtml(input: ReportInput): string {
  const { problem, result } = input;
  const modes = {
    assemble: JA.home.assemble,
    'inspect-parts': JA.home.inspectParts,
    'inspect-repair': JA.home.inspectRepair,
    plc: JA.home.plc,
  };
  const started =
    Number.isFinite(input.sessionOpenedAtMs) && input.sessionOpenedAtMs > 0
      ? new Date(input.sessionOpenedAtMs).toLocaleString('ja-JP', { hour12: false })
      : JA.report.unknown;
  let summary: string;
  let details = '';
  if (result.mode === 'inspect-parts') {
    summary = result.passed ? JA.report.passedParts : JA.report.failedParts;
    details = `<section><h2>${text(JA.result.markSheet)}</h2><p>${text(correctCountText(result.correctCount, result.total))}</p></section>`;
  } else {
    // 詳細は内部識別子を含み得るので、要約にはチェック名だけを渡す。
    summary =
      verdictSummary(
        {
          ...result,
          staticChecks: result.staticChecks.map((check) => ({
            ...check,
            details: [],
            message: '',
          })),
        },
        input.suspects,
      ).text || JA.report.checkDetails;
    details += `<section><h2>${text(JA.result.staticChecks)}</h2><ul class="checks">${result.staticChecks.map((check) => `<li class="${check.ok ? '' : 'ng'}">${check.ok ? '✓' : '▲'} ${text(JA.staticCheck[check.id])}</li>`).join('')}</ul></section>`;
    if (!result.passed && result.mismatches.length > 0) {
      details += list(
        JA.result.mismatches,
        result.mismatches.slice(0, 5).map(mismatchLine),
        result.mismatches.length,
      );
    }
    if (result.mode === 'inspect-repair') {
      if (
        !result.passed &&
        result.mismatches.length === 0 &&
        result.staticChecks.every((check) => check.ok)
      ) {
        summary = `${JA.report.faultReports}: ${JA.report.missed} ${count(result.reports.missed.length)} / ${JA.report.extra} ${count(result.reports.extra.length)}。${JA.report.modifications} ${count(result.modifications.length)}。`;
      }
      details += list(
        JA.report.faultReports,
        [
          `${JA.report.matched} ${count(result.reports.matched.length)} / ${JA.report.missed} ${count(result.reports.missed.length)} / ${JA.report.extra} ${count(result.reports.extra.length)}`,
          `${JA.report.repairs}: ${JA.report.modifications} ${count(result.modifications.length)} / ${JA.report.addedWires} ${count(result.addedWires.length)}`,
        ],
        result.reports.matched.length + result.reports.missed.length,
      );
    }
    if (result.mode === 'plc' && result.ladderErrors.length > 0) {
      summary = `${JA.report.ladderErrors}: ${count(result.ladderErrors.length)}`;
      details += list(JA.report.ladderErrors, [], result.ladderErrors.length);
    }
  }
  if (!result.passed && (input.suspects?.length ?? 0) > 0) {
    details += list(
      JA.result.suspects,
      input.suspects?.slice(0, 3).map((item) => item.message) ?? [],
      input.suspectTotal ?? input.suspects?.length,
    );
  }
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${text(JA.report.title)}</title><style>${CSS}</style></head><body>
<header><p class="kicker">${text(APP_NAME)}</p><h1>${text(JA.report.title)}</h1><p class="problem">${text(problem.title, 60)}</p><p class="meta">${text(problem.id, 64)} · ${text(modes[problem.mode])} · ${text(gradeLabel(problem.grade))} · ${text(difficultyLabel(problem.difficulty))}</p></header>
<div class="verdict"><span class="badge ${result.passed ? '' : 'failed'}">${text(result.passed ? JA.result.passed : JA.result.failed)}</span><p class="summary">${text(summary, 120)}</p></div>
<dl>${pair(JA.report.started, started)}${pair(JA.result.elapsed, formatElapsed(result.elapsedMs ?? 0))}${pair(JA.result.hazards, `${count(result.hazardCount + input.restoredHazardCount)} ${JA.result.times}`)}${pair(JA.result.hintsUsed, `${count(input.hintStage)} ${JA.result.times}`)}${pair(JA.report.schematicHints, `${count(input.schematicOpenCount)} ${JA.result.times}`)}</dl>
<p class="note">${text(JA.report.startedNote)}</p><p class="note">${text(JA.report.referenceOnly)}</p>
${details}
${(input.measurements?.length ?? 0) === 0 ? '' : `<section class="records"><h2>自分の測定記録</h2>${input.measurements!.map((record) => `<p>測定 #${input.measurements!.indexOf(record) + 1} ／ ${text(measurementTime(record.at))} ／ ${text(measurementSetting(record))}${record.partId === undefined ? '' : ` ／ 対象部品 ${text(record.partId)}`} ／ 黒: ${text(record.black)} 赤: ${text(record.red)} ／ <strong>${text(measurementDisplay(record))}</strong> ／ ${record.powered ? '通電中' : '電源OFF'}<br>${text(record.note, 1000)}</p>`).join('')}</section>`}
${(input.diagnosisNotes?.length ?? 0) === 0 ? '' : `<section class="records"><h2>診断メモ</h2>${input.diagnosisNotes!.map((note) => `<p>${text(note.target)}<br>予測: ${text(note.prediction, 1000)}<br>判断: ${text(note.conclusion, 1000)}<br>関連測定: ${note.measurementIds.map((id) => `#${(input.measurements ?? []).findIndex((record) => record.id === id) + 1}`).join('、') || 'なし'}</p>`).join('')}</section>`}
<footer>${text(JA.report.footer)}</footer></body></html>`;
}
