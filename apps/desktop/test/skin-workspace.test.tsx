import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import {
  COIL_COL,
  empty,
  endNetwork,
  hline,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import {
  getDialect,
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
} from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { SKIN_THEMES } from '../src/renderer/ladder/skins/index.js';
import { toolbarItems } from '../src/renderer/session/plc-skin.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  /*
   * 通電色は「メーカーの既定に従う」（空文字）にしておく。既定値そのものを `''` に変えるのは
   * Task 6（設定画面）の仕事で、いまの既定は旧値 `#1E64FF` のままである（決定表#8）。
   */
  useStore.setState({ monitorColor: '' });
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

function workspace(profile = MITSUBISHI_FX5U, onPlc = vi.fn()): typeof onPlc {
  render(<LadderWorkspace problem={problem} profile={profile} gridCols={11} onPlc={onPlc} />);
  return onPlc;
}

describe('スキンごとのツールバー（§10.6 / §16 Phase 4 受入基準①）', () => {
  /**
   * UI監査 2026-09-20 Important #9: `vendor-only`（押しても何も起きない実機だけの項目。
   * 決定表#4）はもう出さない。出るのは実際に動く項目の分だけ、スキンが名乗る順のまま。
   */
  it('draws exactly the labels the skin names, minus the vendor-only decorations, in order', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      const expectedLabels = toolbarItems(profile)
        .filter((item) => item.action !== 'vendor-only')
        .map((item) => item.label);
      const labels = screen
        .getAllByTestId(/^toolbar-/u)
        .map((button) => button.textContent)
        .slice(0, expectedLabels.length);
      expect(labels, profile.id).toEqual(expectedLabels);
    }
  });

  it('has no 変換 button in the CX-Programmer style skin (受入基準①)', () => {
    workspace(OMRON_CP1E);
    expect(screen.queryByTestId('toolbar-convert')).toBeNull();
    expect(screen.queryByText('変換')).toBeNull();
    expect(screen.getByTestId('toolbar-download')).toHaveTextContent('転送［PC → PLC］');
  });

  it('keeps the 変換 button in the GX Works3 and JW-300SP style skins', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('toolbar-convert')).toHaveTextContent('変換');
    cleanup();
    workspace(SHARP_JW300);
    expect(screen.getByTestId('toolbar-convert')).toHaveTextContent('変換');
  });

  it('drops the PCwin-only decorations instead of showing dead buttons (UI監査 2026-09-20 Important #9)', () => {
    workspace(JTEKT_PC10G);
    expect(screen.queryByTestId('toolbar-vendor-only')).toBeNull();
    expect(screen.queryByTestId('toolbar-vendor-only-1')).toBeNull();
    for (const label of ['JP1', 'DGR', 'MOB', 'RDY']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // 実際に動く項目（STP／RUN／RES）はそのまま出る
    expect(screen.getByTestId('toolbar-plc-stop')).toHaveTextContent('STP');
    expect(screen.getByTestId('toolbar-plc-run')).toHaveTextContent('RUN');
    expect(screen.getByTestId('toolbar-plc-reset')).toHaveTextContent('RES');
  });

  /**
   * UI監査バッチD（`340b2d9`）は `PlcSession` と `MonitorPanel` の RUN/STOP を外して
   * 「画面に1つだけ・ツールバーに置く」と決めたが、GX Works3風のツールバー
   * （`TOOLBAR_ACTIONS_BY_DIALECT.mitsubishi`）には `plc-run` が無く、**運転にする手段が
   * 画面から消えていた**（Batch E の E2E で `plc.spec.ts` ①②③ が時間切れ）。
   */
  it('still offers exactly one RUN/STOP on skins whose toolbar has none (Batch E)', () => {
    const onPlc = workspace(MITSUBISHI_FX5U);
    expect(toolbarItems(getDialect('mitsubishi')).some((item) => item.action === 'plc-run')).toBe(
      false,
    );
    const run = screen.getAllByTestId('toolbar-plc-run');
    expect(run).toHaveLength(1);
    expect(run[0]).toHaveTextContent('RUN');
    expect(run[0]).toHaveAttribute('aria-pressed', 'false');
    act(() => {
      fireEvent.click(run[0]!);
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: true });
    expect(screen.getByTestId('toolbar-plc-run')).toHaveTextContent('STOP');
    expect(screen.getByTestId('toolbar-plc-run')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not double the RUN button on skins that already have one', () => {
    for (const profile of [JTEKT_PC10G, OMRON_CP1E, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      expect(screen.getAllByTestId('toolbar-plc-run')).toHaveLength(1);
    }
  });

  it('sends run / stop / reset from the PCwin buttons', () => {
    const onPlc = workspace(JTEKT_PC10G);
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-plc-run'));
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: true });
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-plc-stop'));
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'run', on: false });
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-plc-reset'));
    });
    expect(onPlc).toHaveBeenCalledWith({ kind: 'reset' });
  });

  /**
   * 出力を**コイル列**（`COIL_COL` = 15）に置いた1行。`instruction-list-export.test.tsx` の
   * `coilRow` と同じ理由（最終列以外の出力は `compile-failed` になる）。
   */
  function coilRow(contacts: readonly Cell[], output: Cell): Cell[] {
    const line: Cell[] = [...contacts];
    while (line.length < COIL_COL) line.push(hline());
    line.push(output);
    return line;
  }

  /*
   * UI監査 2026-09-20: `modeD-jtekt-output-error` / `modeD-sharp-output-error` に到達できなかった
   * （`il-issues` が出ない）。PCwin風（JTEKT）・JW-300SP風（SHARP）は `write-mode` のツールバー
   * ボタンを持たない（`TOOLBAR_ACTIONS_BY_DIALECT`）ので、モニタ開始→停止のあとに `changeMode`
   * が `read` へ落としていると、編集へ戻す手段が画面から消え、セルを壊すことも命令語リストの
   * 不具合表示（`il-issues`）を再現することもできなくなっていた。
   */
  it.each([
    ['PCwin風（JTEKT）', JTEKT_PC10G],
    ['JW-300SP風（SHARP）', SHARP_JW300],
  ])(
    'restores write mode after monitor-stop on %s, which has no write-mode button, so editing works again',
    (_label, profile) => {
      // この2スキンには write-mode／read-mode のツールバー項目が無い（決定表#2）
      expect(
        toolbarItems(profile).some(
          (item) => item.action === 'write-mode' || item.action === 'read-mode',
        ),
      ).toBe(false);
      workspace(profile);
      expect(screen.queryByTestId('toolbar-write-mode')).toBeNull();

      act(() => {
        fireEvent.click(screen.getByTestId('toolbar-monitor-start'));
      });
      expect(useStore.getState().ladderMode).toBe('monitor');
      // モニタ中は編集の入口（回路ブロック操作ボタン）が閉じている
      expect(screen.getByTestId('toolbar-insert-network')).toBeDisabled();

      act(() => {
        fireEvent.click(screen.getByTestId('toolbar-monitor-stop'));
      });
      // 直したバグ: 以前はここで `read` のままになり、二度と `write` へ戻す手段が無かった
      expect(useStore.getState().ladderMode).toBe('write');
      expect(screen.getByTestId('toolbar-insert-network')).not.toBeDisabled();
    },
  );

  it('lets the trainee break the circuit and see the IL export issue again after monitor-stop (PCwin風)', () => {
    const working = program(network('n1', [coilRow([no(X(0))], out(Y(0)))]), endNetwork());
    act(() => {
      useStore.getState().setLadder(working);
    });
    workspace(JTEKT_PC10G);

    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-monitor-start'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-monitor-stop'));
    });
    expect(useStore.getState().ladderMode).toBe('write');

    // 入力接点（左母線に繋がる唯一のセル）を消す。書込みモードでなければ `readOnly` で断られる。
    act(() => {
      fireEvent.click(screen.getByTestId('cell-n1:0:0'));
    });
    act(() => {
      fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'Delete' });
    });

    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    expect(screen.getByTestId('il-issues')).toHaveTextContent('左母線');
  });
});

