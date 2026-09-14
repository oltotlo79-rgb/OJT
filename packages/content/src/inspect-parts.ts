import {
  CHECK_SOCKET_ID,
  createSession,
  DEFAULT_TIMER_RANGE,
  plug,
  socketPartId,
  toNetlist,
  type BoardDefinition,
  type BoardSession,
  type MountableKind,
} from '@ojt/board-model';
import {
  COIL_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  SOCKET_CONTACT_PINS,
  terminalId,
  type Netlist,
  type TerminalId,
} from '@ojt/circuit-sim';
import { injectPartFaults } from './faults.js';
import { hashSeed, mulberry32, pickIndex } from './rng.js';
import { toSocketRoles } from './schema/common.js';
import {
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  type FaultSpecData,
} from './schema/faults.js';
import type { InspectPartData, InspectPartsProblem, PartTruth } from './schema/inspect-parts.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * モードC1（部品点検）のドメイン。設計仕様 §9.1。
 * トレイの部品をチェック用ソケットに挿し、`truth` に対応する故障を注入したネットリストを作る。
 * チェック用ソケットは回り込みが起きない構成（赤PBのa接点でコイルだけを励磁する固定配線）なので、
 * 「リレーを抜いて測る」教育がそのまま成立する（§6.3 / §9.1 C2との違い）。
 */

/** チェック用ソケットの部品ID。§6.4 */
export const CHECK_PART_ID = 'CHK';

/** チェック用ソケットのコイル（−）端子。§9.1 測定1 */
export const CHECK_COIL_MINUS: TerminalId = terminalId(CHECK_PART_ID, '13');
/** チェック用ソケットのコイル（＋）端子。§9.1 測定1 */
export const CHECK_COIL_PLUS: TerminalId = terminalId(CHECK_PART_ID, '14');

/**
 * チェック用ソケットに挿したタイマの設定時間[ms]。
 * 点検はタイムアップを見るだけなので短くしてある（実機の設定つまみとは無関係）。
 */
export const CHECK_TIMER_PRESET_MS = 1000;

/** 励磁（タイマはタイムアップ）を待つ時間[ms]。§9.1 切り分け手順① */
export function checkSettleMs(kind: MountableKind): number {
  return kind === 'timer-h3y4' ? CHECK_TIMER_PRESET_MS + 100 : 100;
}

/** レアショートと判定するコイル抵抗の割合（正常値の85%以下）。§9.1 補足 / §17.2 #7 */
export const LAYER_SHORT_JUDGE_RATIO = 0.85;

/** レアショートの判定しきい値[Ω]。既定のコイル（650Ω）なら 552.5Ω。§9.1 補足 */
export function layerShortThresholdOhms(nominalOhms: number = COIL_OHMS): number {
  return nominalOhms * LAYER_SHORT_JUDGE_RATIO;
}

/** マークシートの選択肢の表示名。§9.1 回答 */
export const PART_TRUTH_LABELS: Readonly<Record<PartTruth, string>> = {
  normal: '正常',
  'coil-open': 'コイル断線',
  'coil-layer-short': 'レアショート',
  'a-open': 'a接点 導通不良',
  'a-weld': 'a接点 溶着',
  'b-open': 'b接点 導通不良',
  'b-weld': 'b接点 溶着',
};

/** 判定表の1行（ヘルプの折りたたみパネルに出す）。§9.1 */
export interface DiagnosisRow {
  /** チェック状況。 */
  situation: string;
  /** その状況から導かれる原因。 */
  cause: PartTruth;
}

