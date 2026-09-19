import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  roleLabel,
  SOCKET_BODY_WIDTH_MM,
  SOCKET_COL_PITCH_MM,
  SOCKET_PIN_GRID,
  SOCKET_TIER_ROW_PITCH_MM,
  socketPinHoleOffsets,
  socketPinTerminal,
  socketRowExit,
  vec3,
  type BoardTerminal,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { scenePos, toScene } from '../src/renderer/three/coords.js';
import {
  BOARD_TILT_RAD,
  boardToWorld,
  boardUp,
  CAMERA_FOV_DEG,
  cameraPose,
  interpolatePose,
  SOCKET_ROW_CENTER_MM,
  SOCKET_VIEW_ASPECT,
  SOCKET_VIEW_MARGIN_MM,
  SOCKET_VIEW_RECT,
  type CameraPose,
} from '../src/renderer/three/camera.js';
import { socketTerminalLabel } from '../src/renderer/three/Socket.js';
import { polarityTerminalLabel } from '../src/renderer/three/BoardScene.js';
import { mountedLabel } from '../src/renderer/three/MountedPart.js';
import { findFixtureFootprint, fixtureTerminalMark } from '../src/renderer/three/Fixtures.js';
import { secondsToMs } from '../src/renderer/panels/TimerDial.js';
import {
  GIZMO_COLORS,
  GIZMO_MARGIN,
  GIZMO_SIZE,
  GIZMO_TOP_MARGIN_PX,
} from '../src/renderer/three/ViewGizmo.js';
import {
  labelWidthMm,
  NUMBER_MM,
  ROLE_MM,
  socketLabelBoxes,
  SOCKET_PLATE_MARGIN_MM,
  SOCKET_ROLE_COLOR,
  TIER_CLEARANCE_MM,
  type LabelBox,
} from '../src/renderer/three/labels.js';
import { SOCKET_BODY_COLOR } from '../src/renderer/session/colors.js';
import { JA_PIN } from '../src/renderer/i18n/ja.js';

describe('toScene', () => {
  it('盤の中心が原点になる', () => {
    const [x, y, z] = toScene(vec3(BOARD_WIDTH_MM / 2, BOARD_HEIGHT_MM / 2, 0));
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
  });

  it('盤モデルの y（下向き）はシーンの −Y になる', () => {
    const [, y] = toScene(vec3(0, BOARD_HEIGHT_MM, 0));
    expect(y).toBe(-BOARD_HEIGHT_MM / 2);
  });

  it('scenePos は toScene と同じ結果になる', () => {
    expect(scenePos(10, 20, 5)).toEqual(toScene(vec3(10, 20, 5)));
  });
});

describe('盤の傾き（§6.5 傾斜コンソール）', () => {
  it('盤面の法線はほぼ真上を向き、少しだけ手前に倒れる', () => {
    const normal = boardToWorld([0, 0, 1]);
    expect(normal[1]).toBeGreaterThan(0.9);
    expect(normal[2]).toBeGreaterThan(0);
    expect(normal[2]).toBeLessThan(0.3);
  });

  it('盤の奥（盤ローカル +Y）は画面の奥へ倒れる', () => {
    const up = boardUp();
    expect(up[2]).toBeLessThan(-0.9);
  });

  it('傾斜角は盤定義の筐体形状（console.slopeDeg）から決まる', () => {
    expect(BOARD_TILT_RAD).toBeLessThan(0);
    expect(BOARD_TILT_RAD).toBeGreaterThan(-Math.PI / 2);
  });
});