describe('スキンの枠（利用者要求: 実物に近い画面）', () => {
  it('names the tool in the title bar, with 風 and the trademark note', () => {
    workspace(OMRON_CP1E);
    expect(screen.getByTestId('skin-title')).toHaveTextContent('CX-Programmer 風');
    // UI監査 2026-09-20 I22: 商標の注記は常時の文字ではなく「i」印に畳んだ（タイトル帯が
    // 24px固定のまま3列とも2行に折れていた）。全文は title / aria-label で読める。
    const note = screen.getByTestId('skin-title-note');
    expect(note).toHaveAttribute('title', expect.stringContaining('商標'));
    expect(note).toHaveAttribute('aria-label', expect.stringContaining('商標'));
  });

  it('pushes the skin colours in as CSS variables, once, on the workspace', () => {
    workspace(JTEKT_PC10G);
    const root = screen.getByTestId('ladder-workspace');
    expect(root.style.getPropertyValue('--skin-canvas')).toBe(SKIN_THEMES['jtekt'].colors.canvas);
    expect(root.style.getPropertyValue('--skin-powered')).toBe('#E08A1E');
    expect(root.style.getPropertyValue('--skin-cell-w')).toBe('46px');
    expect(root).toHaveAttribute('data-skin', 'jtekt');
  });

  /**
   * `--skin-output-h` は `SkinLayout.outputHeightPx` から出るが、実際にレイアウトへ効いて
   * いるか（値が固定で死んでいないか）を確かめるテストが無かった（レビュー「テスト不足」）。
   */
  it('varies --skin-output-h with the skin (PCwin vs GX Works3)', () => {
    workspace(JTEKT_PC10G);
    const jtektHeight = screen
      .getByTestId('ladder-workspace')
      .style.getPropertyValue('--skin-output-h');
    expect(jtektHeight).toBe(`${String(SKIN_THEMES['jtekt'].layout.outputHeightPx)}px`);
    cleanup();
    workspace(MITSUBISHI_FX5U);
    const mitsubishiHeight = screen
      .getByTestId('ladder-workspace')
      .style.getPropertyValue('--skin-output-h');
    expect(mitsubishiHeight).toBe(`${String(SKIN_THEMES['mitsubishi'].layout.outputHeightPx)}px`);
    expect(mitsubishiHeight).not.toBe(jtektHeight);
  });

  it('shows the status items each tool shows', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('status-mode')).toHaveTextContent('書込');
    expect(screen.getByTestId('status-network')).toHaveTextContent('n1');
    expect(screen.getByTestId('status-overwrite')).toBeInTheDocument();
    expect(screen.queryByTestId('status-scan')).toBeNull();
    cleanup();
    workspace(JTEKT_PC10G);
    expect(screen.getByTestId('status-scan')).toBeInTheDocument();
    expect(screen.getByTestId('status-device-count')).toBeInTheDocument();
    expect(screen.queryByTestId('status-overwrite')).toBeNull();
  });

  it('folds the output pane into the status bar in the PCwin style (§10.6)', () => {
    workspace(JTEKT_PC10G);
    expect(screen.getByTestId('ladder-workspace')).toHaveAttribute(
      'data-output-pane',
      'status-bar',
    );
    cleanup();
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('ladder-workspace')).toHaveAttribute('data-output-pane', 'window');
  });

  /**
   * レビュー B2: `data-output-pane` は見た目に効かない飾りの旗だった。`OutputWindow` の
   * `open` を配線してから、実際に `<details>` が閉じているか（PCwin風）を確かめる。
   */
  it('folds the output details closed by default in the PCwin style, keeps it open elsewhere (B2)', () => {
    workspace(JTEKT_PC10G);
    expect(screen.getByTestId('output-details')).not.toHaveAttribute('open');
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      expect(screen.getByTestId('output-details'), profile.id).toHaveAttribute('open');
    }
  });
});

