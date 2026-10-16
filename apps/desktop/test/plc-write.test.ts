import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { COIL_COL, endNetwork, hline, network, no, out, program, X, Y } from '@ojt/ladder-core';
import { getDialect } from '@ojt/plc-dialects';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlcCommandAction } from '../src/worker/protocol.js';
import { useStore } from '../src/renderer/app/store.js';
import { NO_CONVERT_ISSUES } from '../src/renderer/app/store-types.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { plcJudgePlan, plcProgramState } from '../src/renderer/session/plc-session.js';
import {
  startPlc,
  stopPlc,
  writeLabel,
  writeLadderToPlc,
} from '../src/renderer/session/plc-write.js';
import { restoreInspectState, toInspectWorkFile } from '../src/renderer/session/work-file.js';

/**
 * PLC は書き込まれたプログラムで動く（v2.1.0 監査 P1）。
 *
 * 以前は「変換」がそのまま書込みに当たり、変換した瞬間に実行する回路が入れ替わっていた。
 * 説明書13・14章は実機どおり「変換しただけ・書込みしただけの段階を運転中と取り違えないように」
 * と書いていて、アプリの動きと食い違っていた。
 */

const problem = BUILTIN_PLC_PROBLEMS[0]!;

function ladderA(): ReturnType<typeof program> {
  return program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
}

function ladderB(): ReturnType<typeof program> {
  return program(network('n1', [[no(X(1)), out(Y(1))]]), endNetwork());
}

let sent: PlcCommandAction[] = [];
const send = (action: PlcCommandAction): void => {
  sent.push(action);
};

beforeEach(() => {
  sent = [];
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
  useStore.setState({ toasts: [] });
});

afterEach(() => {
  useStore.getState().abandonSession();
});

/** エディタにラダーを置き、変換済みにする。 */
function convertedLadder(ladder = ladderA()): void {
  useStore.getState().setLadder(ladder);
  useStore.getState().setConverted(true, NO_CONVERT_ISSUES);
}

describe('書込み（writeLadderToPlc）', () => {
  it('does not write a ladder that has not been converted', () => {
    useStore.getState().setLadder(ladderA());
    expect(writeLadderToPlc(send)).toBe(false);
    expect(sent).toEqual([]);
    expect(useStore.getState().plcProgram).toBeUndefined();
  });

  it('sends the converted ladder once and remembers it as the PLC program', () => {
    convertedLadder();
    const ladder = useStore.getState().ladder;
    expect(writeLadderToPlc(send)).toBe(true);
    expect(sent).toEqual([{ kind: 'load', program: ladder }]);
    expect(useStore.getState().plcProgram).toBe(ladder);
    expect(plcProgramState(useStore.getState())).toBe('written');
  });

  it('stops a running PLC before writing, and keeps the monitor on', () => {
    convertedLadder();
    useStore.getState().setPlcRunning(true);
    useStore.getState().setLadderMode('monitor');
    writeLadderToPlc(send);
    expect(sent.map((action) => action.kind)).toEqual(['run', 'load', 'monitor']);
    expect(sent[0]).toEqual({ kind: 'run', on: false });
    expect(useStore.getState().plcRunning).toBe(false);
  });

  it('marks the program stale once the editor changes, and written again after a new write', () => {
    convertedLadder();
    writeLadderToPlc(send);
    useStore.getState().setLadder(ladderB());
    expect(plcProgramState(useStore.getState())).toBe('stale');
    useStore.getState().setConverted(true, NO_CONVERT_ISSUES);
    writeLadderToPlc(send);
    expect(plcProgramState(useStore.getState())).toBe('written');
  });

  it('names the write after each vendor tool', () => {
    expect(writeLabel(getDialect('mitsubishi'))).toBe('シーケンサへの書込み');
    expect(writeLabel(getDialect('omron'))).toBe('転送［PC → PLC］');
    expect(writeLabel(getDialect('sharp'))).toBe('PLCへの書込み');
    // ジェイテクトは PCwin の資料が未入手のため名前は前提（スキンの根拠に記す）
    expect(writeLabel(getDialect('jtekt'))).toBe('PCへ書込み');
  });
});

describe('RUN（startPlc / stopPlc）', () => {
  it('refuses to run a PLC with no program and lights ERR', () => {
    expect(startPlc(send)).toBe(false);
    expect(sent).toEqual([]);
    expect(useStore.getState().plcRunning).toBe(false);
    expect(useStore.getState().plcNoProgramError).toBe(true);
    expect(useStore.getState().toasts.map((toast) => toast.text)).toContain(JA.ladder.runNoProgram);
    // STOP（または書込み）で ERR は消える
    stopPlc(send);
    expect(useStore.getState().plcNoProgramError).toBe(false);
  });

  it('runs the written program', () => {
    convertedLadder();
    writeLadderToPlc(send);
    sent = [];
    expect(startPlc(send)).toBe(true);
    expect(sent).toEqual([{ kind: 'run', on: true }]);
    expect(useStore.getState().plcRunning).toBe(true);
  });

  it('clears ERR when a program is written', () => {
    startPlc(send);
    convertedLadder();
    writeLadderToPlc(send);
    expect(useStore.getState().plcNoProgramError).toBe(false);
  });
});

