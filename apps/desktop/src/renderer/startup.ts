/** Reactや3Dを読み込む前に、静的HTMLの起動表示を1フレーム描く。 */
const loading = document.getElementById('startup');
const startupStatus = document.getElementById('startup-status');
const detail = document.getElementById('startup-detail');
const retry = document.getElementById('startup-retry');
const indicator = document.getElementById('startup-indicator');

retry?.addEventListener('click', () => window.location.reload());
const slow = window.setTimeout(() => {
  if (detail)
    detail.textContent =
      '準備に時間がかかっています。そのままお待ちいただくか、再読み込みしてください。';
  if (retry) retry.hidden = false;
}, 15_000);

requestAnimationFrame(() => {
  // rAFの中で重いモジュールを評価すると同じフレームの描画を妨げるため次のタスクへ。
  setTimeout(() => {
    performance.mark('ojt-startup-loading');
    void import('./main.js')
      .then(({ mountApp }) => {
        if (window.ojt === undefined) throw new Error('アプリの初期化に失敗しました');
        return mountApp();
      })
      .then(() => {
        clearTimeout(slow);
        performance.mark('ojt-home-ready');
        loading?.remove();
        document.getElementById('root')?.removeAttribute('aria-busy');
      })
      .catch(() => {
        clearTimeout(slow);
        if (startupStatus) startupStatus.textContent = '画面を読み込めませんでした';
        if (detail)
          detail.textContent =
            '再読み込みをお試しください。改善しない場合はアプリを閉じて、もう一度起動してください。';
        if (retry) retry.hidden = false;
        if (indicator) indicator.hidden = true;
      });
  }, 0);
});

export {};
