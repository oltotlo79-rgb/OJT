import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effectiveGain,
  SOUND_SPECS,
  SoundPlayer,
  soundsForSnapshot,
  type SoundSnapshot,
} from '../src/renderer/audio/sounds.js';

/**
 * 効果音のテスト。設計仕様 §15「WebAudio の合成音のみ（リレー動作音、テスターの導通ブザー、
 * 警告音）。音声ファイルを同梱しない」。
 *
 * `soundsForSnapshot()` は「いつ何の音を鳴らすか」を決める純粋関数なので Vitest で直接検証できる。
 * `SoundPlayer` は `AudioContext` を触る唯一のクラスなので、偽の `AudioContext` を差し込んで
 * 配線（`createOscillator` / `createGain` / `start`）だけを確かめる。
 */

function snapshot(partial: Partial<SoundSnapshot> = {}): SoundSnapshot {
  return {
    relays: {},
    timers: {},
    lamps: {},
    hazardDelta: [],
    tester: { conductive: false },
    ...partial,
  };
}

describe('soundsForSnapshot', () => {
  it('初回（previous が無い）はリレー・ブザー音を鳴らさない', () => {
    expect(soundsForSnapshot(undefined, snapshot())).toEqual([]);
  });

  it('リレーの接点が動いたら relay を鳴らす（§8.2）', () => {
    const previous = snapshot({ relays: { CR1: { contactsOn: false } } });
    const next = snapshot({ relays: { CR1: { contactsOn: true } } });
    expect(soundsForSnapshot(previous, next)).toEqual(['relay']);
  });

  it('接点が動かなければ relay を鳴らさない', () => {
    const previous = snapshot({ relays: { CR1: { contactsOn: true } } });
    const next = snapshot({ relays: { CR1: { contactsOn: true } } });
    expect(soundsForSnapshot(previous, next)).toEqual([]);
  });

  it('タイマがタイムアウトしたら relay を鳴らす', () => {
    const previous = snapshot({ timers: { T1: { timedOut: false } } });
    const next = snapshot({ timers: { T1: { timedOut: true } } });
    expect(soundsForSnapshot(previous, next)).toEqual(['relay']);
  });

  it('BZ ランプが lit になったら buzzer を鳴らす（§5.3.4 / §5.5）', () => {
    const previous = snapshot({ lamps: { BZ: { level: 'off' } } });
    const next = snapshot({ lamps: { BZ: { level: 'lit' } } });
    expect(soundsForSnapshot(previous, next)).toEqual(['buzzer']);
  });

  it('BZ が既に lit なら鳴らし続けない', () => {
    const previous = snapshot({ lamps: { BZ: { level: 'lit' } } });
    const next = snapshot({ lamps: { BZ: { level: 'lit' } } });
    expect(soundsForSnapshot(previous, next)).toEqual([]);
  });

  it('テスターの導通が始まったら buzzer を鳴らす（§5.5 / §15）', () => {
    const previous = snapshot({ tester: { conductive: false } });
    const next = snapshot({ tester: { conductive: true } });
    expect(soundsForSnapshot(previous, next)).toEqual(['buzzer']);
  });

  it('導通が続いている間は鳴らし続けない', () => {
    const previous = snapshot({ tester: { conductive: true } });
    const next = snapshot({ tester: { conductive: true } });
    expect(soundsForSnapshot(previous, next)).toEqual([]);
  });

  it('BZ点灯とテスター導通開始が同一tickで重なっても buzzer は1回だけ（二重ブザーのレビュー指摘）', () => {
    const previous = snapshot({
      lamps: { BZ: { level: 'off' } },
      tester: { conductive: false },
    });
    const next = snapshot({
      lamps: { BZ: { level: 'lit' } },
      tester: { conductive: true },
    });
    const result = soundsForSnapshot(previous, next);
    expect(result.filter((k) => k === 'buzzer')).toHaveLength(1);
    expect(result).toEqual(['buzzer']);
  });

  it('危険操作が出たら previous の有無に関わらず warning を鳴らす（§5.6）', () => {
    expect(soundsForSnapshot(undefined, snapshot({ hazardDelta: [{}] }))).toEqual(['warning']);
  });

  it('接点変化とブザー点灯と危険操作が同時なら3つとも順番どおりに鳴らす', () => {
    const previous = snapshot({
      relays: { CR1: { contactsOn: false } },
      lamps: { BZ: { level: 'off' } },
    });
    const next = snapshot({
      relays: { CR1: { contactsOn: true } },
      lamps: { BZ: { level: 'lit' } },
      hazardDelta: [{}],
    });
    expect(soundsForSnapshot(previous, next)).toEqual(['relay', 'buzzer', 'warning']);
  });
});

describe('effectiveGain', () => {
  it('音量と種別の係数を掛ける', () => {
    expect(effectiveGain(SOUND_SPECS.relay, 0.5)).toBeCloseTo(0.175);
  });

  it('音量は0〜1に丸める', () => {
    expect(effectiveGain(SOUND_SPECS.buzzer, 2)).toBeCloseTo(SOUND_SPECS.buzzer.gain);
    expect(effectiveGain(SOUND_SPECS.buzzer, -1)).toBe(0);
  });
});

