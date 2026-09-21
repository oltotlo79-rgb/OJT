import {
  boardTerminalPos,
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  toPhysicalTerminal,
  withPlcUnit,
} from '@ojt/board-model';
import type { BoardDefinition, PlcUnitDefinition, SocketRoles } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
// 型だけを借りる（実行時に `@playwright/test` を読み込まない。このモジュールは
// Vitest の `test/three-fidelity.test.tsx` からも import されるため）。
import type { Page } from '@playwright/test';
import {
  boardToWorld,
  CAMERA_FOV_DEG,
  cameraPose,
  type CameraPose,
} from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';

/**
 * 3D盤の端子をピクセル座標へ射影する（E2E用）。設計仕様 §12.2 / §14.2。
 * アプリ側の視点プリセット（`cameraPose`）と盤の傾き（`boardToWorld`）をそのまま参照するので、
 * カメラ設定や筐体の傾斜角を変えてもテストが追随する。
 */

/** キャンバスの矩形（Playwright の `boundingBox()` の戻り）。 */
export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Vec = readonly [number, number, number];

function sub(a: Vec, b: Vec): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec, b: Vec): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/** ワールド座標 → ページ座標（透視投影。カメラは -Z を向く three の規約に合わせる）。 */
export function projectToScreen(
  world: Vec,
  pose: CameraPose,
  box: CanvasBox,
): { x: number; y: number } {
  const forward = normalize(sub(pose.target, pose.position));
  const right = normalize(cross(forward, pose.up));
  const up = cross(right, forward);
  const relative = sub(world, pose.position);
  const depth = dot(relative, forward);
  const halfHeight = Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));
  const halfWidth = halfHeight * (box.width / box.height);
  const ndcX = dot(relative, right) / (depth * halfWidth);
  const ndcY = dot(relative, up) / (depth * halfHeight);
  return {
    x: box.x + ((ndcX + 1) / 2) * box.width,
    y: box.y + ((1 - ndcY) / 2) * box.height,
  };
}

/**
 * 3Dペインの実測の縦横比。**アプリと同じ値を `cameraPose()` へ渡す**ために使う。
 *
 * UI監査バッチA（`76a71af`）で `CameraPresets.tsx` が `useThree(s => s.size)` から実測した
 * 縦横比を `cameraPose()` へ渡すようになった（盤をペインいっぱいに収める）。E2E が縦横比を
 * 渡さないままだと、アプリは実測で寄った位置に、E2E は「16:10 の仮定」の位置に端子があると
 * 思い込み、**クリックが端子を外す**（Batch E: モードBの配線・モードDの配線が落ちていた）。
 * `state.size` はキャンバスの CSS ピクセル寸法なので、`boundingBox()` の幅・高さと一致する。
 */
function aspectOf(box: CanvasBox): number {
  return box.height > 0 ? box.width / box.height : 1.6;
}

/** 盤の**物理**端子IDの中心が来るページ座標（正面視プリセット前提）。 */
export function terminalPoint(terminal: TerminalId, box: CanvasBox): { x: number; y: number } {
  const world = boardToWorld(toScene(boardTerminalPos(JIPM_BOARD, terminal)));
  return projectToScreen(world, cameraPose('front', { aspect: aspectOf(box) }), box);
}

/**
 * 盤の**役割**端子ID（`CHK.13` / `CR1.9`）が来るページ座標（正面視プリセット前提）。
 * 3D盤は物理端子（`S7.13`）で描かれているので、割当表で直してから射影する（§6.4）。
 */
export function roleTerminalPoint(
  roles: SocketRoles,
  terminal: string,
  box: CanvasBox,
): { x: number; y: number } {
  return terminalPoint(toPhysicalTerminal(roles, terminal as TerminalId), box);
}

/** 盤ローカル座標（mm）を指定してページ座標を得る（ソケット台座の縁など）。 */
export function boardPoint(
  point: { x: number; y: number; z: number },
  box: CanvasBox,
): { x: number; y: number } {
  return projectToScreen(
    boardToWorld(toScene(point)),
    cameraPose('front', { aspect: aspectOf(box) }),
    box,
  );
}

/**
 * 押ボタン（PB1〜PB4）の頭が来るページ座標（正面視プリセット前提）。
 * `PushButton.tsx` は `definition.pos`（盤ローカル、z=0）に `group` を置き、押されていない
 * 頭（CAP）はその `group` の中で z=4.5mm に沈める。ここでも同じ高さを使う。
 */
export function pushButtonPoint(pbId: string, box: CanvasBox): { x: number; y: number } {
  const definition = JIPM_BOARD.pushButtons.find((pb) => pb.id === pbId);
  if (definition === undefined) throw new Error(`押ボタン ${pbId} が見つかりません`);
  return boardPoint({ x: definition.pos.x, y: definition.pos.y, z: 4.5 }, box);
}

/**
 * 内蔵課題 b-001「自己保持回路」の模範配線（9本）。
 * `buildReferenceSession()` が生成する配線と同じ組み合わせを、**物理**端子IDで書き下したもの。
 *
 * P/N 供給端子は `P.1` / `N.1` の各1点しかなく、うち1本はチェック用の固定配線が使うので、
 * 訓練者が母線から直接取れるのは各1本だけ（§6.1）。母線は**渡り配線**で分配する
 * （`P.1 → TB_PB.2c → S1.10`、`N.1 → S1.13 → TB_PL.1-` の鎖）。
 */
export const SELF_HOLD_WIRES: ReadonlyArray<readonly [string, string]> = [
  ['P.1', 'TB_PB.2c'],
  ['TB_PB.2c', 'S1.10'],
  ['TB_PB.2b', 'TB_PB.1c'],
  ['TB_PB.1c', 'S1.9'],
  ['TB_PB.1a', 'S1.14'],
  ['S1.14', 'S1.5'],
  ['N.1', 'S1.13'],
  ['S1.13', 'TB_PL.1-'],
  ['S1.6', 'TB_PL.1+'],
];