describe('変換のいらないスキン（§10.6 / 決定表#3）', () => {
  /** 1セルだけ置いたラダー（変換は `no-output` で落ちる）。 */
  const oneContact = program(network('n1', [[no(X(0)), empty()]]), network('end', [[empty()]]));

  it('converts on every change when the skin has no 変換 step', () => {
    const onPlc = workspace(OMRON_CP1E);
    /*
     * 課題を開いた直後の空のラダーは変換を通るので、マウント時の自動変換で Worker へ1回載る
     * （それが自動変換の目的である）。ここで見たいのは「**落ちた**変換は Worker へ載せない」
     * ことなので、載った1回を数え直す。
     */
    expect(onPlc).toHaveBeenCalledTimes(1);
    onPlc.mockClear();
    // トーストはセッションを捨てても残るので、このケースで増えないことを見る
    const toasts = useStore.getState().toasts.length;
    act(() => {
      useStore.getState().setLadder(oneContact);
    });
    // 自動変換が走り、結果が出力ウィンドウに出る（トーストは出さない）
    expect(useStore.getState().convertIssues.errors.length).toBeGreaterThan(0);
    expect(useStore.getState().toasts).toHaveLength(toasts);
    expect(onPlc).not.toHaveBeenCalled();
  });

  it('does not convert by itself when the skin has a 変換 button', () => {
    workspace(MITSUBISHI_FX5U);
    act(() => {
      useStore.getState().setLadder(oneContact);
    });
    expect(useStore.getState().convertIssues.errors).toHaveLength(0);
    expect(useStore.getState().converted).toBe(false);
  });
});