describe('判定の段取り（plcJudgePlan）', () => {
  it('judges the written program as it is when the editor has not changed', () => {
    convertedLadder();
    writeLadderToPlc(send);
    const plan = plcJudgePlan(useStore.getState());
    expect(plan).toEqual({ kind: 'judge', program: useStore.getState().plcProgram });
  });

  it('asks before judging when the editor has unwritten changes', () => {
    convertedLadder();
    writeLadderToPlc(send);
    convertedLadder(ladderB());
    expect(plcJudgePlan(useStore.getState())).toEqual({
      kind: 'confirm',
      canWrite: true,
      canJudgeAsIs: true,
    });
    // 変換していない変更なら「書き込んでから判定」は出せない
    useStore.getState().setLadder(ladderA());
    expect(plcJudgePlan(useStore.getState())).toEqual({
      kind: 'confirm',
      canWrite: false,
      canJudgeAsIs: true,
    });
  });

  it('offers only "write, then judge" when the PLC has no program', () => {
    convertedLadder();
    expect(plcJudgePlan(useStore.getState())).toEqual({
      kind: 'confirm',
      canWrite: true,
      canJudgeAsIs: false,
    });
  });

  it('cannot judge without a program or a converted ladder', () => {
    useStore.getState().setLadder(ladderA());
    expect(plcJudgePlan(useStore.getState())).toEqual({
      kind: 'blocked',
      reason: 'not-converted',
    });
  });
});

describe('作業ファイル（PLC のプログラムも保存する）', () => {
  it('saves the PLC program and opens with it written when it matches the editor', () => {
    convertedLadder();
    writeLadderToPlc(send);
    const file = toInspectWorkFile();
    expect(file?.plcProgram).toEqual({ networks: useStore.getState().ladder?.networks });
    expect(file).toBeDefined();
    if (file === undefined) return;
    useStore.getState().abandonSession();
    expect(restoreInspectState(problem, file)).toBe(true);
    expect(plcProgramState(useStore.getState())).toBe('written');
  });

  it('re-converts a ladder that was saved converted, so it is not shown as unconverted', () => {
    // 変換が本当に通るラダー（コイルはコイル列）
    convertedLadder(
      program(
        network('n1', [[no(X(0)), ...Array.from({ length: COIL_COL - 1 }, hline), out(Y(0))]]),
        endNetwork(),
      ),
    );
    writeLadderToPlc(send);
    const file = toInspectWorkFile();
    if (file === undefined) throw new Error('作業ファイルが作れません');
    expect(file.converted).toBe(true);
    useStore.getState().abandonSession();
    restoreInspectState(problem, file);
    expect(useStore.getState().converted).toBe(true);
    expect(plcProgramState(useStore.getState())).toBe('written');
  });

  it('opens a program that differs from the editor as "stale"', () => {
    convertedLadder();
    writeLadderToPlc(send);
    useStore.getState().setLadder(ladderB());
    const file = toInspectWorkFile();
    if (file === undefined) throw new Error('作業ファイルが作れません');
    useStore.getState().abandonSession();
    restoreInspectState(problem, file);
    expect(plcProgramState(useStore.getState())).toBe('stale');
    expect(useStore.getState().plcProgram?.networks).toEqual(ladderA().networks);
  });

  it('treats an older file (no PLC program) as written when it was converted', () => {
    convertedLadder();
    const file = toInspectWorkFile();
    if (file === undefined) throw new Error('作業ファイルが作れません');
    expect(file.plcProgram).toBeUndefined();
    useStore.getState().abandonSession();
    restoreInspectState(problem, { ...file, converted: true });
    expect(plcProgramState(useStore.getState())).toBe('written');
    useStore.getState().abandonSession();
    restoreInspectState(problem, { ...file, converted: false });
    expect(plcProgramState(useStore.getState())).toBe('none');
  });
});

describe('メーカーの切替', () => {
  it('empties the PLC program because the PLC on the desk changes', () => {
    convertedLadder();
    writeLadderToPlc(send);
    useStore.getState().switchDialect('omron');
    expect(useStore.getState().plcProgram).toBeUndefined();
    expect(plcProgramState(useStore.getState())).toBe('none');
  });
});
