import {
  checkWirableTerminal,
  loadBoard,
  toSessionTerminal,
  type BoardDefinition,
  type BoardSession,
} from '@ojt/board-model';
import {
  DEFAULT_CONTACT_RESISTIVE_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  FaultError,
  injectFault,
  toTerminalId,
  type FaultKind,
  type FaultTarget,
  type Netlist,
  type TerminalId,
  type Wire,
} from '@ojt/circuit-sim';
import { isWireFaultKind, type FaultSpecData } from './schema/faults.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * 故障の適用。設計仕様 §5.4 / §9.2。
 *
 * 3D盤は「配線されているとおり」を描き、シミュレーションだけが故障を見る。そのため故障を
 * **盤セッションに載るもの**（電線の断線・未配線・誤配線）と、**ネットリストへ変換するたびに
 * 注入し直すもの**（接点・コイル・ランプ）に振り分ける。前者は `toNetlist()` が
 * `{ ...wire }` でフィールドをそのまま写すので、`open` を立てるだけで電気的に切れる。
 * 後者は `MountedPart` に故障を持たせる場所が無いため、変換のたびに `injectFault()` を通す。
 */

/** 訓練者が3D盤の上で選べる指摘の種別（断線／未配線／誤配線／部品不良）。§9.2 / 決定事項#11 */
export type FaultReportKind = 'wire-open' | 'wire-missing' | 'wire-misrouted' | 'part-defect';

/** 故障1件の「盤の上での在処」。訓練者の指摘との突き合わせに使う。§9.2 */
export interface FaultSite {
  /** 注入した故障の種別（§5.4）。 */
  kind: FaultKind;
  /** 訓練者が選ぶべき指摘の種別（§9.2 の4択）。 */
  report: FaultReportKind;
  /** 電線の故障のときの電線ID（`wire-missing` は取り除かれた電線のID）。 */
  wireId: string | undefined;
  /** 部品の故障のときの部品ID。 */
  partId: string | undefined;
  /** 指摘として受け付ける端子（電線の故障のときの両端）。 */
  terminals: readonly TerminalId[];
}

/** 振り分けた故障。 */
export interface AppliedFaults {
  /**
   * 盤セッションに適用済みの電線の故障。`faults` のうち電線を対象にするものだけを元の順で
   * 集めた配列で、`partFaults` / `sites` とは別の独立した配列である。
   */
  wireFaults: readonly FaultSpecData[];
  /**
   * ネットリストへ変換するたびに注入する部品の故障。`faults` のうち部品を対象にするものだけを
   * 元の順で集めた配列で、`wireFaults` / `sites` とは別の独立した配列である。
   */
  partFaults: readonly FaultSpecData[];
  /** 故障の在処。並び順は課題の `faults` と同じ。 */
  sites: readonly FaultSite[];
}

/** 適用結果（課題データの誤りは `ProblemIssue` で返す。§13 #2）。 */
export type ApplyFaultsResult =
  { ok: true; value: AppliedFaults } | { ok: false; errors: ProblemIssue[] };

/** 訓練者の指摘1件。3D盤の上で電線・端子・部品をクリックして種別を選ぶ。§9.2 */
export interface FaultReport {
  target: { wireId: string } | { partId: string } | { terminalId: string };
  kind: FaultReportKind;
}

/** 注入した種別から、訓練者が選ぶべき指摘の種別を決める。部品の故障はすべて「部品不良」。§9.2 */
export function reportKindOf(kind: FaultKind): FaultReportKind {
  if (kind === 'wire-open' || kind === 'wire-missing' || kind === 'wire-misrouted') return kind;
  return 'part-defect';
}

/** `injectFault()` に渡す `param` を作る。§5.4 */
export function faultParam(spec: FaultSpecData): number | TerminalId | undefined {
  if (spec.kind === 'contact-resistive') return spec.ohms ?? DEFAULT_CONTACT_RESISTIVE_OHMS;
  if (spec.kind === 'coil-layer-short') return spec.ratio ?? DEFAULT_LAYER_SHORT_RATIO;
  if (spec.kind === 'wire-misrouted') {
    return spec.to === undefined ? undefined : toTerminalId(spec.to);
  }
  return undefined;
}

/**
 * `FaultSpecData.target` を circuit-sim の `FaultTarget` に直す。
 * `injectPartFaults()` からしか呼ばれず、渡ってくるのは常に部品対象（`partFaults`）である。
 */