/** §9.1 の判定表（調査資料 §6.3）。ヘルプ表示とテストの唯一の源。 */
export const DIAGNOSIS_TABLE: readonly DiagnosisRow[] = [
  {
    situation: '赤PBを押してもコイルが吸引しない ＋ コイル抵抗が OL（測定不能）',
    cause: 'coil-open',
  },
  { situation: 'ON時に a接点 導通なし', cause: 'a-open' },
  { situation: 'OFF時に a接点 導通あり', cause: 'a-weld' },
  { situation: 'ON時に b接点 導通あり', cause: 'b-weld' },
  { situation: 'OFF時に b接点 導通なし', cause: 'b-open' },
  { situation: '動作も接点も正常 ＋ コイル抵抗が約650Ω（正常の85%超）', cause: 'normal' },
  {
    situation: '動作も接点も正常 ＋ コイル抵抗が正常の85%以下（本アプリの既定は約420Ω）',
    cause: 'coil-layer-short',
  },
];

/** 接点1組ぶんの端子（COM・a接点・b接点）。§6.2 */
export function checkContactTerminals(group: number): {
  com: TerminalId;
  no: TerminalId;
  nc: TerminalId;
} {
  const pins = SOCKET_CONTACT_PINS[group - 1];
  if (pins === undefined) throw new RangeError(`接点の組は1〜4です: ${String(group)}`);
  return {
    com: terminalId(CHECK_PART_ID, String(pins.com)),
    no: terminalId(CHECK_PART_ID, String(pins.no)),
    nc: terminalId(CHECK_PART_ID, String(pins.nc)),
  };
}

/** その `truth` のときテスターが示すはずの値。§9.1 判定表 */
export interface ExpectedCheckReading {
  /** 赤PBを押したとき接点が動作位置へ移るか（タイマはタイムアップするか）。 */
  picksUp: boolean;
  /** コイル抵抗[Ω]。`null` は `OL`（測定不能＝断線）。 */
  coilOhms: number | null;
  /** 励磁OFF時に a接点が導通するか。 */
  aClosedOff: boolean;
  /** 励磁ON時に a接点が導通するか。 */
  aClosedOn: boolean;
  /** 励磁OFF時に b接点が導通するか。 */
  bClosedOff: boolean;
  /** 励磁ON時に b接点が導通するか。 */
  bClosedOn: boolean;
}

/** 正常品の読値。 */
const NORMAL_READING: ExpectedCheckReading = {
  picksUp: true,
  coilOhms: COIL_OHMS,
  aClosedOff: false,
  aClosedOn: true,
  bClosedOff: true,
  bClosedOn: false,
};

/**
 * その部品を §9.1 の手順で点検したときの読値。判定表そのものであり、テストとヘルプの唯一の源。
 * 溶着は組のもう一方の接点を機械的に開くので（§7.5 / `injectFault`）、a溶着ならb接点は
 * ON/OFFとも導通しない（「b接点の導通不良」に見えるが答えは「a接点の溶着」。調査資料 §6.1）。
 */
export function expectedCheckReading(part: InspectPartData): ExpectedCheckReading {
  switch (part.truth) {
    case 'normal':
      return { ...NORMAL_READING };
    case 'coil-open':
      return {
        picksUp: false,
        coilOhms: null,
        aClosedOff: false,
        aClosedOn: false,
        bClosedOff: true,
        bClosedOn: true,
      };
    case 'coil-layer-short':
      return { ...NORMAL_READING, coilOhms: COIL_OHMS * (part.ratio ?? DEFAULT_LAYER_SHORT_RATIO) };
    case 'a-open':
      return { ...NORMAL_READING, aClosedOn: false };
    case 'a-weld':
      return { ...NORMAL_READING, aClosedOff: true, bClosedOff: false, bClosedOn: false };
    case 'b-open':
      return { ...NORMAL_READING, bClosedOff: false, bClosedOn: false };
    case 'b-weld':
      return { ...NORMAL_READING, aClosedOff: false, aClosedOn: false, bClosedOn: true };
  }
}

/**
 * 接点の不良をどの組に入れるか。§7.5「組の選択」
 * 課題が `group` を書いていればそれを使い、書いていなければ課題の `seed` と部品IDから
 * 決定論的に決める（同じ課題・同じ部品からは必ず同じ組になる）。
 * 訓練者の解答は「どの組か」を問わないので、UIはこの値を表示しない。
 */