/**
 * テスト用の偽 `AudioContext`。配線（生成順・接続・開始）だけを記録する。
 * `vi.fn()` はファクトリ関数が返したオブジェクトをそのまま `new` の結果にするので、
 * クラスのフィールド初期化子（prototype に乗らない）を避けてこの形にする。
 */
function fakeParam(): {
  setValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
} {
  return { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}
function fakeGainNode() {
  return { gain: fakeParam(), connect: vi.fn(), disconnect: vi.fn() };
}
function fakeOscillatorNode() {
  return {
    type: '',
    frequency: fakeParam(),
    onended: null as (() => void) | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
}
function fakeAudioContext() {
  return {
    currentTime: 0,
    destination: {},
    createGain: vi.fn(fakeGainNode),
    createOscillator: vi.fn(fakeOscillatorNode),
    state: 'suspended',
    resume: vi.fn(() => Promise.resolve()),
  };
}

describe('SoundPlayer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AudioContext が無い環境でも投げない（§15）', () => {
    vi.stubGlobal('AudioContext', undefined);
    const player = new SoundPlayer();
    expect(() => {
      player.play('relay');
    }).not.toThrow();
  });

  it('resume() を呼んでも AudioContext が無ければ投げない', () => {
    vi.stubGlobal('AudioContext', undefined);
    const player = new SoundPlayer();
    expect(() => {
      player.resume();
    }).not.toThrow();
  });

  it('AudioContext の生成が例外を投げても play() は投げずに黙る', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('この環境では音が出せません');
        }
      },
    );
    const player = new SoundPlayer();
    expect(() => {
      player.play('warning');
    }).not.toThrow();
  });

  describe('偽の AudioContext がある環境', () => {
    let ctor: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      ctor = vi.fn(fakeAudioContext);
      vi.stubGlobal('AudioContext', ctor);
    });

    function lastOscillator(): ReturnType<typeof fakeOscillatorNode> {
      const context = ctor.mock.results[0]?.value as ReturnType<typeof fakeAudioContext>;
      const oscillator = context.createOscillator.mock.results[0]?.value as ReturnType<
        typeof fakeOscillatorNode
      >;
      return oscillator;
    }

    it('既定（enabled: true, volume: 0.5）で play() すると発振器を1つ作って鳴らす', () => {
      const player = new SoundPlayer();
      player.play('relay');
      const oscillator = lastOscillator();
      expect(oscillator.type).toBe(SOUND_SPECS.relay.wave);
      expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(SOUND_SPECS.relay.hz, 0);
      expect(oscillator.start).toHaveBeenCalledTimes(1);
      expect(oscillator.stop).toHaveBeenCalledTimes(1);
    });

    it('2音目（secondHz）を持つ warning は途中で周波数を変える', () => {
      const player = new SoundPlayer();
      player.play('warning');
      const oscillator = lastOscillator();
      expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledTimes(2);
      expect(oscillator.frequency.setValueAtTime).toHaveBeenNthCalledWith(
        2,
        SOUND_SPECS.warning.secondHz,
        SOUND_SPECS.warning.durationMs / 1000 / 2,
      );
    });

    it('2音目を持たない relay / buzzer は周波数を1回だけ設定する', () => {
      const player = new SoundPlayer();
      player.play('buzzer');
      expect(lastOscillator().frequency.setValueAtTime).toHaveBeenCalledTimes(1);
    });

    it('鳴り終わったら oscillator と amp を切り離す', () => {
      const player = new SoundPlayer();
      player.play('relay');
      const oscillator = lastOscillator();
      const context = ctor.mock.results[0]?.value as ReturnType<typeof fakeAudioContext>;
      const amp = context.createGain.mock.results[0]?.value as ReturnType<typeof fakeGainNode>;
      expect(oscillator.disconnect).not.toHaveBeenCalled();
      oscillator.onended?.();
      expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
      expect(amp.disconnect).toHaveBeenCalledTimes(1);
    });

    it('configure({enabled: false}) なら鳴らさない', () => {
      const player = new SoundPlayer();
      player.configure({ enabled: false, volume: 1 });
      player.play('buzzer');
      expect(ctor).not.toHaveBeenCalled();
    });

    it('configure({volume: 0}) なら AudioContext を作らずに鳴らさない', () => {
      const player = new SoundPlayer();
      player.configure({ enabled: true, volume: 0 });
      player.play('buzzer');
      expect(ctor).not.toHaveBeenCalled();
    });

    it('AudioContext は一度だけ作る（複数回の play() で使い回す）', () => {
      const player = new SoundPlayer();
      player.play('relay');
      player.play('buzzer');
      expect(ctor).toHaveBeenCalledTimes(1);
    });

    it('最初のジェスチャで待機中のAudioContextを再開し使い回す', () => {
      const player = new SoundPlayer();
      player.play('relay');
      player.resume();
      player.play('relay');
      expect(ctor).toHaveBeenCalledTimes(1);
      const context = ctor.mock.results[0]?.value as ReturnType<typeof fakeAudioContext>;
      expect(context.resume).toHaveBeenCalledTimes(1);
    });
  });
});