function toEngineTarget(target: FaultSpecData['target']): FaultTarget {
  /* c8 ignore next -- injectPartFaults は部品対象の故障（partFaults）しか渡さないため到達しない */
  if ('wireId' in target) return { wireId: target.wireId };
  return { partId: target.partId, elementIndex: target.elementIndex };
}

/**
 * 課題の故障を盤セッションへ適用し、部品の故障は注入用に取り分ける。§5.4 / §9.2
 *
 * **全件を検証してから反映する**（レビュー指摘 M-6）。`faults` は盤セッションの電線配列の
 * 複製に対して先頭から順に適用してみる形で検証し、課題データの誤り（存在しない電線ID・
 * 既設配線の指定・同じ電線への二重指定・付け替え先の端子が盤に無い／配線できない／1端子2本の
 * 超過）が1件でもあれば、実セッション（`session.wires`）を**一切変更せずに** `ok: false` を返す。
 * 全件が解決できたときだけ、複製した電線配列をまとめて実セッションへ反映する。呼び出し側は
 * `ok: false` を見ても盤をそのまま使い続けてよい（途中まで適用された中途半端な状態を心配する
 * 必要はない）。
 *
 * **（レビュー指摘 M1）成功したときは `session.wires` が丸ごと差し替わる。** 配列も要素も新しい
 * オブジェクトなので、呼び出し前に掴んでいた `session.wires` の参照・その中の `Wire` の参照は
 * どちらも古いままになる（`wire.open` を立てても盤には効かない）。適用後は必ず `session.wires`
 * を読み直すこと。`initialWireIds` のような派生値も適用後に取り直す。
 *
 * `board` は誤配線の付け替え先を `addWire()` と同じ規則で検査するために要る。省略すると
 * セッションの `boardId` から引く（`buildReferenceSession()` が作ったセッションなら必ず引ける）。
 */
export function applyFaults(
  session: BoardSession,
  faults: readonly FaultSpecData[],
  board: BoardDefinition = loadBoard(session.boardId),
): ApplyFaultsResult {
  const errors: ProblemIssue[] = [];
  const wireFaults: FaultSpecData[] = [];
  const partFaults: FaultSpecData[] = [];
  const sites: FaultSite[] = [];
  // 検証用の複製。実セッションが確定するまで、電線の変更はすべてこちらに対して行う。
  const draft: Wire[] = session.wires.map((w) => ({ ...w }));
  // 同じ電線を2回指定させない（レビュー指摘 M3）。許すと `sites` に同じ電線が並び、訓練者が
  // 1回指摘しただけでは合格できない／未配線と断線が同じ電線に同居する、といった課題になる。
  // 部品も同じ理由で2回指定させない（CT-03）。`FaultReport.target` は部品を `partId` だけで
  // 指す（どの要素かは区別しない）ので、同じ部品に2件の部品故障を入れると
  // `injectPartFaults()` が後勝ちで上書きし、訓練者は片方の故障を原理的に指摘し得ない。
  // 電線IDと部品IDは別の名前空間なので、鍵に `wire:`/`part:` を付けて衝突を避ける。
  const targeted = new Set<string>();

  faults.forEach((spec, index) => {
    const report = reportKindOf(spec.kind);
    if (!isWireFaultKind(spec.kind)) {
      const target = spec.target;
      /* c8 ignore next -- スキーマが wireId ターゲットに部品系 kind を許さないため到達しない */
      if ('wireId' in target) return; // スキーマが弾くので到達しないが型のための番人
      const key = `part:${target.partId}`;
      if (targeted.has(key)) {
        errors.push({
          path: `faults[${index}].target.partId`,
          message: `同じ部品に複数の故障は入れられません: ${target.partId}`,
        });
        return;
      }
      targeted.add(key);
      partFaults.push(spec);
      sites.push({
        kind: spec.kind,
        report,
        wireId: undefined,
        partId: target.partId,
        terminals: [],
      });
      return;
    }
    const target = spec.target;
    /* c8 ignore next -- 同上、スキーマが弾くため到達しない */
    if (!('wireId' in target)) return; // 同上
    const wireKey = `wire:${target.wireId}`;
    if (targeted.has(wireKey)) {
      errors.push({
        path: `faults[${index}].target.wireId`,
        message: `同じ電線に複数の故障は入れられません: ${target.wireId}`,
      });
      return;
    }
    targeted.add(wireKey);
    const position = draft.findIndex((w) => w.id === target.wireId);
    const wire = position < 0 ? undefined : draft[position];
    if (wire === undefined) {
      errors.push({
        path: `faults[${index}].target.wireId`,
        message: `故障を入れる電線が盤にありません: ${target.wireId}`,
      });
      return;
    }
    if (wire.locked) {
      errors.push({
        path: `faults[${index}].target.wireId`,
        message: `チェック用回路の既設配線には故障を入れられません: ${target.wireId}`,
      });
      return;
    }
    const terminals: readonly TerminalId[] = [wire.from, wire.to];
    if (spec.kind === 'wire-open') {
      wire.open = true;
    } else if (spec.kind === 'wire-missing') {
      draft.splice(position, 1);
    } else {
      /* c8 ignore next -- スキーマが to を必須にしているため到達しない */
      if (spec.to === undefined) return; // スキーマが必須にしている
      // 付け替え先は盤の配線規則そのもの（§6.4 / §6.6）で検査する。3D盤は「配線されているとおり」
      // を描くので、盤に無い端子・配線できない本体端子・載っていない任意部品の端子を許すと
      // 描画側が落ちる。判定は addWire() と同じ board-model の検査を借りて重複実装を避ける。
      const to = toSessionTerminal(session, toTerminalId(spec.to));
      if (to === wire.from) {
        errors.push({
          path: `faults[${index}].to`,
          message: `誤配線の付け替え先が同じ端子です（電線の両端が同じになります）: ${to}`,
        });
        return;
      }
      const checked = checkWirableTerminal({ ...session, wires: draft }, board, to);
      if (!checked.ok) {
        errors.push({
          path: `faults[${index}].to`,
          message: `誤配線の付け替え先：${checked.message}`,
        });
        return;
      }
      wire.to = checked.value;
    }
    wireFaults.push(spec);
    sites.push({ kind: spec.kind, report, wireId: wire.id, partId: undefined, terminals });
  });

  if (errors.length > 0) return { ok: false, errors };
  session.wires = draft;
  return { ok: true, value: { wireFaults, partFaults, sites } };
}

