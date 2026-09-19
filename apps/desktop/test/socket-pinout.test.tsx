import {
  createSession,
  JIPM_BOARD,
  SOCKET_PIN_COUNT,
  SOCKET_PIN_GRID,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import { cleanup, render, screen } from '@testing-library/react';
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

const { SocketPinout, pinoutBands, pinoutColumnX, pinoutRowY, pinsOfGroup, PINOUT_VIEW } =
  await import('../src/renderer/panels/SocketPinout.js');
const { PartsPanel } = await import('../src/renderer/panels/PartsPanel.js');
const { JA, JA_PIN, contactSetsText, pinGroupLabel } = await import('../src/renderer/i18n/ja.js');
const { CONTACT_SETS, COIL_PINS, PIN_GROUPS, PIN_GROUP_COLOR, pinGroup, pinPartners } =
  await import('../src/renderer/session/socket-pins.js');

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