describe('キーの文字列を文言に埋め込まない（前提#22 / 決定表#2）', () => {
  it('names the convert key of the current skin in the output window', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('convert-state')).toHaveTextContent('F4');
  });

  it('says the ladder is converted automatically where there is no 変換', () => {
    workspace(OMRON_CP1E);
    expect(screen.getByTestId('convert-state')).not.toHaveTextContent('F4');
    expect(screen.getByTestId('convert-state')).toHaveTextContent('自動');
  });

  it('names the write-mode key of the current skin when an edit is refused', () => {
    workspace(MITSUBISHI_FX5U);
    act(() => {
      useStore.getState().setLadderMode('read');
      fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    });
    const key = getDialect('mitsubishi').shortcuts.find((s) => s.action === 'write-mode')?.keys;
    expect(useStore.getState().toasts.at(-1)?.text).toContain(key);
  });

  /**
   * レビュー I8: OMRON のキー割当表には `write-mode` が無い（実機はツールバーの
   * 「オンライン編集」で、ファンクションキーではない）。`?? 'F2'` は OMRON に無いキーを
   * 教えてしまっていた。ツールバーの項目名へ倒れることを確かめる。
   */
  it('names the toolbar label, not the invented F2, when the skin has no write-mode key (I8)', () => {
    workspace(OMRON_CP1E);
    act(() => {
      useStore.getState().setLadderMode('read');
      fireEvent.click(screen.getByTestId('toolbar-insert-network'));
    });
    const message = useStore.getState().toasts.at(-1)?.text ?? '';
    expect(message).not.toContain('F2');
    expect(message).toContain('オンライン編集');
  });
});

// --- Plan 4B Task 8 ---
describe('表記切替の入口（§10.7 / Task 8）', () => {
  it('opens the notation dialog from the toolbar of every skin', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      expect(screen.queryByTestId('notation-dialog'), profile.id).toBeNull();
      act(() => {
        fireEvent.click(screen.getByTestId('toolbar-notation'));
      });
      expect(screen.getByTestId('notation-dialog'), profile.id).toBeInTheDocument();
      // いまのメーカーは切替先に出ない
      expect(screen.queryByTestId(`notation-to-${profile.id}`), profile.id).toBeNull();
    }
  });

  it('closes the dialog with the close button', () => {
    workspace(MITSUBISHI_FX5U);
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-notation'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('notation-close'));
    });
    expect(screen.queryByTestId('notation-dialog')).toBeNull();
  });
});
// --- /Plan 4B Task 8 ---

