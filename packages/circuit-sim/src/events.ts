/** チャタリング判定の窓[ms]。§5.3.2 */
export const CHATTER_WINDOW_MS = 1000;
/**
 * チャタリング判定の遷移回数しきい値（この回数以上でチャタリング）。§5.3.2
 * 1秒間に20回以上の反転をチャタリングとみなす。最短の正規フリッカ（各タイマ休止100ms、周期200ms）は
 * 10回/秒なので2倍の余裕を取る。禁則回路は100回/秒で反転する。
 */
export const CHATTER_MIN_TRANSITIONS = 20;

/** 危険操作・保護動作の種別。§5.6 網羅は `HAZARD_KINDS` を参照。 */
export const HAZARD_KINDS = [
  /** 通電中（プローブ間電圧1V以上）にΩ／導通レンジを使った。§5.6 #1 */
  'ohm-on-live',
  /** 指示値がレンジ上限を超えた。§5.6 #2 */
  'range-exceeded',
  /** 短絡状態で通電し電源保護が動作した。§5.6 #3 */
  'short-circuit-power-on',
  /** 電源ON/OFFの手順違反。§5.6 #4 */
  'power-sequence-violation',
  /** 1端子に上限（2本）を超えて接続した。§5.6 #5 */
  'over-wires-per-terminal',
  /** 運転中の過電流で保護動作。 */
  'overcurrent',
] as const;

/** 危険操作・保護動作の種別。§5.6 */
export type HazardKind = (typeof HAZARD_KINDS)[number];

/** 危険操作イベント。§5.6 */
export interface HazardEvent {
  type: 'hazard';
  kind: HazardKind;
  /** 発生時刻[ms]（判定開始からの経過）。 */
  tMs: number;
  /** UI表示用の補足（端子ID・電流値など）。 */
  detail: string;
}

/** チャタリング検出イベント。§5.3.2 */
export interface ChatterEvent {
  type: 'chatter';
  /** チャタリングした信号名。 */
  signal: string;
  tMs: number;
  /** 直近1秒窓での遷移回数。 */
  count: number;
}

/** エンジンが発行するイベント。 */
export type SimEvent = HazardEvent | ChatterEvent;

/** イベント購読関数。 */
export type EventListener = (event: SimEvent) => void;

/** イベントの発行と購読。発行順は決定論的（登録順に同期呼び出し）。 */
export class EventBus {
  private readonly listeners: EventListener[] = [];
  private readonly recorded: SimEvent[] = [];

  /** 購読する。戻り値を呼ぶと解除される。 */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** 発行する。 */
  emit(event: SimEvent): void {
    this.recorded.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  /** これまでに発行された全イベント（コピー。戻り値への変更は内部状態に影響しない）。 */
  all(): readonly SimEvent[] {
    return [...this.recorded];
  }

  /** 指定種別の危険操作イベントだけを返す。 */
  hazards(kind?: HazardKind): HazardEvent[] {
    return this.recorded.filter(
      (e): e is HazardEvent => e.type === 'hazard' && (kind === undefined || e.kind === kind),
    );
  }

  /** チャタリングイベントだけを返す。 */
  chatters(signal?: string): ChatterEvent[] {
    return this.recorded.filter(
      (e): e is ChatterEvent =>
        e.type === 'chatter' && (signal === undefined || e.signal === signal),
    );
  }

  /** 指定種別の危険操作の発生回数。結果画面の「危険操作回数」に使う。§7.4 */
  countOf(kind: HazardKind): number {
    return this.hazards(kind).length;
  }

  /** 記録を消す。 */
  clear(): void {
    this.recorded.length = 0;
  }
}
