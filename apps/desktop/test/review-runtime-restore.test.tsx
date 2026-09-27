import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PLC_PROBLEMS, buildPlcReferenceSession } from '@ojt/content';
import { endNetwork, hline, network, no, out, program, X, Y } from '@ojt/ladder-core';
import { getDialect, IMPLEMENTED_DIALECT_IDS } from '@ojt/plc-dialects';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { runConvert } from '../src/renderer/session/ladder-errors.js';
import { useRuntimeConnection } from '../src/renderer/session/use-runtime-connection.js';
import type { SimCommand, SimMessage } from '../src/worker/protocol.js';

const bridgeState = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeState));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(IMPLEMENTED_DIALECT_IDS)(
  '%s: 再開処理から送ったデータで実Workerがスキャンと測定を再開する',
  async (vendor) => {
    useStore.getState().abandonSession();
    useStore.getState().openProblem(BUILTIN_PLC_PROBLEMS[0]!, { vendor });
    const state = useStore.getState();
    if (state.problem?.mode !== 'plc') throw new Error('PLC課題が必要です');
    const built = buildPlcReferenceSession(state.problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範配線を作成できません');
    const ladder = program(
      network('n1', [[no(X(0)), ...Array.from({ length: 14 }, hline), out(Y(0))]]),
      endNetwork(),
    );
    const converted = runConvert(ladder, getDialect(vendor));
    expect(converted.ok).toBe(true);
    state.setSession(built.value.session);
    state.setLadder(ladder);
    state.setConverted(true, converted.issues);
    state.setLadderMode('monitor');
    state.applyTester({ type: 'set-mode', mode: 'DCV' });
    state.applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('N.1') });
    state.applyTester({ type: 'place-probe', probe: 'red', terminal: toTerminalId('P.1') });

    const first = renderHook(() => useRuntimeConnection('plc'));
    first.unmount();
    bridgeState.sent.length = 0;
    renderHook(() => useRuntimeConnection('plc'));
    expect(useStore.getState().plcRunning).toBe(false);
    const commands = bridgeState.sent as unknown as SimCommand[];
    expect(commands[0]?.type).toBe('load');
    expect(
      commands.some((command) => command.type === 'plc' && command.action.kind === 'load'),
    ).toBe(true);

    const posted: SimMessage[] = [];
    const worker = {
      postMessage: (message: SimMessage) => posted.push(message),
      onmessage: undefined as unknown as (event: { data: SimCommand }) => void,
    };
    vi.stubGlobal('self', worker);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.resetModules();
    await import('../src/worker/sim.worker.js');
    const send = (command: SimCommand): void => worker.onmessage({ data: command });
    commands.forEach(send);
    send({ type: 'plc', action: { kind: 'run', on: true } });
    send({ type: 'breaker', on: true });
    send({ type: 'switch', on: true });
    send({ type: 'press', pbId: 'PB1' });
    for (let tick = 0; tick < 100; tick += 1) {
      now += 4;
      vi.advanceTimersByTime(4);
    }
    expect(posted.filter((message) => message.type === 'error')).toEqual([]);
    const snapshots = posted
      .filter((message) => message.type === 'snapshot')
      .map((message) => message.snapshot);
    const latest = snapshots.at(-1)!;
    expect(latest.plc?.scanCount).toBeGreaterThan(0);
    expect(latest.lamps['PL1']?.level).toBe('lit');
    expect(latest.tester).toMatchObject({ mode: 'DCV', black: 'N.1', red: 'P.1' });
  },
);