describe('cameraPose', () => {
  it('正面視は盤面の法線方向から、盤の高さが視野38°に収まる距離で見る（§12.2）', () => {
    const pose = cameraPose('front');
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    const halfHeightAtDistance = distance * Math.tan((38 / 2) * (Math.PI / 180));
    expect(halfHeightAtDistance).toBeGreaterThan(BOARD_HEIGHT_MM / 2);
    // 視線は盤面の法線と平行（面直）
    expect(pose.position[1]).toBeGreaterThan(pose.target[1]);
  });

  it('俯瞰は実物写真と同じ左手前・上からの斜め視点になる', () => {
    const pose = cameraPose('top');
    expect(pose.position[0]).toBeLessThan(0);
    expect(pose.position[1]).toBeGreaterThan(0);
    expect(pose.position[2]).toBeGreaterThan(0);
    expect(pose.up).toEqual([0, 1, 0]);
  });

  it('ソケット拡大は面直のままソケット段に寄る', () => {
    const front = cameraPose('front');
    const socket = cameraPose('socket');
    const frontDistance = Math.hypot(
      front.position[0] - front.target[0],
      front.position[1] - front.target[1],
      front.position[2] - front.target[2],
    );
    const socketDistance = Math.hypot(
      socket.position[0] - socket.target[0],
      socket.position[1] - socket.target[1],
      socket.position[2] - socket.target[2],
    );
    expect(socketDistance).toBeLessThan(frontDistance);
    // 注視点はソケット段と端子台をあわせた矩形の中心（ソケット段の中心より手前に下がる）
    expect(socket.target).toEqual(
      boardToWorld([
        SOCKET_VIEW_RECT.x + SOCKET_VIEW_RECT.w / 2 - BOARD_WIDTH_MM / 2,
        BOARD_HEIGHT_MM / 2 - (SOCKET_VIEW_RECT.y + SOCKET_VIEW_RECT.h / 2),
        0,
      ]),
    );
    expect(SOCKET_VIEW_RECT.y + SOCKET_VIEW_RECT.h / 2).toBeGreaterThan(SOCKET_ROW_CENTER_MM);
  });
});

describe('ソケット拡大の画角（§12.2）', () => {
  it('画角の矩形はソケット8個と端子台をすべて余白つきで含む', () => {
    for (const socket of JIPM_BOARD.sockets) {
      expect(SOCKET_VIEW_RECT.x).toBeLessThanOrEqual(socket.origin.x - SOCKET_VIEW_MARGIN_MM);
      expect(SOCKET_VIEW_RECT.x + SOCKET_VIEW_RECT.w).toBeGreaterThanOrEqual(
        socket.origin.x + socket.bodyMm.width + SOCKET_VIEW_MARGIN_MM,
      );
      expect(SOCKET_VIEW_RECT.y).toBeLessThanOrEqual(socket.origin.y - SOCKET_VIEW_MARGIN_MM);
      expect(SOCKET_VIEW_RECT.y + SOCKET_VIEW_RECT.h).toBeGreaterThanOrEqual(
        socket.origin.y + socket.bodyMm.length + SOCKET_VIEW_MARGIN_MM,
      );
    }
    const blocks = JIPM_BOARD.footprints.filter((f) => f.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(SOCKET_VIEW_RECT.x).toBeLessThanOrEqual(block.x);
      expect(SOCKET_VIEW_RECT.x + SOCKET_VIEW_RECT.w).toBeGreaterThanOrEqual(block.x + block.w);
      expect(SOCKET_VIEW_RECT.y + SOCKET_VIEW_RECT.h).toBeGreaterThanOrEqual(block.y + block.h);
    }
  });

  it('1280×800（3D表示領域の縦横比 ≥ 1.5）でソケット8個も端子台も画面に入る', () => {
    const pose = cameraPose('socket');
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    const halfHeight = distance * Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));
    const halfWidth = halfHeight * SOCKET_VIEW_ASPECT;
    expect(halfWidth * 2).toBeGreaterThanOrEqual(SOCKET_VIEW_RECT.w - 1e-9);
    expect(halfHeight * 2).toBeGreaterThanOrEqual(SOCKET_VIEW_RECT.h - 1e-9);
  });
});

