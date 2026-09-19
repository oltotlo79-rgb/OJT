import {
  createSession,
  JIPM_BOARD,
  SOCKET_PIN_COUNT,
  SOCKET_PIN_GRID,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import { cleanup, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 部品カードのピン配列の凡例。利用者要望 2026-09-20
 * 「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。設計仕様 §8.2。
 *
 * 図は `SOCKET_PIN_GRID`（実物の並び）から組み立てるので、番号の位置はここでも盤定義が決める。
 * 見る人に伝わるかを縛るのは「14個すべての番号が出ている」「段見出しの言葉が3か所で同じ」
 * 「役割の帯が重ならず、段4で ④ とコイルの色が切り替わる」「図が `viewBox` からはみ出さない」。
 */

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

/** CSS Modules は happy-dom では当たらないので、宣言そのものを読んで縛る（`ladder-layout.test.tsx` と同じ流儀）。 */
function readCss(rel: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/desktop')]) {
    const path = resolve(base, rel);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${rel} が見つからない（cwd: ${process.cwd()}）`);
}

/** コメントを落とす（注釈の中の数字まで拾わないように）。 */
const PINOUT_CSS = readCss('src/renderer/panels/pinout.module.css').replace(
  /\/\*[\s\S]*?\*\//gu,
  '',
);

const {
  SocketPinout,
  pinoutBands,
  pinoutColumnX,
  pinoutPinPos,
  pinoutRowY,
  pinsOfGroup,
  PINOUT_VIEW,
} = await import('../src/renderer/panels/SocketPinout.js');
const { PartsPanel } = await import('../src/renderer/panels/PartsPanel.js');
const { JA, JA_PIN, busSideMark, coilPolarityText, contactSetsText, pinGroupLabel } =
  await import('../src/renderer/i18n/ja.js');
const {
  CONTACT_SETS,
  COIL_PINS,
  COIL_N_PIN,
  COIL_P_PIN,
  PIN_GROUPS,
  PIN_GROUP_COLOR,
  coilBusSide,
  pinGroup,
  pinPartners,
} = await import('../src/renderer/session/socket-pins.js');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 盤セッション（既定の役割: S1=CR1 / S5=T1）。 */
function makeSession(): BoardSession {
  return createSession(JIPM_BOARD, {
    inventory: [{ kind: 'relay-my4n', count: 2 }],
  });
}

/** 図の中のネジ1個（`data-pin` で引く。凡例に目印用の `data-testid` は足さない）。 */
function pinCell(pin: number): Element {
  const cell = document.querySelector(`[data-pin="${String(pin)}"]`);
  if (cell === null) throw new Error(`ピン${String(pin)}が図にありません`);
  return cell;
}

/** 図そのもの（`role="img"` ＋ 代替テキストで引く）。 */
function pinoutFigure(): HTMLElement | null {
  return screen.queryByRole('img', { name: JA_PIN.legendAria });
}

/** 部品パネルを描く（ソケットを1つ選んだ状態にできる）。 */
function renderPanel(selectedSocket: SocketId | undefined): void {
  render(
    <PartsPanel
      session={makeSession()}
      selectedSocket={selectedSocket}
      powered={false}
      onSelectSocket={vi.fn()}
      onPlug={vi.fn()}
      onUnplug={vi.fn()}
      onSwap={vi.fn()}
      onPreset={vi.fn()}
    />,
  );
}

describe('ピンの大分類（`session/socket-pins.ts`）', () => {
  it('14ピンを b接点・a接点・COM・コイルの4つに漏れなく分ける', () => {
    const pins = Array.from({ length: SOCKET_PIN_COUNT }, (_, i) => i + 1);
    expect(pins.map(pinGroup)).toEqual([
      'nc',
      'nc',
      'nc',
      'nc',
      'no',
      'no',
      'no',
      'no',
      'com',
      'com',
      'com',
      'com',
      'coil',
      'coil',
    ]);
  });

  it('盤定義の `pinRole()` と同じ境目で切っている', () => {
    for (const terminal of JIPM_BOARD.terminals) {
      if (!terminal.id.startsWith('S1.')) continue;
      const pin = Number(terminal.id.split('.')[1]);
      const group = pinGroup(pin);
      const expected =
        terminal.role === 'coil+' || terminal.role === 'coil-' ? 'coil' : terminal.role;
      expect(group, terminal.id).toBe(expected);
    }
  });

  it('組になる相手は 1-5-9 / 2-6-10 / 3-7-11 / 4-8-12 とコイルの2本', () => {
    for (const [nc, no, com] of CONTACT_SETS) {
      expect(pinPartners(nc)).toEqual([com]);
      expect(pinPartners(no)).toEqual([com]);
      expect(pinPartners(com)).toEqual([nc, no]);
    }
    expect(pinPartners(COIL_PINS[0])).toEqual([COIL_PINS[1]]);
    expect(pinPartners(COIL_PINS[1])).toEqual([COIL_PINS[0]]);
  });

  it('範囲外のピン番号は例外にする（黙って丸めない）', () => {
    expect(() => pinGroup(0)).toThrow();
    expect(() => pinGroup(SOCKET_PIN_COUNT + 1)).toThrow();
    expect(() => pinGroup(1.5)).toThrow();
  });
});

describe('凡例の図（`SocketPinout`）', () => {
  it('14個の番号を実物と同じ位置に出す（空きスロットには番号を出さない）', () => {
    render(<SocketPinout />);
    SOCKET_PIN_GRID.forEach((row, rowIndex) => {
      row.forEach((pin, col) => {
        if (pin === undefined) return;
        const cell = pinCell(pin);
        const circle = cell.querySelector('circle');
        expect(circle?.getAttribute('cx'), `ピン${String(pin)}の列`).toBe(
          String(pinoutColumnX(col)),
        );
        expect(circle?.getAttribute('cy'), `ピン${String(pin)}の段`).toBe(
          String(pinoutRowY(rowIndex)),
        );
        expect(cell.textContent).toBe(String(pin));
      });
    });
    const drawn = SOCKET_PIN_GRID.flat().filter((pin) => pin !== undefined);
    expect(drawn).toHaveLength(SOCKET_PIN_COUNT);
  });

  it('ネジの縁の色は役割の色で、3か所で共有する表から取る', () => {
    render(<SocketPinout />);
    for (const pin of SOCKET_PIN_GRID.flat()) {
      if (pin === undefined) continue;
      const circle = pinCell(pin).querySelector('circle');
      expect(circle?.getAttribute('stroke'), `ピン${String(pin)}`).toBe(
        PIN_GROUP_COLOR[pinGroup(pin)],
      );
    }
  });

  it('段見出しは日本語の言葉とピン番号の範囲を出す（④ が b接点 だと分かる）', () => {
    render(<SocketPinout />);
    expect(screen.getByText(pinGroupLabel('nc', pinsOfGroup('nc')))).toBeInTheDocument();
    expect(pinGroupLabel('nc', pinsOfGroup('nc'))).toBe('b接点 1-4');
    expect(pinGroupLabel('no', pinsOfGroup('no'))).toBe('a接点 5-8');
    expect(pinGroupLabel('com', pinsOfGroup('com'))).toBe('COM 9-12');
    expect(pinGroupLabel('coil', pinsOfGroup('coil'))).toBe('コイル 13・14');
    for (const group of PIN_GROUPS) {
      expect(screen.getByText(pinGroupLabel(group, pinsOfGroup(group)))).toBeInTheDocument();
    }
  });

  it('接点の組の一行を出す', () => {
    render(<SocketPinout />);
    expect(screen.getByText('接点の組: 1-5-9 / 2-6-10 / 3-7-11 / 4-8-12')).toBeInTheDocument();
    expect(contactSetsText(CONTACT_SETS)).toContain(JA_PIN.pairs);
  });

  it('図には代替テキストが付いている（読み上げでも役割が分かる）', () => {
    render(<SocketPinout />);
    expect(screen.getByRole('img', { name: JA_PIN.legendAria })).toBeInTheDocument();
  });
});

describe('役割の帯（段ごとに色が変わる）', () => {
  it('段4は ④（b接点）とコイルで帯が切り替わり、重ならない', () => {
    const row = SOCKET_PIN_GRID[3];
    if (row === undefined) throw new Error('段4がありません');
    const bands = pinoutBands(row, 3);
    expect(bands.map((b) => b.group)).toEqual(['nc', 'coil']);
    const [first, second] = bands;
    if (first === undefined || second === undefined) throw new Error('帯が足りません');
    expect(first.x + first.w).toBeLessThan(second.x);
  });

  it('どの段でも帯は同じ役割のネジだけを覆う', () => {
    SOCKET_PIN_GRID.forEach((row, rowIndex) => {
      for (const band of pinoutBands(row, rowIndex)) {
        row.forEach((pin, col) => {
          if (pin === undefined) return;
          const x = pinoutColumnX(col);
          const covered = band.x <= x && x <= band.x + band.w;
          if (covered)
            expect(pinGroup(pin), `段${String(rowIndex)} ピン${String(pin)}`).toBe(band.group);
        });
      }
    });
  });

  it('帯は段どうしで重ならない（`viewBox` の中で上下に離れている）', () => {
    const bands = SOCKET_PIN_GRID.flatMap((row, rowIndex) => pinoutBands(row, rowIndex));
    for (const a of bands) {
      for (const b of bands) {
        if (a === b) continue;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        expect(overlapY && overlapX).toBe(false);
      }
      expect(a.y + a.h).toBeLessThanOrEqual(PINOUT_VIEW.h);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(PINOUT_VIEW.w);
    }
  });

  it('ネジの丸も `viewBox` に収まる', () => {
    render(<SocketPinout />);
    for (const pin of SOCKET_PIN_GRID.flat()) {
      if (pin === undefined) continue;
      const circle = pinCell(pin).querySelector('circle');
      const cx = Number(circle?.getAttribute('cx'));
      const cy = Number(circle?.getAttribute('cy'));
      const r = Number(circle?.getAttribute('r'));
      expect(cx - r).toBeGreaterThanOrEqual(0);
      expect(cx + r).toBeLessThanOrEqual(PINOUT_VIEW.w);
      expect(cy - r).toBeGreaterThanOrEqual(0);
      expect(cy + r).toBeLessThanOrEqual(PINOUT_VIEW.h);
    }
  });
});

/*
 * 利用者指摘 2026-09-20「リレーソケットの13、14番の端子にコイルとしか書いてないがこれでは
 * どちらがPかNか分からない」。
 */
describe('コイルの極性（⑭ = P(+) / ⑬ = N(−)）', () => {
  /** 図の中の極性の印（`data-polarity` で引く）。 */
  function polarityMark(pin: number): Element {
    const mark = document.querySelector(`[data-polarity="${String(pin)}"]`);
    if (mark === null) throw new Error(`ピン${String(pin)}の極性の印がありません`);
    return mark;
  }

  it('⑭ の下に `P(+)`、⑬ の下に `N(−)` を出す', () => {
    render(<SocketPinout />);
    expect(polarityMark(COIL_P_PIN).textContent).toBe(busSideMark(coilBusSide(COIL_P_PIN)));
    expect(polarityMark(COIL_N_PIN).textContent).toBe(busSideMark(coilBusSide(COIL_N_PIN)));
    expect(polarityMark(COIL_P_PIN).textContent).toBe(JA_PIN.bus.P);
    expect(polarityMark(COIL_N_PIN).textContent).toBe(JA_PIN.bus.N);
  });

  it('印はそのネジの真下に置き、`viewBox` の中に収まる', () => {
    render(<SocketPinout />);
    for (const pin of [COIL_P_PIN, COIL_N_PIN]) {
      const pos = pinoutPinPos(pin);
      expect(pos, `ピン${String(pin)}`).toBeDefined();
      const mark = polarityMark(pin);
      expect(Number(mark.getAttribute('x'))).toBe(pos?.x);
      expect(Number(mark.getAttribute('y'))).toBeGreaterThan(pos?.y ?? 0);
      expect(Number(mark.getAttribute('y'))).toBeLessThanOrEqual(PINOUT_VIEW.h);
    }
  });

  /*
   * UI監査バッチE（2026-09-20）: 印は 9px で描いていたため、図の拡大率
   * （`max-width: 216px` ÷ `viewBox` の 184 ＝ 1.17 倍）を掛けても画面上 10.6px にしかならず、
   * 「画面上 11px 未満の文字は作らない」というデザイン規則を3つの画面サイズすべてで
   * 外していた（`e2e/ui-quality.spec.ts` の `small-text` が 33 件）。番号と同じ 11px にする。
   */
  it('印の文字は番号と同じ 11px（画面上 11px 未満を作らない）', () => {
    expect(PINOUT_CSS).toMatch(/\.polarity\s*\{[^}]*font-size:\s*11px/u);
    expect(PINOUT_CSS).toMatch(/\.pinNumber\s*\{[^}]*font-size:\s*11px/u);
    // 図は `viewBox` の比のまま拡大され、縮むのは幅が 184px を切る画面だけ（部品カードは 216px）
    expect(PINOUT_CSS).toMatch(/max-width:\s*216px/u);
    expect(216 / PINOUT_VIEW.w).toBeGreaterThanOrEqual(1);
  });

  it('11px に上げた印が段4の帯にも `viewBox` の下端にもぶつからない', () => {
    render(<SocketPinout />);
    const row = SOCKET_PIN_GRID[3];
    if (row === undefined) throw new Error('段4がありません');
    const band = pinoutBands(row, 3).find((b) => b.group === 'coil');
    if (band === undefined) throw new Error('コイルの帯がありません');
    /** 印の文字の大きさ[`viewBox` 単位]（`pinout.module.css` の `.polarity`）。 */
    const fontPx = 11;
    /** 大文字の高さ・下げの目安（比率）。太字サンセリフの一般的な値で、余裕を見て大きめに取る。 */
    const capRatio = 0.75;
    const descentRatio = 0.25;
    for (const pin of [COIL_P_PIN, COIL_N_PIN]) {
      const baseline = Number(polarityMark(pin).getAttribute('y'));
      // 文字の上端が帯の下端より下にある（帯と印が重ならない）
      expect(baseline - fontPx * capRatio, `ピン${String(pin)}`).toBeGreaterThan(band.y + band.h);
      // 文字の下端が `viewBox` に収まる（カードの外へはみ出さない）
      expect(baseline + fontPx * descentRatio, `ピン${String(pin)}`).toBeLessThanOrEqual(
        PINOUT_VIEW.h,
      );
    }
  });

  it('極性の無いネジには印を出さない（番号だけを読む引き方も壊さない）', () => {
    render(<SocketPinout />);
    for (const pin of SOCKET_PIN_GRID.flat()) {
      if (pin === undefined || pinGroup(pin) === 'coil') continue;
      expect(document.querySelector(`[data-polarity="${String(pin)}"]`), String(pin)).toBeNull();
      expect(pinCell(pin).textContent).toBe(String(pin));
    }
  });

  it('図の下にもコイルの一行を出す（`コイル: 14 = P(+) / 13 = N(−)`）', () => {
    render(<SocketPinout />);
    expect(coilPolarityText(COIL_P_PIN, COIL_N_PIN)).toBe('コイル: 14 = P(+) / 13 = N(−)');
    expect(screen.getByText(coilPolarityText(COIL_P_PIN, COIL_N_PIN))).toBeInTheDocument();
  });

  it('読み上げの代替テキストにもどちらが P 側かを入れる', () => {
    render(<SocketPinout />);
    expect(JA_PIN.legendAria).toContain(JA_PIN.bus.P);
    expect(JA_PIN.legendAria).toContain(JA_PIN.bus.N);
    expect(screen.getByRole('img', { name: JA_PIN.legendAria })).toBeInTheDocument();
  });
});

describe('部品カードへの組み込み（既存のボタンを押しのけない）', () => {
  it('ソケットを選ぶと名前のすぐ下に図が出る', () => {
    renderPanel('S1');
    const card = screen.getByTestId('socket-card');
    const title = screen.getByTestId('socket-card-title');
    const pinout = pinoutFigure();
    expect(pinout).not.toBeNull();
    expect(card).toContainElement(pinout);
    // 見出し → 選択中の控え → 図 の順（名前の「下」に出す）
    expect(title.compareDocumentPosition(pinout!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(JA_PIN.legendTitle)).toBeInTheDocument();
  });

  it('何も選んでいなければ図は出ない', () => {
    renderPanel(undefined);
    expect(pinoutFigure()).toBeNull();
  });

  it('装着・取り外し・交換のボタンは図と別の行に残る', () => {
    renderPanel('S1');
    const mount = screen.getByTestId('mount-relay-my4n');
    expect(mount.textContent).toBe(JA.session.mount);
    const pinout = pinoutFigure();
    expect(pinout).not.toBeNull();
    expect(pinout?.contains(mount)).toBe(false);
    expect(mount.contains(pinout)).toBe(false);
  });
});
