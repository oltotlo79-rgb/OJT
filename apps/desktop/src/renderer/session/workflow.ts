/** 手順から目的の道具へ移る。画面の更新を待ち、折り畳みを開いてキーボード操作も引き継ぐ。 */
export function focusWorkPanel(testId: string): void {
  requestAnimationFrame(() => {
    const panel = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!panel) return;
    const details = panel.querySelector('details');
    if (details) details.open = true;
    panel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const target = panel.matches('button, input, select')
      ? panel
      : panel.querySelector<HTMLElement>('summary, button, input, select');
    target?.focus({ preventScroll: true });
  });
}