describe('ソケットの印字（§6.2 / §8.2）', () => {
  /** ソケット1個ぶんの印字の箱（板の左上を原点とする mm）。 */
  function boxesFor(socketIndex: number): Array<{ box: LabelBox; y: number; label: string }> {
    const socket = JIPM_BOARD.sockets[socketIndex];
    if (socket === undefined) throw new Error('ソケットが定義されていません');
    const originX = socket.origin.x - SOCKET_PLATE_MARGIN_MM;
    const originY = socket.origin.y - SOCKET_PLATE_MARGIN_MM;
    const out: Array<{ box: LabelBox; y: number; label: string }> = [];
    for (const terminal of JIPM_BOARD.terminals) {
      if (!terminal.id.startsWith(`${socket.id}.`)) continue;
      const boxes = socketLabelBoxes(terminal, originX, originY);
      out.push({ box: boxes.number, y: terminal.pos.y, label: `${terminal.label} 番号` });
      out.push({ box: boxes.role, y: terminal.pos.y, label: `${terminal.label} 役割` });
    }
    return out;
  }

  it('役割文字は段ピッチ 8mm に収まる大きさになっている', () => {
    expect(NUMBER_MM + ROLE_MM + TIER_CLEARANCE_MM).toBeLessThanOrEqual(
      SOCKET_TIER_ROW_PITCH_MM - 1e-9,
    );
  });

  it('どの印字も隣の段の印字と重ならない（`⑨ COM` が `⑬` に被らない）', () => {
    const boxes = boxesFor(0);
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.y === b.y) continue;
        const overlapY = a.box.y0 < b.box.y1 && b.box.y0 < a.box.y1;
        const overlapX = a.box.x0 < b.box.x1 && b.box.x0 < a.box.x1;
        expect(overlapY && overlapX, `${a.label} と ${b.label} が重なっています`).toBe(false);
      }
    }
  });

  it('どの印字も板からはみ出さない（外側の列の COM が切れない）', () => {
    const socket = JIPM_BOARD.sockets[0];
    if (socket === undefined) throw new Error('ソケットが定義されていません');
    const plateWidth = socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2;
    const plateLength = socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2;
    for (const { box, label } of boxesFor(0)) {
      expect(box.x0, `${label} が板の左端を越えています`).toBeGreaterThanOrEqual(0);
      expect(box.x1, `${label} が板の右端を越えています`).toBeLessThanOrEqual(plateWidth);
      expect(box.y0, `${label} が板の奥端を越えています`).toBeGreaterThanOrEqual(0);
      expect(box.y1, `${label} が板の手前端を越えています`).toBeLessThanOrEqual(plateLength);
    }
  });

  it('役割の印字は `COM` のまま短くしない（§12.2 の `⑨ COM`）', () => {
    expect(roleLabel('com')).toBe('COM');
    // 3文字ぶんの幅が板の余白に収まっている（切れないことの根拠）
    expect(labelWidthMm('COM', ROLE_MM) / 2).toBeLessThanOrEqual(
      SOCKET_PLATE_MARGIN_MM + (SOCKET_BODY_WIDTH_MM - 3 * SOCKET_COL_PITCH_MM) / 2,
    );
  });

  it('役割の印字色は黒いソケット本体の上で読める（コントラスト比 4.5 以上）', () => {
    for (const [role, color] of Object.entries(SOCKET_ROLE_COLOR)) {
      expect(contrastRatio(color, SOCKET_BODY_COLOR), role).toBeGreaterThanOrEqual(4.5);
    }
    // 極性は色でも区別する（§12.2）
    expect(SOCKET_ROLE_COLOR['+']).not.toBe(SOCKET_ROLE_COLOR['-']);
    expect(SOCKET_ROLE_COLOR['coil+']).not.toBe(SOCKET_ROLE_COLOR.com);
  });
});

