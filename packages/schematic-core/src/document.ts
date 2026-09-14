/**
 * 展開接続図の文書モデル。設計仕様 §11.1。
 * 向きは**横書き**固定（左母線が `P(+24V)`、右母線が `N(0V)`）。縦書きは表示だけの切替で、
 * 文書モデルは常に横書きで保持する。
 *
 * 構造はグリッド。**行＝段（ラング）**、**列＝段内の直列位置**。
 * 段は「始点 → 直列に並んだ要素 → 終点」の1本の経路で、始点・終点は母線か他の段の節点を指す。
 * 段どうしを結ぶこの参照が、縦線（分岐）と分岐点そのものになる。
 */

/** 文書形式のバージョン。§13 #8 */
export const SCHEMATIC_FORMAT_VERSION = 1;

/** 接点要素の種別。§11.1 */
export type ContactCellKind = 'pb-a' | 'pb-b' | 'cr-a' | 'cr-b' | 't-a' | 't-b';

/** 負荷要素の種別。§11.1 */
export type LoadCellKind = 'coil' | 'lamp' | 'buzzer';

/** 要素の種別。 */
export type CellKind = ContactCellKind | LoadCellKind;

/** 段の中の1要素。 */
export interface SchematicCell {
  kind: CellKind;
  /** 文書内で一意な要素ID（`physicalOverride` のキーにもなる。§7.2）。 */
  id: string;
  /** 機器名（`PB1`〜`PB4` / `CR1`〜`CR4` / `T1`・`T2` / `PL1`〜`PL4` / `BZ`）。§6.4 */
  device: string;
  /** タイマコイルの設定時間[ms]（`kind: 'coil'` かつ `device` が `Tn` のときだけ持つ）。§5.3.2 */
  presetMs?: number;
}

/** 段の端点。母線か、他の段の節点。 */
export type RungEnd = { bus: 'P' } | { bus: 'N' } | { rung: string; node: number };

/** 1段（ラング）。`cells` の並びがそのまま直列位置（列）になる。 */
export interface Rung {
  id: string;
  from: RungEnd;
  to: RungEnd;
  cells: SchematicCell[];
}

/** 展開接続図の文書。 */
export interface SchematicDocument {
  formatVersion: number;
  id: string;
  title: string;
  /** 既定かつ唯一の保持形式は横書き（左P・右N）。§11.1 */
  orientation: 'horizontal';
  rungs: Rung[];
}

/** 構造エラー1件。 */
export interface DocumentError {
  /** エラー箇所（`rungs[0].cells[2]` など）。 */
  path: string;
  message: string;
}

const DEVICE_PATTERNS: Readonly<Record<CellKind, RegExp>> = {
  'pb-a': /^PB[1-4]$/,
  'pb-b': /^PB[1-4]$/,
  'cr-a': /^CR[1-4]$/,
  'cr-b': /^CR[1-4]$/,
  't-a': /^T[12]$/,
  't-b': /^T[12]$/,
  coil: /^(CR[1-4]|T[12])$/,
  lamp: /^PL[1-4]$/,
  buzzer: /^BZ$/,
};

/** 負荷（コイル・ランプ・ブザー）の要素か。 */
export function isLoadCell(cell: SchematicCell): boolean {
  return cell.kind === 'coil' || cell.kind === 'lamp' || cell.kind === 'buzzer';
}

/** 接点の要素か。 */
export function isContactCell(cell: SchematicCell): boolean {
  return !isLoadCell(cell);
}

/** 段の節点数（要素数＋1）。節点0が `from`、節点 `cells.length` が `to`。 */
export function rungNodeCount(rung: Rung): number {
  return rung.cells.length + 1;
}

/** 押ボタンのa接点。 */
export function pbA(id: string, device: string): SchematicCell {
  return { kind: 'pb-a', id, device };
}
/** 押ボタンのb接点。 */
export function pbB(id: string, device: string): SchematicCell {
  return { kind: 'pb-b', id, device };
}
/** リレーのa接点。 */
export function crA(id: string, device: string): SchematicCell {
  return { kind: 'cr-a', id, device };
}
/** リレーのb接点。 */
export function crB(id: string, device: string): SchematicCell {
  return { kind: 'cr-b', id, device };
}
/** タイマの限時動作瞬時復帰a接点。§3.4 */
export function tA(id: string, device: string): SchematicCell {
  return { kind: 't-a', id, device };
}
/** タイマの限時動作瞬時復帰b接点。§3.4 */
export function tB(id: string, device: string): SchematicCell {
  return { kind: 't-b', id, device };
}
/** コイル（リレー／タイマ）。タイマは `presetMs` を持つ。 */
export function coil(id: string, device: string, presetMs?: number): SchematicCell {
  return presetMs === undefined
    ? { kind: 'coil', id, device }
    : { kind: 'coil', id, device, presetMs };
}
/** 表示灯。 */
export function lamp(id: string, device: string): SchematicCell {
  return { kind: 'lamp', id, device };
}
/** ブザー。 */
export function buzzer(id: string): SchematicCell {
  return { kind: 'buzzer', id, device: 'BZ' };
}