export function faultGroupOf(problem: InspectPartsProblem, part: InspectPartData): number {
  if (part.group !== undefined) return part.group;
  const random = mulberry32(hashSeed(`${String(problem.seed)}:${part.id}`));
  return pickIndex(random, 4) + 1;
}

/** `truth` を §5.4 の故障に直す（正常品は undefined）。§7.5 */
export function truthFault(
  problem: InspectPartsProblem,
  part: InspectPartData,
): FaultSpecData | undefined {
  const coil = { partId: CHECK_PART_ID, elementIndex: SOCKET_COIL_ELEMENT_INDEX };
  switch (part.truth) {
    case 'normal':
      return undefined;
    case 'coil-open':
      return { target: coil, kind: 'coil-open' };
    case 'coil-layer-short':
      return {
        target: coil,
        kind: 'coil-layer-short',
        ...(part.ratio === undefined ? {} : { ratio: part.ratio }),
      };
    case 'a-open':
    case 'a-weld':
    case 'b-open':
    case 'b-weld': {
      const contact = part.truth.startsWith('a-') ? 'a' : 'b';
      const kind = part.truth.endsWith('-weld') ? 'contact-welded' : 'contact-open';
      return {
        target: {
          partId: CHECK_PART_ID,
          elementIndex: socketContactElementIndex(faultGroupOf(problem, part), contact),
        },
        kind,
      };
    }
  }
}

/** 点検用の回路（盤セッション＋故障注入済みネットリスト＋故障を入れた接点組）。 */
export interface CheckCircuit {
  session: BoardSession;
  netlist: Netlist;
  /** 接点の不良を入れた組（1〜4）。接点以外の `truth` でも値は決まる。 */
  group: number;
}

/** 構築結果（課題データの誤りは `ProblemIssue` で返す。§13 #2）。 */
export type CheckCircuitResult =
  { ok: true; value: CheckCircuit } | { ok: false; errors: ProblemIssue[] };

/**
 * トレイの部品1個をチェック用ソケットに挿した回路を作る。§9.1
 * 盤にはこの部品しか載らない（訓練者の配線は無く、既設のチェック用回路だけが繋がっている）。
 * 赤PB（PB4）を押すとコイルが励磁され、離すとコイル端子は母線から切り離される。
 */
export function buildCheckCircuit(
  problem: InspectPartsProblem,
  board: BoardDefinition,
  partId: string,
): CheckCircuitResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }
  const part = problem.parts.find((p) => p.id === partId);
  if (part === undefined) {
    return { ok: false, errors: [{ path: 'parts', message: `部品が見つかりません: ${partId}` }] };
  }
  const roles = toSocketRoles(problem.board.socketRoles);
  const session = createSession(board, { roles, inventory: [{ kind: part.kind, count: 1 }] });
  const mounted = plug(
    session,
    CHECK_SOCKET_ID,
    part.kind,
    part.kind === 'timer-h3y4'
      ? { presetMs: CHECK_TIMER_PRESET_MS, rangeMaxMs: DEFAULT_TIMER_RANGE.maxMs }
      : {},
  );
  if (!mounted.ok) {
    return { ok: false, errors: [{ path: 'parts', message: mounted.message }] };
  }
  /* c8 ignore next 7 -- 盤定義がチェック用ソケットを固定しているため到達しない(防御的チェック) */
  if (socketPartId(roles, CHECK_SOCKET_ID) !== CHECK_PART_ID) {
    return {
      ok: false,
      errors: [
        {
          path: 'board.socketRoles',
          message: `チェック用ソケットが ${CHECK_SOCKET_ID} にありません`,
        },
      ],
    };
  }
  const netlist = toNetlist(session, board);
  const fault = truthFault(problem, part);
  const issues = fault === undefined ? [] : injectPartFaults(netlist, [fault]);
  if (issues.length > 0) return { ok: false, errors: issues };
  return { ok: true, value: { session, netlist, group: faultGroupOf(problem, part) } };
}