describe('interpolatePose（視点プリセットとギズモの遷移で共有する補間）', () => {
  const from: CameraPose = { position: [0, 100, 0], target: [0, 0, 0], up: [0, 1, 0] };
  const to: CameraPose = { position: [50, 20, -30], target: [5, -5, 5], up: [0, 0, 1] };

  it('t = 0 は from に一致する', () => {
    expect(interpolatePose(from, to, 0)).toEqual(from);
  });

  it('t = 1 は to に一致する', () => {
    expect(interpolatePose(from, to, 1)).toEqual(to);
  });

  it('t が増えるほど position・target・up の各成分が from → to の向きに単調に変化する', () => {
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => interpolatePose(from, to, t));
    const pickers: Array<(pose: CameraPose) => number> = [
      (pose) => pose.position[0],
      (pose) => pose.position[1],
      (pose) => pose.position[2],
      (pose) => pose.target[0],
      (pose) => pose.target[1],
      (pose) => pose.target[2],
      (pose) => pose.up[0],
      (pose) => pose.up[1],
      (pose) => pose.up[2],
    ];
    for (const pick of pickers) {
      const values = samples.map(pick);
      const first = values[0];
      const last = values.at(-1);
      if (first === undefined || last === undefined) continue;
      const direction = Math.sign(last - first);
      for (let i = 1; i < values.length; i += 1) {
        const prev = values[i - 1];
        const next = values[i];
        if (prev === undefined || next === undefined) continue;
        const delta = next - prev;
        if (direction === 0) expect(delta).toBeCloseTo(0, 9);
        else if (direction > 0) expect(delta).toBeGreaterThanOrEqual(-1e-9);
        else expect(delta).toBeLessThanOrEqual(1e-9);
      }
    }
  });
});

describe('端子ラベル', () => {
  it('役割の印字は極性・接点種別の記号になる（§6.2）', () => {
    expect(roleLabel('coil+')).toBe('+');
    expect(roleLabel('coil-')).toBe('−');
    expect(roleLabel('com')).toBe('COM');
    expect(roleLabel('no')).toBe('a');
    expect(roleLabel('nc')).toBe('b');
  });

  /** ソケットの端子1個を引く。 */
  function socketTerminal(socketId: 'S1' | 'S5' | 'S7' | 'S8', pin: number): BoardTerminal {
    const terminal = JIPM_BOARD.terminals.find((t) => t.id === socketPinTerminal(socketId, pin));
    if (terminal === undefined) throw new Error(`${socketId}.${String(pin)} がありません`);
    return terminal;
  }

  /*
   * 利用者要望 2026-09-20「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
   * ツールチップは番号のほかに「何のネジか」と「どのピンと組か」を日本語で出す。
   */
  it('ツールチップはソケット・端子番号・部品・役割・組になる相手を出す（§8.2）', () => {
    expect(socketTerminalLabel('S1', 'CR1', undefined, socketTerminal('S1', 5))).toBe(
      'S1 端子5: CR1 の a接点（COM 9 と組）',
    );
  });

  it('部品が挿さっていれば型番まで出す', () => {
    expect(socketTerminalLabel('S1', 'CR1', 'relay-my4n', socketTerminal('S1', 5))).toBe(
      'S1 端子5: CR1 リレー MY4N の a接点（COM 9 と組）',
    );
    expect(socketTerminalLabel('S5', 'T1', 'timer-h3y4', socketTerminal('S5', 13))).toBe(
      'S5 端子13: T1 タイマ H3Y-4 の コイル N(−)側（14 と組）',
    );
  });

  it('COM は b接点・a接点の2本と組になることを出す', () => {
    expect(socketTerminalLabel('S1', 'CR1', undefined, socketTerminal('S1', 9))).toBe(
      'S1 端子9: CR1 の COM（b接点 1・a接点 5 と組）',
    );
  });

  it('同じ仲間どうしの組は役割名を繰り返さない（`コイル（コイル 14）` にしない）', () => {
    expect(socketTerminalLabel('S1', 'CR1', undefined, socketTerminal('S1', 14))).toBe(
      'S1 端子14: CR1 の コイル P(+)側（13 と組）',
    );
  });

  it('チェック用ソケットも同じ言葉で説明する（§6.3）', () => {
    expect(socketTerminalLabel('S7', 'CHK', undefined, socketTerminal('S7', 14))).toBe(
      'S7 端子14: CHK の コイル P(+)側（13 と組）',
    );
  });

  it('役割が割り当てられていない予備ソケットでも表示できる', () => {
    expect(socketTerminalLabel('S8', undefined, undefined, socketTerminal('S8', 13))).toBe(
      'S8 端子13: 予備 の コイル N(−)側（14 と組）',
    );
  });

  it('内部の役割記号（`nc` / `no` / `coil+`）をそのまま画面に出さない', () => {
    for (const pin of [1, 5, 9, 13, 14]) {
      const text = socketTerminalLabel('S1', 'CR1', 'relay-my4n', socketTerminal('S1', pin));
      expect(text, String(pin)).not.toMatch(/\b(nc|no|coil\+|coil-)\b/);
    }
  });

  /*
   * 利用者指摘 2026-09-20「リレーソケットの13、14番の端子にコイルとしか書いてないがこれでは
   * どちらがPかNか分からない。ランプも同様」。
   */
  it('コイルの⑭⑬は母線のどちら側かまで出す（`コイル` で終わらせない）', () => {
    const plus = socketTerminalLabel('S1', 'CR1', 'relay-my4n', socketTerminal('S1', 14));
    const minus = socketTerminalLabel('S1', 'CR1', 'relay-my4n', socketTerminal('S1', 13));
    expect(plus).toBe('S1 端子14: CR1 リレー MY4N の コイル P(+)側（13 と組）');
    expect(minus).toBe('S1 端子13: CR1 リレー MY4N の コイル N(−)側（14 と組）');
    // 極性を持たないピンには母線の印を付けない（`COM P(+)側` のような嘘を出さない）
    for (const pin of [1, 5, 9]) {
      const text = socketTerminalLabel('S1', 'CR1', 'relay-my4n', socketTerminal('S1', pin));
      expect(text, String(pin)).not.toContain(JA_PIN.bus.P);
      expect(text, String(pin)).not.toContain(JA_PIN.bus.N);
    }
  });

  it('ネジ端子は奥端・手前端の段付きティアに分かれる（§6.2）', () => {
    expect(socketRowExit(0)).toBe('rear');
    expect(socketRowExit(1)).toBe('rear');
    expect(socketRowExit(2)).toBe('front');
    expect(socketRowExit(3)).toBe('front');
  });

  it('差込穴は2列×7段で中央に並ぶ（§6.2）', () => {
    expect(socketPinHoleOffsets()).toHaveLength(14);
  });
});

