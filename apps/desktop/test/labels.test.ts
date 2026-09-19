import { describe, expect, it } from 'vitest';
import { partKindLabel, reportTargetLabel, trayPartLabel, wireLabel } from '../src/renderer/i18n/ja.js';

/**
 * 表示名の組み立て（UXレビュー #6: 内部IDをそのまま画面に出さない）。
 * `p1` のような内部の部品ID・`sw-005` のような電線ID・`relay-my4n` のような内部種別を、
 * 番号付きの型番表示や端子＋色の説明に変えることを確かめる。
 */
describe('trayPartLabel（#6a: 部品トレイ・マークシート・結果画面）', () => {
  it('IDの末尾の連番を丸数字にし、型番まで出す', () => {
    expect(trayPartLabel('p1', false)).toBe('①リレー MY4N');
    expect(trayPartLabel('p2', true)).toBe('②タイマ H3Y-4');
    expect(trayPartLabel('p10', false)).toBe('⑩リレー MY4N');
  });

  it('連番の無いIDは番号なしで型番だけ出す', () => {
    expect(trayPartLabel('phantom', false)).toBe('リレー MY4N');
  });

  it('内部ID（p1）をそのまま含まない', () => {
    expect(trayPartLabel('p1', false)).not.toContain('p1');
  });
});

describe('partKindLabel（#6c: 操作ログの部品種別）', () => {
  it('内部種別をそのまま出さず、型番で示す', () => {
    expect(partKindLabel('relay-my4n')).not.toContain('relay-my4n');
    expect(partKindLabel('relay-my4n')).toContain('MY4N');
    expect(partKindLabel('timer-h3y4')).not.toContain('timer-h3y4');
    expect(partKindLabel('timer-h3y4')).toContain('H3Y-4');
  });
});

describe('wireLabel（#6b: 電線の表示）', () => {
  it('両端の端子と色から組み立てる', () => {
    expect(wireLabel({ from: 'CR1.9', to: 'PB1.2c', color: '青' })).toBe('CR1.9–PB1.2c の青線');
  });
});

describe('reportTargetLabel（#6b: 指摘対象の表示）', () => {
  const wires = [{ id: 'sw-005', from: 'CR1.9', to: 'PB1.2c', color: '青' }];

  it('電線一覧が渡され見つかれば、端子と色で示し内部IDを出さない', () => {
    const label = reportTargetLabel({ wireId: 'sw-005' }, wires);
    expect(label).not.toContain('sw-005');
    expect(label).toContain('CR1.9');
    expect(label).toContain('PB1.2c');
    expect(label).toContain('青');
  });

  it('電線一覧が無い・見つからないときは電線IDへ後退する（互換性）', () => {
    expect(reportTargetLabel({ wireId: 'sw-005' })).toContain('sw-005');
    expect(reportTargetLabel({ wireId: 'sw-999' }, wires)).toContain('sw-999');
  });

  it('端子・部品の対象はこれまでどおり', () => {
    expect(reportTargetLabel({ terminalId: 'CR1.13' })).toContain('CR1.13');
    expect(reportTargetLabel({ partId: 'CR2' })).toContain('CR2');
  });
});
