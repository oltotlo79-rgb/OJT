import { useState, type JSX } from 'react';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { PlcUnitDefinition } from '@ojt/board-model';
import { X, Y, T, C } from '@ojt/ladder-core';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { SidePanel } from './SidePanel.js';

export function PlcDebugPanel({
  profile,
  unit,
  onPlc,
}: {
  profile: DialectProfile;
  unit: PlcUnitDefinition;
  onPlc: (action: PlcCommandAction) => void;
}): JSX.Element {
  const debug = useStore((state) => state.snapshot.plcDebug);
  const snapshot = useStore((state) => state.plcMonitor);
  const converted = useStore((state) => state.converted);
  const mode = useStore((state) => state.ladderMode);
  const [deviceText, setDeviceText] = useState('');
  const [breakValue, setBreakValue] = useState(true);
  const [error, setError] = useState('');
  const [forceIndex, setForceIndex] = useState(0);
  const [forceValue, setForceValue] = useState(true);
  const forced = Object.entries(debug?.forcedInputs ?? {});
  const monitor = (): void => {
    if (mode !== 'monitor') {
      useStore.getState().setLadderMode('monitor');
      onPlc({ kind: 'monitor', on: true });
    }
  };
  return (
    <SidePanel title="スキャン診断" testId="plc-debug" open={false}>
      <p role="status">
        {debug?.paused
          ? '一時停止中：回路とPLCの時間を停止しています'
          : debug?.running
            ? '連続スキャン中'
            : 'STOP：出力OFF／内部メモリ保持'}
      </p>
      <button
        type="button"
        disabled={!converted || !debug?.running}
        onClick={() => onPlc({ kind: 'pause', on: !debug?.paused })}
      >
        {debug?.paused ? '連続実行へ戻る' : '一時停止'}
      </button>
      <button
        type="button"
        disabled={!converted || !debug?.supply.ready}
        onClick={() => {
          monitor();
          onPlc({ kind: 'step' });
        }}
      >
        1スキャン実行（10 ms）
      </button>
      <p>
        1スキャンごとに入力読込 → ラダー演算 → 出力更新 →
        回路計算を行います。内部リレー・タイマ・カウンタは「デバイス一覧」で確認できます。リセットすると保持した値も初期化します。
      </p>
      <fieldset disabled={!converted}>
        <legend>条件が成立したら一時停止</legend>
        <label>
          デバイス
          <input
            aria-label="停止条件のデバイス"
            value={deviceText}
            maxLength={32}
            onChange={(event) => setDeviceText(event.target.value)}
            placeholder={profile.formatDevice(X(0))}
          />
        </label>
        <select
          aria-label="停止条件の値"
          value={String(breakValue)}
          onChange={(event) => setBreakValue(event.target.value === 'true')}
        >
          <option value="true">ON</option>
          <option value="false">OFF</option>
        </select>
        <button
          type="button"
          onClick={() => {
            const device = profile.parseDevice(deviceText.trim());
            if (device instanceof Error) {
              setError('この機種で使用できるデバイス名を入力してください。');
              return;
            }
            setError('');
            monitor();
            onPlc({ kind: 'break', condition: { device, value: breakValue } });
          }}
        >
          条件を設定
        </button>
        <button type="button" onClick={() => onPlc({ kind: 'break', condition: null })}>
          条件を解除
        </button>
        {error && <p role="alert">{error}</p>}
        {debug?.condition && (
          <p>
            停止条件：{profile.formatDevice(debug.condition.device)} が{' '}
            {debug.condition.value ? 'ON' : 'OFF'}
          </p>
        )}
      </fieldset>
      {debug?.allowForcing && (
        <fieldset disabled={!converted}>
          <legend>自由診断用の入力強制</legend>
          <p>
            入力の読値を一時的に置き換えます。配線そのものは変わりません。強制中は判定できません。STOP・リセット・課題切替で解除されます。
          </p>
          <select
            aria-label="強制する入力"
            value={forceIndex}
            onChange={(event) => setForceIndex(Number(event.target.value))}
          >
            {unit.spec.inputs.map((_, index) => (
              <option key={index} value={index}>
                {profile.formatDevice(X(index))}
              </option>
            ))}
          </select>
          <select
            aria-label="強制する値"
            value={String(forceValue)}
            onChange={(event) => setForceValue(event.target.value === 'true')}
          >
            <option value="true">ON</option>
            <option value="false">OFF</option>
          </select>
          <button
            type="button"
            onClick={() => onPlc({ kind: 'force', index: forceIndex, value: forceValue })}
          >
            入力を強制
          </button>
          <button type="button" onClick={() => onPlc({ kind: 'clearForces' })}>
            すべての強制を解除
          </button>
        </fieldset>
      )}
      {snapshot?.diagnostics && (
        <details>
          <summary>直近スキャンの実行順とリセット理由</summary>
          <p>
            スキャン {snapshot.scanCount}{' '}
            回目。手動実行または条件停止すると、同じスキャンを落ち着いて確認できます。
          </p>
          <p>
            ① 入力読込：
            {snapshot.inputs
              .map((value, index) => `${profile.formatDevice(X(index))}=${value ? 'ON' : 'OFF'}`)
              .join('、')}
          </p>
          <ol>
            {snapshot.diagnostics.networks.map((trace) => (
              <li key={trace.networkId}>
                <button
                  type="button"
                  onClick={() =>
                    useStore
                      .getState()
                      .setLadderCursor({ networkId: trace.networkId, row: 0, col: 0 })
                  }
                >
                  回路 {trace.networkId} を見る
                </button>
                {trace.writes.map((write, index) => (
                  <p key={index}>
                    {profile.formatDevice(write.device)}（{write.instruction}・条件
                    {write.powered ? 'ON' : 'OFF'}）：{write.before} → {write.after}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <p>
            ③ 出力更新：
            {snapshot.outputs
              .map((value, index) => `${profile.formatDevice(Y(index))}=${value ? 'ON' : 'OFF'}`)
              .join('、')}
          </p>
          <table>
            <caption>タイマ・カウンタの値と最後のリセット</caption>
            <thead>
              <tr>
                <th>デバイス</th>
                <th>現在／設定</th>
                <th>リセット理由</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(snapshot.timers).map(([id, timer]) => (
                <tr key={`T${id}`}>
                  <td>{profile.formatDevice(T(Number(id)))}</td>
                  <td>
                    {timer.elapsedMs} / {timer.presetMs} ms
                  </td>
                  <td>
                    {snapshot.diagnostics?.resets[`timer:${id}`]?.reason ?? 'まだリセットなし'}
                  </td>
                </tr>
              ))}
              {Object.entries(snapshot.counters).map(([id, counter]) => (
                <tr key={`C${id}`}>
                  <td>{profile.formatDevice(C(Number(id)))}</td>
                  <td>
                    {counter.value} / {snapshot.counterPresets?.[Number(id)] ?? '—'} 回
                  </td>
                  <td>
                    {snapshot.diagnostics?.resets[`counter:${id}`]?.reason ?? 'まだリセットなし'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {forced.length > 0 && (
        <p role="alert" style={{ background: '#fff1c7', color: '#482a00', padding: 8 }}>
          入力強制中：
          {forced
            .map(
              ([index, value]) =>
                `${profile.formatDevice(X(Number(index)))}=${value ? 'ON' : 'OFF'}`,
            )
            .join('、')}
          。実配線の入力とは異なります。
        </p>
      )}
    </SidePanel>
  );
}
