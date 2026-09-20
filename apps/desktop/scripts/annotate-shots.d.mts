export interface ShotCallout {
  n: number;
  label: string;
}

export interface Shot {
  caption: string;
  callouts: ShotCallout[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShotGeometry {
  crop?: Rect;
  callouts: Record<string, Rect>;
  /** 撮影のときに実測した「アプリの文字」の矩形（吹き出しを置いてはいけないところ）。 */
  avoid?: Rect[];
}

export interface Size {
  width: number;
  height: number;
}

/** 1つの吹き出しの置き方（枠・丸数字・ラベル。すべて切り出した窓の中の座標）。 */
export interface PlacedCallout {
  n: number;
  label: string;
  mark: string;
  box: Rect;
  badge: { x: number; y: number };
  badgeBox: Rect;
  labelBox: Rect;
  /** 丸数字がアプリの文字を隠している面積[px^2]（0 でなければ図が読めない）。 */
  badgeCovers: number;
  /** ラベルがアプリの文字を隠している面積[px^2]（同上）。 */
  labelCovers: number;
}

export interface CalloutPlan {
  crop: Rect;
  frame: { w: number; h: number };
  /** `avoid` を切り出した窓の中の座標へ直したもの（図の外のものは落としてある）。 */
  avoid: Rect[];
  marks: PlacedCallout[];
}

export declare const MARK_COLOR: string;
export declare const MARK_SIZE: number;
export declare function labelWidth(text: string): number;
export declare function planCallouts(shot: Shot, geometry: ShotGeometry, size: Size): CalloutPlan;
export declare function overlayHtml(
  imageUrl: string,
  shot: Shot,
  geometry: ShotGeometry,
  size: Size,
): string;
export declare function finishedSize(geometry: ShotGeometry, size: Size): Size;