describe('極性を持つ端子のツールチップ（利用者指摘 2026-09-20「ランプも同様」）', () => {
  /** 盤の端子1個を引く。 */
  function boardTerminal(id: string): BoardTerminal {
    const terminal = JIPM_BOARD.terminals.find((t) => t.id === id);
    if (terminal === undefined) throw new Error(`${id} がありません`);
    return terminal;
  }

  it('ランプ用端子台は色と銘板と母線の側を出す', () => {
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('TB_PL.1+'))).toBe(
      'TB_PL PL1+: 白ランプ PL1 の P(+)側',
    );
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('TB_PL.1-'))).toBe(
      'TB_PL PL1-: 白ランプ PL1 の N(−)側',
    );
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('TB_PL.4+'))).toBe(
      'TB_PL PL4+: 赤ランプ PL4 の P(+)側',
    );
  });

  it('ランプ本体とブザーにも同じ言葉を出す', () => {
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('PL2.+'))).toBe(
      'PL2+: 黄ランプ PL2 の P(+)側',
    );
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('BZ.-'))).toBe(
      'BZ-: ブザー BZ の N(−)側',
    );
  });

  it('母線を名乗っている端子と極性の無い端子には出さない', () => {
    // `P1` / `N1` は名前そのものが母線。押ボタンは c/a/b で極性が無い
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('P.1'))).toBeUndefined();
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('N.1'))).toBeUndefined();
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('PS.+'))).toBeUndefined();
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('TB_PB.1c'))).toBeUndefined();
    expect(polarityTerminalLabel(JIPM_BOARD, boardTerminal('S1.9'))).toBeUndefined();
  });
});