/**
 * 部品の故障をネットリストへ注入する。§5.4
 * エンジンの `FaultError`（存在しない部品・要素、種別と要素の不一致）は課題データの誤りなので
 * `ProblemIssue` に変換して返す（例外にしない。§13 #2）。
 */
export function injectPartFaults(
  netlist: Netlist,
  partFaults: readonly FaultSpecData[],
): ProblemIssue[] {
  const issues: ProblemIssue[] = [];
  partFaults.forEach((spec, index) => {
    try {
      injectFault(netlist, toEngineTarget(spec.target), spec.kind, faultParam(spec));
    } catch (error) {
      /* c8 ignore next -- FaultError 以外の想定外の例外を握り潰さないための安全弁（通常は発生しない） */
      if (!(error instanceof FaultError)) throw error;
      issues.push({ path: `faults[${index}].target`, message: error.message });
    }
  });
  return issues;
}

/**
 * その部品の故障を取り消した `AppliedFaults` を返す（部品交換。§9.2）。
 * 良品に差し替えたのと同じで、以後 `injectPartFaults()` はその部品に触れない。
 *
 * **`sites` は減らさない。** 部品を交換しても「その部品が不良だった」という事実は消えず、
 * 訓練者はその部品を指摘しなければ合格しない（§9.2 判定①「全故障を過不足なく指摘」）。
 * 交換で変わるのは電気的な挙動（＝ネットリストへの注入）だけである。
 */
export function withoutPartFaults(applied: AppliedFaults, partId: string): AppliedFaults {
  const keep = (spec: FaultSpecData): boolean =>
    'wireId' in spec.target || spec.target.partId !== partId;
  return {
    wireFaults: applied.wireFaults,
    partFaults: applied.partFaults.filter(keep),
    sites: applied.sites,
  };
}

/**
 * その指摘がその故障を言い当てているか。§9.2
 * - 断線・誤配線: 盤の上に電線が残っているので**電線**をクリックして種別を選ぶ
 * - 未配線: 電線が無いので**端子**をクリックする（取り除かれた電線の両端のどちらでもよい）
 * - 部品不良: **部品**をクリックして「部品不良」を選ぶ（どの要素かは問わない）
 */
export function matchesSite(site: FaultSite, report: FaultReport): boolean {
  if (report.kind !== site.report) return false;
  if ('wireId' in report.target) {
    return site.kind !== 'wire-missing' && site.wireId === report.target.wireId;
  }
  if ('partId' in report.target) {
    return site.partId !== undefined && site.partId === report.target.partId;
  }
  const terminalId: string = report.target.terminalId;
  return site.kind === 'wire-missing' && site.terminals.some((t) => t === terminalId);
}