/** 文書を作る（`formatVersion` と `orientation` を埋める）。 */
export function createDocument(id: string, title: string, rungs: Rung[]): SchematicDocument {
  return { formatVersion: SCHEMATIC_FORMAT_VERSION, id, title, orientation: 'horizontal', rungs };
}

/** 段を作る。 */
export function rung(id: string, from: RungEnd, to: RungEnd, cells: SchematicCell[]): Rung {
  return { id, from, to, cells };
}

/** 左母線（P）。§11.1 */
export const BUS_P: RungEnd = { bus: 'P' };
/** 右母線（N）。§11.1 */
export const BUS_N: RungEnd = { bus: 'N' };

/** 他の段の節点を指す端点（分岐点）。 */
export function at(rungId: string, node: number): RungEnd {
  return { rung: rungId, node };
}

function checkEnd(
  doc: SchematicDocument,
  owner: Rung,
  end: RungEnd,
  path: string,
  errors: DocumentError[],
): void {
  if ('bus' in end) return;
  if (end.rung === owner.id) {
    errors.push({ path, message: `段が自分自身を参照しています: ${owner.id}` });
    return;
  }
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) {
    errors.push({ path, message: `参照先の段がありません: ${end.rung}` });
    return;
  }
  if (!Number.isInteger(end.node) || end.node < 0 || end.node >= rungNodeCount(target)) {
    errors.push({
      path,
      message: `参照先の節点番号が範囲外です: ${end.rung}#${end.node}（0〜${rungNodeCount(target) - 1}）`,
    });
  }
}

/**
 * 文書の構造エラーを列挙する（zodは使わない。§11.1 の範囲で十分なため）。
 * 空配列なら妥当。
 */
export function validateDocument(doc: SchematicDocument): DocumentError[] {
  const errors: DocumentError[] = [];
  if (doc.formatVersion !== SCHEMATIC_FORMAT_VERSION) {
    errors.push({
      path: 'formatVersion',
      message: `未知の文書バージョンです: ${doc.formatVersion}（対応は ${SCHEMATIC_FORMAT_VERSION}）`,
    });
  }
  if (doc.orientation !== 'horizontal') {
    errors.push({ path: 'orientation', message: '文書モデルは常に横書き（左P・右N）で保持します' });
  }
  if (doc.rungs.length === 0) {
    errors.push({ path: 'rungs', message: '段が1つもありません' });
  }

  const rungIds = new Set<string>();
  const cellIds = new Set<string>();
  doc.rungs.forEach((r, ri) => {
    const rungPath = `rungs[${ri}]`;
    if (rungIds.has(r.id))
      errors.push({ path: rungPath, message: `段IDが重複しています: ${r.id}` });
    rungIds.add(r.id);
    if (r.cells.length === 0)
      errors.push({ path: rungPath, message: `段に要素がありません: ${r.id}` });
    checkEnd(doc, r, r.from, `${rungPath}.from`, errors);
    checkEnd(doc, r, r.to, `${rungPath}.to`, errors);

    let loadCount = 0;
    r.cells.forEach((cell, ci) => {
      const cellPath = `${rungPath}.cells[${ci}]`;
      if (cellIds.has(cell.id)) {
        errors.push({ path: cellPath, message: `要素IDが重複しています: ${cell.id}` });
      }
      cellIds.add(cell.id);
      const pattern = DEVICE_PATTERNS[cell.kind];
      if (pattern === undefined) {
        errors.push({ path: cellPath, message: `未知の要素種別です: ${String(cell.kind)}` });
      } else if (!pattern.test(cell.device)) {
        errors.push({
          path: cellPath,
          message: `${cell.kind} に使えない機器名です: ${cell.device}`,
        });
      }
      if (cell.kind === 'coil' && cell.device.startsWith('T')) {
        if (cell.presetMs === undefined || cell.presetMs <= 0) {
          errors.push({
            path: cellPath,
            message: `タイマコイルには presetMs が必要です: ${cell.device}`,
          });
        }
      } else if (cell.presetMs !== undefined) {
        errors.push({
          path: cellPath,
          message: `presetMs を持てるのはタイマコイルだけです: ${cell.id}`,
        });
      }
      if (isLoadCell(cell)) loadCount += 1;
    });

    if (loadCount > 1) {
      errors.push({ path: rungPath, message: `1つの段に負荷は1つだけです: ${r.id}` });
    }
    const endsAtN = 'bus' in r.to && r.to.bus === 'N';
    const last = r.cells[r.cells.length - 1];
    if (endsAtN && (last === undefined || !isLoadCell(last))) {
      errors.push({
        path: rungPath,
        message: `右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: ${r.id}`,
      });
    }
    if (!endsAtN && loadCount > 0) {
      errors.push({
        path: rungPath,
        message: `分岐段（右母線に至らない段）に負荷は置けません: ${r.id}`,
      });
    }
  });

  return errors;
}

/** 文書に現れる機器名を初出順に返す。 */
export function documentDevices(doc: SchematicDocument): string[] {
  const out: string[] = [];
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      if (!out.includes(cell.device)) out.push(cell.device);
    }
  }
  return out;
}
