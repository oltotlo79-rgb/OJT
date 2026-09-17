/**
 * 効果音。設計仕様 §15「WebAudio の合成音のみ（リレー動作音、テスターの導通ブザー、
 * 警告音）。音声ファイルを同梱しない」。
 *
 * 3種とも `OscillatorNode` をその場で作って鳴らし、鳴り終わったら捨てる（プールしない）。
 * 1回の発音は 35〜400ms と短く、同時発音も数個なので GC の負担にならない。
 */

/** 鳴らせる音の種別。§15 */
export type SoundKind =
  /** リレー／タイマの動作音（カチッ）。§8.2 */
  | 'relay'
  /** 危険操作・エラーの警告音（ピピッ）。§5.6 */
  | 'warning'
  /** ブザー（BZ 通電中／テスターの導通）。§5.3.4 / §5.5 */
  | 'buzzer';

/** 音の合成パラメータ（値はこのテーブル1箇所で調整する）。 */
export interface SoundSpec {
  /** 基本周波数[Hz]。 */
  hz: number;
  /** 長さ[ms]。 */
  durationMs: number;
  /** 波形。 */
  wave: OscillatorType;
  /** 全体音量に掛ける係数。 */
  gain: number;
  /** 2音目の周波数[Hz]（警告音の下降音）。0なら鳴らさない。 */
  secondHz: number;
}

/** 種別ごとの合成パラメータ。 */
export const SOUND_SPECS: Readonly<Record<SoundKind, SoundSpec>> = {
  // リレーの吸引音は短い打撃音。矩形波の極短音で代用する。
  relay: { hz: 1800, durationMs: 35, wave: 'square', gain: 0.35, secondHz: 0 },
  // 警告音は 880Hz → 660Hz の2音。
  warning: { hz: 880, durationMs: 140, wave: 'triangle', gain: 0.8, secondHz: 660 },
  // ブザーは 440Hz の矩形波を長めに。
  buzzer: { hz: 440, durationMs: 400, wave: 'square', gain: 0.6, secondHz: 0 },
};

/** 実際に掛ける音量（設定の音量 × 種別の係数。0〜1に収める）。 */
export function effectiveGain(spec: SoundSpec, volume: number): number {
  return Math.min(1, Math.max(0, volume)) * spec.gain;
}

/** 効果音プレイヤ。`AudioContext` は初回の再生時に1つだけ作る。 */
export class SoundPlayer {
  private context: AudioContext | undefined;
  private enabled = true;
  private volume = 0.5;

  /** 設定画面の値を反映する。§12.1 */
  configure(options: { enabled: boolean; volume: number }): void {
    this.enabled = options.enabled;
    this.volume = options.volume;
  }

  /** 鳴らす。無効化中・AudioContext が作れない環境では何もしない。 */
  play(kind: SoundKind): void {
    if (!this.enabled) return;
    const spec = SOUND_SPECS[kind];
    const gain = effectiveGain(spec, this.volume);
    if (gain <= 0) return;
    const context = this.ensureContext();
    if (context === undefined) return;
    const now = context.currentTime;
    const seconds = spec.durationMs / 1000;

    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    amp.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = spec.wave;
    oscillator.frequency.setValueAtTime(spec.hz, now);
    if (spec.secondHz > 0) {
      oscillator.frequency.setValueAtTime(spec.secondHz, now + seconds / 2);
    }
    oscillator.connect(amp);
    oscillator.start(now);
    oscillator.stop(now + seconds);
    oscillator.onended = () => {
      oscillator.disconnect();
      amp.disconnect();
    };
  }

  /** 使い終わったら閉じる。 */
  close(): void {
    void this.context?.close();
    this.context = undefined;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context !== undefined) return this.context;
    try {
      this.context = new AudioContext();
    } catch {
      // 音が出せない環境でも練習は続けられる
      this.context = undefined;
    }
    return this.context;
  }
}

/** アプリで1つだけ使うプレイヤ。 */
export const sounds = new SoundPlayer();

/** `soundsForSnapshot()` が見るスナップショットの部分型。 */
export interface SoundSnapshot {
  relays: Readonly<Record<string, { contactsOn: boolean }>>;
  timers: Readonly<Record<string, { timedOut: boolean }>>;
  lamps: Readonly<Record<string, { level: string }>>;
  hazardDelta: readonly unknown[];
  /** テスターの導通レンジがブザーを鳴らしているか。§5.5 / §15 */
  tester: { conductive: boolean };
}

/**
 * スナップショットの差分から鳴らす音を決める純粋関数。§8.2「動作音（WebAudio合成）」。
 * - リレー／タイマの接点が動いた tick → `relay`
 * - 危険操作が発行された → `warning`
 * - ブザー（BZ）が点灯した → `buzzer`
 */
export function soundsForSnapshot(
  previous: SoundSnapshot | undefined,
  next: SoundSnapshot,
): SoundKind[] {
  const out: SoundKind[] = [];
  if (previous !== undefined) {
    const relayMoved = Object.entries(next.relays).some(
      ([id, relay]) => previous.relays[id]?.contactsOn !== relay.contactsOn,
    );
    const timerMoved = Object.entries(next.timers).some(
      ([id, timer]) => previous.timers[id]?.timedOut !== timer.timedOut,
    );
    if (relayMoved || timerMoved) out.push('relay');
    if (previous.lamps['BZ']?.level !== 'lit' && next.lamps['BZ']?.level === 'lit') {
      out.push('buzzer');
    }
    // テスターの導通ブザー（§15）。鳴り始めた tick だけ鳴らす（導通が続く間ずっと鳴らさない）
    if (!previous.tester.conductive && next.tester.conductive) out.push('buzzer');
  }
  if (next.hazardDelta.length > 0) out.push('warning');
  return out;
}
