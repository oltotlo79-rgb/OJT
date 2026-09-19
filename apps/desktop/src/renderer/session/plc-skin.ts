import { PLC_UNITS, type PlcUnitDefinition } from '@ojt/board-model';
import { resolvePlcIo, type PlcProblem } from '@ojt/content';
import {
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  type DialectId,
  type DialectProfile,
} from '@ojt/plc-dialects';

/**
 * スキン層（振る舞い）。設計仕様 §10.6 / §17.1。決定表#1
 *
 * 「メーカーによって変わる動き」の**唯一の持ち主**である。画面部品はここから引くだけにし、
 * キー文字列・色・列数・機種名を直書きしない。実機と違うと分かったときの修正箇所を
 * この1ファイルに保つため。見た目（配色・寸法）は `ladder/skins/*.ts` が持つ。
 *
 * React も three も import しない（純粋層）。
 */

/** ツールバーの項目を押したときの意味。§10.6 */
export type ToolbarAction =
  /** 変換（`convertStep: true` のスキンだけが持つ）。 */
  | 'convert'
  /** 全変換（本アプリでは `convert` と同じ）。 */
  | 'convert-all'
  /** 書込みモード（オンライン編集）。 */
  | 'write-mode'
  /** 読出しモード。 */
  | 'read-mode'
  /** オンライン（本アプリでは書込みと同じ。Plan 3B 意図的な差分 #2）。 */
  | 'online'
  /** PLCへの書込み・転送。 */
  | 'download'
  | 'monitor-start'
  | 'monitor-stop'
  /** 運転／停止の切換。 */
  | 'plc-run'
  /** 停止（PCwin風の `STP`）。 */
  | 'plc-stop'
  /** デバイス初期化（PCwin風の `RES`）。 */
  | 'plc-reset'
  /** 実機の操作パネルにはあるが本アプリでは動かない項目。決定表#4 */
  | 'vendor-only';

/**
 * 方言ID → ツールバーの項目の意味。**`profile.panels.toolbar` と同じ並び・同じ長さ**である。
 * 位置ではなくこの表で引くことで、項目数が方言ごとに違っても取り違えない（決定表#2）。
 *
 * 【本アプリの前提】PCwin風の `JP1` / `DGR` / `MOB` / `RDY` は実機の操作パネルの項目で、
 * 本アプリには対応する機能が無い（PLC調査資料 J-10 未確認）。`vendor-only` として淡色で出す。
 */
export const TOOLBAR_ACTIONS_BY_DIALECT: Readonly<Record<DialectId, readonly ToolbarAction[]>> = {
  // 変換／全変換／書込みモード／読出しモード／オンライン／シーケンサへの書込み／モニタ開始／モニタ停止
  mitsubishi: [
    'convert',
    'convert-all',
    'write-mode',
    'read-mode',
    'online',
    'download',
    'monitor-start',
    'monitor-stop',
  ],
  // JP1／DGR／MOB／STP／RDY／RUN／RES／モニタ開始／モニタ停止
  jtekt: [
    'vendor-only',
    'vendor-only',
    'vendor-only',
    'plc-stop',
    'vendor-only',
    'plc-run',
    'plc-reset',
    'monitor-start',
    'monitor-stop',
  ],
  // オンライン編集／転送［PC → PLC］／モニタ開始／モニタ停止／運転／停止
  omron: ['write-mode', 'download', 'monitor-start', 'monitor-stop', 'plc-run'],
  // 変換／PLCへの書込み／運転／停止／モニタ開始／モニタ停止
  sharp: ['convert', 'download', 'plc-run', 'monitor-start', 'monitor-stop'],
};

/** ツールバー1項目。 */
export interface ToolbarItem {
  action: ToolbarAction;
  label: string;
  /** `panels.toolbar` の位置（`data-testid` を一意にするために使う）。 */
  index: number;
}

/**
 * スキンのツールバー。`panels.toolbar`（文言）と `TOOLBAR_ACTIONS_BY_DIALECT`（意味）を
 * 突き合わせる。長さが合わないときは**足りない分を落とす**（表の取り違えで押せない項目を
 * 出すより、出さないほうが安全）。長さが合っていることは `test/plc-skin.test.ts` が見張る。
 */