describe('固定機器（PS/CB/SW）の外形と端子印字（§12.2 端子ラベル）', () => {
  it('footprint は board.footprints から kind で引ける', () => {
    expect(findFixtureFootprint(JIPM_BOARD.footprints, 'supply')?.id).toBe('supply');
    expect(findFixtureFootprint(JIPM_BOARD.footprints, 'breaker')?.id).toBe('CB');
    expect(findFixtureFootprint(JIPM_BOARD.footprints, 'switch')?.id).toBe('SW');
  });

  it('一致する footprint が無ければ undefined', () => {
    expect(findFixtureFootprint([], 'supply')).toBeUndefined();
  });

  it('端子の印字は label から機器プレフィックスを除いた文字列になる', () => {
    const byLabel = (label: string): BoardTerminal => {
      const terminal = JIPM_BOARD.terminals.find((t) => t.label === label);
      if (terminal === undefined) throw new Error(`fixture terminal not found: ${label}`);
      return terminal;
    };
    expect(fixtureTerminalMark(byLabel('PS +24V'))).toBe('+24V');
    expect(fixtureTerminalMark(byLabel('PS 0V'))).toBe('0V');
    expect(fixtureTerminalMark(byLabel('CB 1'))).toBe('1');
    expect(fixtureTerminalMark(byLabel('CB 2'))).toBe('2');
    expect(fixtureTerminalMark(byLabel('SW 1'))).toBe('1');
    expect(fixtureTerminalMark(byLabel('SW 2'))).toBe('2');
  });
});

describe('装着部品のラベル', () => {
  it('リレーは役割ID、タイマは設定秒を添える', () => {
    expect(mountedLabel('CR1', { kind: 'relay-my4n' })).toBe('CR1');
    expect(mountedLabel('T1', { kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 })).toBe(
      'T1 3.0s',
    );
  });
});

describe('盤の定義から描くこと', () => {
  it('ソケット・PL・PB・既設配線はすべて盤定義から取れる（数をハードコードしない根拠）', () => {
    expect(JIPM_BOARD.sockets.length).toBeGreaterThan(0);
    expect(JIPM_BOARD.lamps).toHaveLength(4);
    expect(JIPM_BOARD.pushButtons).toHaveLength(4);
    expect(JIPM_BOARD.fixedLinks.length).toBeGreaterThan(0);
    expect(JIPM_BOARD.console.rearHeightMm).toBeGreaterThan(JIPM_BOARD.console.frontHeightMm);
    expect(JIPM_BOARD.sockets.filter((s) => s.cluster === 'left')).toHaveLength(4);
    expect(JIPM_BOARD.sockets.filter((s) => s.cluster === 'right')).toHaveLength(4);
  });

  it('ソケットのピン配置は4段・各段4列で ④ が段4に混ざる（§6.2）', () => {
    expect(SOCKET_PIN_GRID).toHaveLength(4);
    expect(SOCKET_PIN_GRID[3]?.[0]).toBe(4);
  });
});

describe('secondsToMs', () => {
  it('10ms単位に丸める', () => {
    expect(secondsToMs(3.04)).toBe(3040);
    expect(secondsToMs(0.1)).toBe(100);
  });
});

describe('視点ギズモの置き場所と色（§12.2）', () => {
  it('キューブの上端はビューポートの上端から余白ぶん下にある', () => {
    // `margin` はキューブの中心位置なので、上端は 中心 − 半分
    const top = GIZMO_MARGIN[1] - GIZMO_SIZE / 2;
    expect(top).toBeGreaterThanOrEqual(GIZMO_TOP_MARGIN_PX);
  });

  it('面・稜線・ホバーの色が互いに違う（どの面を指しているか分かる）', () => {
    const used = new Set([GIZMO_COLORS.face, GIZMO_COLORS.stroke, GIZMO_COLORS.hover]);
    expect(used.size).toBe(3);
    expect(GIZMO_COLORS.text).not.toBe(GIZMO_COLORS.face);
  });

  it('面の色は明るい盤（#E6E4DE）の上でも文字が読める暗さで、文字とのコントラスト比が 4.5 以上', () => {
    expect(contrastRatio(GIZMO_COLORS.face, GIZMO_COLORS.text)).toBeGreaterThanOrEqual(4.5);
    // 盤の色に溶けない（正面視でキューブが盤に重なっても輪郭が分かる）
    expect(contrastRatio(GIZMO_COLORS.face, '#E6E4DE')).toBeGreaterThanOrEqual(3);
  });
});

/** `#RRGGBB` の相対輝度（WCAG 2.x）。 */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** 2色のコントラスト比（WCAG 2.x）。 */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