/**
 * PLC本体と壁コンセントを載せた盤（モードDのE2Eが使う）。§10.1
 * `boardTerminalPos()` は `JIPM_BOARD` しか知らず机上の端子を引けないので、モードDの端子は
 * この派生盤の `terminals` から直接探す。
 */
export const PLC_BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

/**
 * 盤ローカル座標（mm）を `plc` 視点で射影する（ソケット本体の中央など）。
 * `boardPoint()` は `front` 視点固定なので、モードDでは使えない（レビュー指摘 B10）。
 */
export function plcBoardPoint(
  point: { x: number; y: number; z: number },
  box: CanvasBox,
): { x: number; y: number } {
  return projectToScreen(
    boardToWorld(toScene(point)),
    cameraPose('plc', { aspect: aspectOf(box) }),
    box,
  );
}

/**
 * モードDの端子（盤・PLC本体・壁コンセントのどれでも）が来るページ座標。
 * モードDは `plc` 視点（盤＋PLC＋コンセント全体）で開くので、1つの画角で全部射影できる（決定表#6）。
 */
export function plcTerminalPoint(
  roles: SocketRoles,
  terminal: string,
  box: CanvasBox,
): { x: number; y: number } {
  const physical = toPhysicalTerminal(roles, terminal as TerminalId);
  const found = PLC_BOARD.terminals.find((t) => t.id === physical);
  if (found === undefined) throw new Error(`端子が盤にありません: ${terminal}（${physical}）`);
  return plcBoardPoint(found.pos, box);
}

/**
 * 機種を指定した机上の盤（Phase 4）。§10.1
 * 既定メーカーを変えると机上の本体が変わるので、E2Eも同じ機種で射影する必要がある。
 */
export function plcBoardFor(unit: PlcUnitDefinition): BoardDefinition {
  return withPlcUnit(JIPM_BOARD, unit);
}

/** 機種を指定した `plc` 視点の射影。 */
export function plcBoardPointFor(
  unit: PlcUnitDefinition,
  point: { x: number; y: number; z: number },
  box: CanvasBox,
): { x: number; y: number } {
  return projectToScreen(
    boardToWorld(toScene(point)),
    cameraPose('plc', { plcUnit: unit, aspect: aspectOf(box) }),
    box,
  );
}

/** 機種を指定した端子の射影（盤・PLC本体・壁コンセントのどれでも）。 */
export function plcTerminalPointFor(
  unit: PlcUnitDefinition,
  roles: SocketRoles,
  terminal: string,
  box: CanvasBox,
): { x: number; y: number } {
  const board = plcBoardFor(unit);
  const physical = toPhysicalTerminal(roles, terminal as TerminalId);
  const found = board.terminals.find((t) => t.id === physical);
  if (found === undefined) throw new Error(`端子が盤にありません: ${terminal}（${physical}）`);
  return plcBoardPointFor(unit, found.pos, box);
}

/* ------------------------------------------------------------------------- *
 * 画面操作の共有ヘルパ（2026-09-19 の UX 変更に合わせて追加。追記のみ）
 * ------------------------------------------------------------------------- */

/**
 * 状態オーバーレイの電線カウント（UXレビュー #21）。
 * `src/renderer/i18n/ja.ts` の `wireCountText()` と同じ文言を書き写したもの
 * （E2E は成果物を外から触るので `ja.ts` を読み込まない方針。`inspect.spec.ts` 冒頭の注記）。
 *
 * @param total 盤にある電線の総数（固定配線を含む）
 * @param fixed そのうち固定配線（`locked`）の本数
 */
export function wireCountText(total: number, fixed: number): string {
  return `自分で張った電線 ${String(Math.max(0, total - fixed))} 本（固定 ${String(fixed)} 本）`;
}

/**
 * ツールバーの「…」（`toolbar-overflow-toggle`）を開く。UXレビュー #17
 * 視点プリセット（正面／俯瞰／ソケット拡大）・作業ファイルの保存／読込・回路図の開閉は
 * 1行に収まらなくなったのでこの中へ畳まれた。開いていれば何もしない。
 */
export async function openOverflow(page: Page): Promise<void> {
  const panel = page.getByTestId('toolbar-overflow');
  if ((await panel.count()) === 0) {
    await page.getByTestId('toolbar-overflow-toggle').click();
  }
  await panel.waitFor({ state: 'visible' });
}

/**
 * 「…」を閉じる。開いたままだとパネル（`position: absolute`）が3Dビューポートの
 * 上端に被さり、盤の上側の端子やビューキューブのクリックを奪う。
 */
export async function closeOverflow(page: Page): Promise<void> {
  if (!(await page.getByTestId('toolbar-overflow-toggle').isVisible())) return;
  const panel = page.getByTestId('toolbar-overflow');
  if ((await panel.count()) > 0) {
    await page.getByTestId('toolbar-overflow-toggle').click();
    await panel.waitFor({ state: 'detached' });
  }
}

/** 「…」の中のボタンを名前で1つ押し、閉じるところまで面倒を見る。 */
export async function clickOverflowButton(page: Page, name: string): Promise<void> {
  await openOverflow(page);
  await page.getByTestId('toolbar-overflow').getByRole('button', { name, exact: true }).click();
  await closeOverflow(page);
}

/** 「…」の中の視点プリセットを押す（正面／俯瞰／ソケット拡大）。 */
export async function selectView(page: Page, label: string): Promise<void> {
  await clickOverflowButton(page, label);
}