export function toolbarItems(profile: DialectProfile): ToolbarItem[] {
  const actions = TOOLBAR_ACTIONS_BY_DIALECT[profile.id];
  return profile.panels.toolbar.flatMap((label, index) => {
    const action = actions[index];
    return action === undefined ? [] : [{ action, label, index }];
  });
}

/** 手順表の段。§10.6 の操作フロー */
export const PLC_STEP_KEYS = ['wire', 'ladder', 'convert', 'run', 'judge'] as const;
export type PlcStepKey = (typeof PLC_STEP_KEYS)[number];

/**
 * このスキンの手順。`convertStep: false`（CX-Programmer風・PCwin風）は
 * 「変換」という手順そのものが無い（§10.6）。決定表#3
 */
export function skinStepKeys(profile: DialectProfile): PlcStepKey[] {
  return PLC_STEP_KEYS.filter((key) => key !== 'convert' || profile.convertStep);
}

/**
 * ラダーが変わるたびに自動で変換するか。決定表#3
 * 「変換」ボタンが無いスキンでは、判定前に `convert()` を通す機会がここしかない（4A H-3）。
 */
export function autoConvert(profile: DialectProfile): boolean {
  return !profile.convertStep;
}

/**
 * ラダーの表示列数。設定値 `0` は「メーカーの既定に従う」。§10.6 / 決定表#8
 * 利用者が選んだ値は 8〜15 に丸める（`MIN_GRID_COLS` / `MAX_GRID_COLS`）。
 */
export function skinGridCols(profile: DialectProfile, setting: number): number {
  if (!Number.isFinite(setting) || setting <= 0) return profile.gridCols;
  return Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(setting)));
}

/** モニタ中の通電色。設定値が空文字なら方言の既定。§10.6 / 決定表#8 */
export function skinMonitorColor(profile: DialectProfile, setting: string): string {
  return setting.length > 0 ? setting : profile.monitorColors.powered;
}

/**
 * メーカー → 机上に置くPLC本体。§7.6
 * `@ojt/content` は `MODEL_OF_VENDOR`（メーカー→機種名の対応）を公開している（レビュー指摘
 * #10）が、ここで欲しいのは機種名ではなく本体定義（`PlcUnitDefinition`）そのものなので、
 * `PLC_UNITS` の `vendor` から直接引く（4A Task 12 が「メーカーと機種の組み合わせ違いは
 * 拒否する」ことを保証しているので、この引き方で取りこぼしは起きない）。
 */
export function plcUnitForVendor(vendor: DialectId): PlcUnitDefinition | undefined {
  return Object.values(PLC_UNITS).find((unit) => unit.vendor === vendor);
}

/**
 * 割付がこの機種に収まるか。決定表#10
 * CP1E は出力が12点しかないので、`y: 12` 以降を使う課題は開けない（4A 前提#23）。
 */
export function fitsPlcUnit(problem: PlcProblem, unit: PlcUnitDefinition): boolean {
  const io = resolvePlcIo(problem.io);
  return (
    io.inputs.every((input) => input.x < unit.spec.inputs.length) &&
    io.outputs.every((output) => output.y < unit.spec.outputs.length)
  );
}

/**
 * 課題を「このメーカーの機種で開く」形に直す。§7.6 / 決定表#9
 *
 * 内蔵モードD課題8題は機種に依らず成立する（4A 決定表#14 / Task 14）ので、既定メーカーを
 * 変えるだけで CP1E・TOYOPUC・JW300 の課題として開ける。割付が収まらない課題（利用者課題）は
 * `undefined` を返し、呼び出し側が元の機種のまま開いて理由を出す。
 *
 * 既にそのメーカーなら**同じオブジェクトを返す**（呼び出し側が差し替えの有無を `===` で見る）。
 */
export function plcForVendor(problem: PlcProblem, vendor: DialectId): PlcProblem | undefined {
  if (problem.plc.vendor === vendor) return problem;
  const unit = plcUnitForVendor(vendor);
  if (unit === undefined || !fitsPlcUnit(problem, unit)) return undefined;
  /*
   * `DialectId` と `@ojt/content` の `PLC_VENDORS` / `PLC_MODELS` は同じ4つの文字列だが
   * 別々に宣言されている。両者が揃っていることは `test/plc-skin.test.ts` の
   * 「finds one unit per vendor」が `SUPPORTED_PLC_MODELS` と突き合わせて見張る。
   */
  const plc = { vendor, model: unit.model } as PlcProblem['plc'];
  return { ...problem, plc };
}
