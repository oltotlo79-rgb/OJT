import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { PowerControls } from '../src/renderer/panels/PowerControls.js';
import styles from '../src/renderer/panels/panels.module.css';

/**
 * 電源操作の順番（UXレビュー #10）。「①ブレーカ→②電源スイッチ」の番号付きラベルを出し、
 * 次に押す1つを強調する。
 */

afterEach(() => {
  cleanup();
});

function renderPower(overrides: {
  breakerOn?: boolean;
  switchOn?: boolean;
  powered?: boolean;
  tripped?: boolean;
}): void {
  render(
    <PowerControls
      breakerOn={overrides.breakerOn ?? false}
      switchOn={overrides.switchOn ?? false}
      powered={overrides.powered ?? false}
      tripped={overrides.tripped ?? false}
      onBreaker={vi.fn()}
      onSwitch={vi.fn()}
      onResetTrip={vi.fn()}
    />,
  );
}

describe('番号付きラベル', () => {
  it.each([
    [{ powered: false }, '○無通電'],
    [{ powered: true }, '●通電中'],
    [{ powered: true, tripped: true }, '▲保護動作'],
  ] as const)('電源状態を色に頼らず区別できる: %s', (state, label) => {
    renderPower(state);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('①ブレーカ／②電源スイッチの順番を文字で出す', () => {
    renderPower({});
    expect(screen.getByTestId('power-breaker')).toHaveTextContent(JA.powerStep.breaker);
    expect(screen.getByTestId('power-switch')).toHaveTextContent(JA.powerStep.switch);
  });
});

describe('次に押す1つの強調', () => {
  it('両方OFFのときはブレーカを強調する', () => {
    renderPower({ breakerOn: false, switchOn: false });
    expect(screen.getByTestId('power-breaker').className).toContain(styles.nextStep);
    expect(screen.getByTestId('power-switch').className).not.toContain(styles.nextStep);
  });

  it('ブレーカだけONなら電源スイッチを強調する', () => {
    renderPower({ breakerOn: true, switchOn: false });
    expect(screen.getByTestId('power-breaker').className).not.toContain(styles.nextStep);
    expect(screen.getByTestId('power-switch').className).toContain(styles.nextStep);
  });

  it('両方ONなら強調しない', () => {
    renderPower({ breakerOn: true, switchOn: true, powered: true });
    expect(screen.getByTestId('power-breaker').className).not.toContain(styles.nextStep);
    expect(screen.getByTestId('power-switch').className).not.toContain(styles.nextStep);
  });

  it('保護動作中は強調しない（復帰の手順は別にある）', () => {
    renderPower({ breakerOn: true, switchOn: true, tripped: true });
    expect(screen.getByTestId('power-breaker').className).not.toContain(styles.nextStep);
    expect(screen.getByTestId('power-switch').className).not.toContain(styles.nextStep);
  });
});
