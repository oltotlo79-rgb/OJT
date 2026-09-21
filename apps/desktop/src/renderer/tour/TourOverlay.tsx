import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { trapFocus } from '../app/focus-trap.js';
import { tryOjtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { useHelpStore } from '../help/help-store.js';
import { JA } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { TOUR_STEPS, useTourStore, type TourStep } from './tour-store.js';
import styles from './tour.module.css';

const TARGETS: Record<TourStep, readonly string[]> = {
  rotate: ['viewport'],
  mount: ['viewport', 'parts-panel'],
  wire: ['viewport', 'terminal-list'],
  power: ['viewport', 'power-breaker', 'power-switch', 'power-reset'],
  judge: ['judge-button'],
};

function targetsFor(step: TourStep): HTMLElement[] {
  return TARGETS[step].flatMap((id) => {
    const element = document.querySelector<HTMLElement>(`[data-testid=${id}]`);
    return element === null ? [] : [element];
  });
}

function Guide({ step, onClose }: { step: TourStep; onClose: () => void }): JSX.Element {
  const panel = useRef<HTMLElement>(null);
  const [cutout, setCutout] = useState('');
  const index = TOUR_STEPS.indexOf(step);
  useEffect(() => {
    const measure = (): void => {
      const holes = targetsFor(step).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const x = Math.max(0, rect.left - 4);
        const y = Math.max(0, rect.top - 4);
        const right = Math.min(window.innerWidth, rect.right + 4);
        const bottom = Math.min(window.innerHeight, rect.bottom + 4);
        return right > x && bottom > y ? [`M ${x} ${y} H ${right} V ${bottom} H ${x} Z`] : [];
      });
      setCutout(
        `path(evenodd, 'M 0 0 H ${window.innerWidth} V ${window.innerHeight} H 0 Z ${holes.join(' ')}')`,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    for (const element of targetsFor(step)) observer?.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    const layer = pushModalLayer();
    const previous = document.activeElement;
    panel.current?.focus();
    const key = (event: KeyboardEvent): void => {
      if (topModalLayer() !== layer.depth) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === 'Tab') {
        trapFocus(panel.current, event, targetsFor(useTourStore.getState().step ?? 'rotate'));
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      layer.release();
      window.removeEventListener('keydown', key, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.shade} style={{ clipPath: cutout }} aria-hidden="true" />
      <section
        className={styles.card}
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-instruction"
        data-testid="tour-guide"
        data-step={step}
      >
        <div className={styles.heading}>
          <span>{JA.tour.title}</span>
          <span className={styles.count}>{JA.tour.progress(index + 1)}</span>
        </div>
        <div className={styles.progress} aria-hidden="true">
          {TOUR_STEPS.map((value, i) => (
            <span key={value} data-done={i <= index} />
          ))}
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h2 id="tour-title">{JA.tour.steps[step].title}</h2>
          <p id="tour-instruction">{JA.tour.steps[step].body}</p>
        </div>
        <div className={styles.actions}>
          {step === 'rotate' ? (
            <button
              type="button"
              data-testid="tour-rotate"
              onClick={() => {
                const state = useStore.getState();
                state.setCamera(state.camera === 'top' ? 'front' : 'top');
                useTourStore.getState().advance('rotate');
              }}
            >
              {JA.tour.rotateKeyboard}
            </button>
          ) : null}
          <button type="button" data-testid="tour-later" onClick={onClose}>
            {JA.tour.later}
          </button>
          <button type="button" data-testid="tour-never" onClick={onClose}>
            {JA.tour.never}
          </button>
          <kbd>Esc</kbd>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** 実際の盤の変化を見て進む。ボタンを眺めて「次へ」を押すだけでは進まない。 */
export function TourOverlay(): JSX.Element | null {
  const { loaded, done, requested, canvas, step } = useTourStore();
  const route = useStore((state) => state.route);
  const problem = useStore((state) => state.problem);
  const webglLost = useStore((state) => state.webglLost);
  const helpOpen = useHelpStore((state) => state.open);
  const activeProblem = useRef<string | undefined>(undefined);

  const close = useCallback(() => {
    useTourStore.getState().finish();
    void tryOjtApi()
      ?.setSettings({ tourDone: true })
      .catch(() => {
        useStore.getState().toast(JA.tour.saveFailed, 'error');
      });
  }, []);

  useEffect(() => {
    if (step !== null) {
      if (route !== 'session' || problem?.id !== activeProblem.current) close();
      return;
    }
    if (!loaded || (done && !requested) || canvas === null || webglLost || helpOpen) return;
    if (route !== 'session' || problem?.mode !== 'assemble') return;
    activeProblem.current = problem.id;
    useStore.getState().setAssembleView('board');
    useStore.getState().setMode('wire');
    useTourStore.getState().start();
  }, [loaded, done, requested, canvas, webglLost, helpOpen, route, problem, step, close]);

  useEffect(() => {
    if (step === null) return;
    // 盤コマンドは現在のセッションを書き換えてから通知する。値を控えて参照共有を避ける。
    const mountedKinds = (): Map<string, string> =>
      new Map(
        Object.entries(useStore.getState().session?.mounted ?? {}).map(([id, part]) => [
          id,
          part.kind,
        ]),
      );
    let previousMounted = mountedKinds();
    let previousWireCount = useStore.getState().session?.wires.length ?? 0;
    return useStore.subscribe((state, before) => {
      if (state.problem?.id !== activeProblem.current) return;
      if (step === 'mount') {
        const current = mountedKinds();
        if ([...current].some(([id, kind]) => previousMounted.get(id) !== kind))
          useTourStore.getState().advance('mount');
        previousMounted = current;
      } else if (step === 'wire' && (state.session?.wires.length ?? 0) > previousWireCount) {
        useTourStore.getState().advance('wire');
      } else if (step === 'power' && state.snapshot.powered && !before.snapshot.powered) {
        useTourStore.getState().advance('power');
      } else if (step === 'judge' && state.judging && !before.judging) {
        close();
      }
      previousWireCount = state.session?.wires.length ?? 0;
    });
  }, [step, close]);

  if (step === null || canvas === null || webglLost || helpOpen || route !== 'session') return null;
  return <Guide step={step} onClose={close} />;
}