// --- Phase 7 Task 22（ウィンドウ構成とモニタ表示。設計 §5.5 / 指摘 LE-18・PR-05・UX-14） ---
describe('画面構成は方言の panels だけで決まる（設計 §5.5）', () => {
  it('shows the comment pane under the name the vendor uses, in every skin that names one', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      const name = profile.panels.comment;
      if (name === undefined) {
        expect(screen.queryByTestId('comment-panel'), profile.id).toBeNull();
        continue;
      }
      expect(screen.getByTestId('comment-panel-summary'), profile.id).toHaveTextContent(name);
    }
    // 呼び名がメーカーで変わっていること（飾りの旗になっていない）
    expect(OMRON_CP1E.panels.comment).not.toBe(MITSUBISHI_FX5U.panels.comment);
  });

  it('shows the watch pane only where the vendor names one, under that name', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      const name = profile.panels.watch;
      if (name === undefined) {
        expect(screen.queryByTestId('watch-panel'), profile.id).toBeNull();
        expect(screen.queryByTestId('toolbar-watch'), profile.id).toBeNull();
        continue;
      }
      expect(screen.getByTestId('watch-panel-summary'), profile.id).toHaveTextContent(name);
      expect(screen.getByTestId('toolbar-watch'), profile.id).toHaveTextContent(name);
    }
    // PCwin風（JTEKT）は監視の欄を名乗らない＝欄が出ない側の実例
    expect(JTEKT_PC10G.panels.watch).toBeUndefined();
  });

  it('names the output pane the way the vendor does (PCwin風 は「ステータスバー」)', () => {
    workspace(JTEKT_PC10G);
    expect(screen.getByTestId('output-summary')).toHaveTextContent('ステータスバー');
    cleanup();
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('output-summary')).toHaveTextContent('出力ウィンドウ');
  });

  it('draws exactly the status items the vendor names, in order (源は panels.status)', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      const shown = Array.from(
        screen.getByTestId('skin-status').querySelectorAll('[data-testid^="status-"]'),
      ).map((item) => item.getAttribute('data-testid'));
      expect(shown, profile.id).toEqual(
        (profile.panels.status ?? []).map((item) => `status-${item}`),
      );
    }
  });

  it('puts 書込み／読出し／モニタ on the title bar as well as the status bar (設計 §5.5)', () => {
    workspace(MITSUBISHI_FX5U);
    expect(screen.getByTestId('skin-title-mode')).toHaveTextContent('書込');
    expect(screen.getByTestId('status-mode')).toHaveTextContent('書込');
    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-monitor-start'));
    });
    expect(screen.getByTestId('skin-title-mode')).toHaveTextContent('モニタ');
    // 切り替えのキーは方言から引く（前提#22。F2／F3 を直書きしない）
    const hint = screen.getByTestId('skin-title-mode').getAttribute('title') ?? '';
    expect(hint).toContain(
      MITSUBISHI_FX5U.shortcuts.find((entry) => entry.action === 'write-mode')?.keys,
    );
  });

  /**
   * 指摘 LE-18: 幅の実測が `window.resize` だけで、表示切替や `<details>` の開閉に追従
   * しなかった。`ResizeObserver` で欄そのものを見るようにしたので、窓の大きさが変わらない
   * まま欄だけが狭くなっても列数が取り直される。
   */
  it('re-measures the editing pane with a ResizeObserver, not only on window resize (LE-18)', () => {
    const observed: Element[] = [];
    let fire: (() => void) | undefined;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        fire = callback;
      }
      observe(element: Element): void {
        observed.push(element);
      }
      disconnect(): void {
        /* 何もしない */
      }
      unobserve(): void {
        /* 何もしない */
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      workspace(MITSUBISHI_FX5U);
      // 編集領域そのものを見ている（窓ではない）
      expect(observed).toContain(screen.getByTestId('workspace-main'));
      // 幅を細くして観測を1回起こすと、格子の列数が測り直される
      vi.spyOn(screen.getByTestId('workspace-main'), 'getBoundingClientRect').mockReturnValue({
        width: 320,
        height: 400,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 320,
        bottom: 400,
        toJSON: () => ({}),
      });
      const before = screen.getByTestId('ladder-grid').getAttribute('data-cols');
      act(() => {
        fire?.();
      });
      expect(screen.getByTestId('ladder-grid').getAttribute('data-cols')).not.toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
// --- /Phase 7 Task 22 ---
