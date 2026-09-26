import { DIALECT_IDS, type DialectId } from '@ojt/plc-dialects';
import { useEffect, useRef, useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { pushModalLayer } from '../session/interaction.js';
import catalog from '../public/tutorials/catalog.json';
import styles from './tutorial-video.module.css';

export const TUTORIALS = {
  assemble: {
    title: '回路組立',
    file: 'assembly',
    problem: 'B-001 自己保持回路',
    topic: '動作の読み取り、配線、間違いの修正、判定まで',
  },
  'inspect-parts': {
    title: '部品点検',
    file: 'parts',
    problem: 'C1-001 部品の良否判定',
    topic: '抵抗・接点を測り、測定の根拠から解答する',
  },
  'inspect-repair': {
    title: '回路点検・修復',
    file: 'repair',
    problem: 'C2-001 回路の断線診断',
    topic: '電圧を測って故障を絞り込み、指摘・修復する',
  },
  plc: {
    title: 'PLC',
    file: 'plc',
    problem: 'D-001 自己保持回路',
    topic: '電源とI/Oの配線、ラダー入力、動作確認、判定まで',
  },
} as const;
export type TutorialMode = keyof typeof TUTORIALS;
type TutorialFile = keyof typeof catalog;

/**
 * PLCの動画はメーカーごとに1本ずつある（2026-09-26 利用者指示「他メーカーのPLCでも同様に
 * チュートリアルの動画を作成して（他メーカーのシーケンサーでは配線も変わるため）」）。
 * 端子名・デバイスの書き方・記号の置き方がメーカーで違うので、いま使っているメーカーの
 * 動画を開き、動画の画面でもほかのメーカーへ切り替えられるようにする。
 */
export const PLC_TUTORIALS: Readonly<Record<DialectId, { file: TutorialFile; label: string }>> = {
  mitsubishi: { file: 'plc', label: '三菱電機 FX5U' },
  jtekt: { file: 'plc-jtekt', label: 'JTEKT PC10G' },
  omron: { file: 'plc-omron', label: 'OMRON CP1E' },
  sharp: { file: 'plc-sharp', label: 'シャープ JW300' },
};

/** 開く動画のファイル名（PLCはメーカーで選ぶ）。 */
export function tutorialFile(mode: TutorialMode, vendor: DialectId): TutorialFile {
  return mode === 'plc' ? PLC_TUTORIALS[vendor].file : TUTORIALS[mode].file;
}

function durationLabel(file: TutorialFile): string {
  const seconds = Math.ceil(catalog[file].durationSec);
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}

/** いまのメーカー（課題を開いていればその方言、ホームでは設定の既定メーカー）。 */
function useCurrentVendor(): DialectId {
  return useStore((s) => (s.route === 'session' ? s.dialectId : s.defaultVendor));
}

function Player({
  mode,
  initialVendor,
  onClose,
}: {
  mode: TutorialMode;
  initialVendor: DialectId;
  onClose: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const [vendor, setVendor] = useState<DialectId>(initialVendor);
  const item = TUTORIALS[mode];
  const file = tutorialFile(mode, vendor);
  const title = mode === 'plc' ? `${item.title}（${PLC_TUTORIALS[vendor].label}）` : item.title;
  useEffect(() => {
    const target = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const layer = pushModalLayer();
    target?.showModal();
    return () => {
      target?.close();
      layer.release();
      opener?.focus();
    };
  }, []);
  const source = new URL(`./tutorials/${file}.webm`, document.baseURI).href;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onCancel={onClose}
      onKeyDown={(event) => {
        // 動画の操作キーを、背後の編集画面やF1ヘルプへ渡さない。
        event.stopPropagation();
        if (event.key === 'F1') event.preventDefault();
      }}
      aria-labelledby="tutorial-title"
      data-testid="tutorial-player"
    >
      <header className={styles.header}>
        <div>
          <h2 id="tutorial-title">{title}：課題を解く動画</h2>
          <p>
            {item.problem} — {durationLabel(file)} — {item.topic}
          </p>
          {mode === 'plc' ? (
            <div className={styles.vendors} role="group" aria-label="メーカーを選ぶ">
              <span>メーカー:</span>
              {DIALECT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === vendor}
                  data-testid={`tutorial-vendor-${id}`}
                  onClick={() => {
                    setVendor(id);
                    setError(false);
                  }}
                >
                  {PLC_TUTORIALS[id].label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={onClose} autoFocus>
          動画を閉じる
        </button>
      </header>
      {/* メーカーを切り替えたら読み込み直す（`key` が変わると要素ごと作り直す） */}
      <video
        key={file}
        ref={video}
        className={styles.video}
        controls
        preload="metadata"
        playsInline
        onError={() => setError(true)}
        aria-label={`${title}の解答操作動画`}
      >
        <source src={source} type="video/webm" />
        <track
          kind="captions"
          src={new URL(`./tutorials/${file}.vtt`, document.baseURI).href}
          srcLang="ja"
          label="操作の説明（日本語）"
        />
      </video>
      {error && (
        <p role="alert">
          動画を読み込めませんでした。配布ファイル一式を確認し、アプリを起動し直してください。
        </p>
      )}
      <footer className={styles.footer}>
        <p>
          ポインターと吹き出しで、操作の場所と理由を確認できます。音声なし・オフラインで再生できます。
        </p>
        <label>
          再生速度{' '}
          <select
            aria-label="動画の再生速度"
            defaultValue="1"
            onChange={(event) => {
              if (video.current) video.current.playbackRate = Number(event.target.value);
            }}
          >
            <option value="0.75">0.75倍</option>
            <option value="1">1倍（標準）</option>
            <option value="1.25">1.25倍</option>
            <option value="1.5">1.5倍</option>
          </select>
        </label>
      </footer>
    </dialog>
  );
}

export function TutorialVideoButton({ mode }: { mode: TutorialMode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const vendor = useCurrentVendor();
  const example =
    mode === 'plc'
      ? `${TUTORIALS[mode].problem}（${PLC_TUTORIALS[vendor].label}）`
      : TUTORIALS[mode].problem;
  return (
    <>
      <button
        type="button"
        data-testid={`tutorial-${mode}`}
        onClick={() => setOpen(true)}
        title={`${example}の操作例です。選択中の課題と異なる場合があります。`}
      >
        ▶ 基本例題の動画（{TUTORIALS[mode].problem.split(' ')[0]}）
      </button>
      {open && <Player mode={mode} initialVendor={vendor} onClose={() => setOpen(false)} />}
    </>
  );
}
export function TutorialLibrary(): JSX.Element {
  return (
    <section className={styles.library} aria-labelledby="tutorial-library-title">
      <h2 id="tutorial-library-title">動画で操作を学ぶ</h2>
      <div className={styles.grid}>
        {(Object.keys(TUTORIALS) as TutorialMode[]).map((mode) => (
          <article key={mode}>
            <h3>{TUTORIALS[mode].title}</h3>
            <p>{TUTORIALS[mode].problem}</p>
            <p>{TUTORIALS[mode].topic}</p>
            <p>
              {mode === 'plc'
                ? `4メーカー分・各${durationLabel(PLC_TUTORIALS.mitsubishi.file)}前後・音声なし`
                : `${durationLabel(TUTORIALS[mode].file)}・音声なし`}
            </p>
            <TutorialVideoButton mode={mode} />
          </article>
        ))}
      </div>
    </section>
  );
}
