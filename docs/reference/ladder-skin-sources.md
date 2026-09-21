# ラダースキンの出典（Plan 4B §17.1）

`apps/desktop/src/renderer/ladder/skins/*.ts` が各メーカーの編集画面の**形と配置**を決める
ときに調べた資料の一覧（2026-09-20 に確認）。

- **画像・図記号ビットマップ・画面キャプチャは一切複製していない。** 取ったのは
  「接点は縦棒2本」「命令はボックス」のような**記述**だけである。
- 各スキンのコメントは、この表の番号を `出典: docs/reference/ladder-skin-sources.md #n`
  の形で指す。URL をソースコードに書かないのは、アプリが完全オフライン（外部へ1件も通信
  しない）であることを grep で確かめられるようにするため（Plan 4B の grep ゲート）。
- 資料と食い違うところは各スキンのコメントに `△` を付けて残してある。

| # | メーカー | 資料 | URL |
|---:|---|---|---|
| 1 | ジェイテクト | 公式 PCwin カタログ CAT-M2067-1 | `https://www.jtekt.co.jp/data/Tp/Catalog/CAT-M2067-1_PCwin.pdf` |
| 2 | 三菱電機 | e-sysnet「PLC入門」第6回（利用者が指定した参照元） | `https://e-sysnet.com/plc-6/` |
| 3 | 三菱電機 | e-sysnet「PLC入門」第7回 | `https://e-sysnet.com/plc-7/` |
| 4 | 三菱電機 | control-career「ラダー命令」 | `https://control-career.com/ladder-command/` |
| 5 | オムロン | 公式 CX-Programmer 操作マニュアル W446 | `https://files.omron.eu/downloads/manual/en/v2/w446_cx-programmer_operation_manual_en.pdf` |
| 6 | オムロン | plckouza「ST2-8」 | `https://plckouza.com/st2/st2_8.html` |
| 7 | シャープ | 公式 JW300 ラダー命令マニュアル | `https://jp.sharp/sms/pdf/plc/jw300/m_jw300l_5.pdf` |

## 各資料から取った内容

1. **ジェイテクト PCwin カタログ（#1）** — 接点は縦棒2本・b接点は斜線1本／**コイルは丸
   「○」**（括弧ではない。利用者の「出力は丸」と一致）／OR分岐は主ラインの**下の行**に
   置いて縦棒で合流／デバイス名は記号の**左上**／ステップ番号は左バスバーのすぐ左
   （例 `00049`）。
2. **e-sysnet 第6回（#2）** — 左右の母線・接点は縦棒2本・b接点は斜線1本・上から下への
   スキャン順。
3. **e-sysnet 第7回（#3）** — `END` はプログラム末尾に必須、コイルの後ろに接点を置けない。
4. **control-career（#4）** — タイマ・カウンタは `OUT T0` ＋ `T0 K300`。
5. **OMRON W446（#5）** — 左バスバーの**左側**にラング番号とステップ番号／各セルの接続点に
   グリッド／`TIM`・`CNT`・`MOV` は**オペランドボックス**（命令枠）に入る／コイルは右
   バスバーに整列／シンボル名とコメントは記号の上または下（設定）／通電中の要素は**太線**
   （色は原文に明記なし）／`END` は末尾に固定のセクション。
6. **plckouza（#6）** — 薄い罫線でセルに区切られた編集画面。
7. **シャープ JW300（#7）** — `F-40` ＝ `END` で各プログラムブロックの最終アドレスに入る／
   デバイス番号は6桁（8進表記、0〜7）／タイマ `T00000`〜`T17777`・カウンタ `C00000`〜
   `C17777`／基本命令は `STR` `STR NOT` `AND` `AND NOT` `OR` `OR NOT` `OUT`、追加命令に
   `STR POS` `STR NEG` など。

## 公式資料による再確認（2026-09-21）

画面の図・キー表・操作手順を直接確認した。下記の確認結果は上段の旧調査に優先する。メーカー資料の画像や本文は製品・リポジトリに同梱しない。

| 記号 | 公式資料・版 | 確認箇所と実装への反映 |
|---|---|---|
| S1 / S2 / S3 | [三菱電機 GX Works3 Operating Manual SH-081215ENG-AN](https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh081215eng/sh081215engan.pdf) | 印刷p51（PDF p53）のメニュー順、濃紺の左ナビゲーション、白い編集面、文書タブ、出力欄。[公式トレーニングテキスト JY997D69701-A](https://dl.mitsubishielectric.com/dl/fa/document/schooltext/school_text/jy997d69701/jy997d69701a.pdf) 3-10〜3-12のF5/F6/F7・並列接点・罫線、3-16のF4変換、3-30のF2編集も確認。最新版ATの日本語資料は会員認証が必要で、ANと区別する。 |
| S4 / S5 | [OMRON CX-Programmer Operation Manual W446-E1-23](https://files.omron.eu/downloads/latest/manual/en/w446_cx-programmer_operation_manual_en.pdf)（2023-07） | 印刷p10（PDF p58）のメニュー順、白いツリー、青いデバイス文字、紫の選択枠、黄色いラング見出し。印刷p160–162（PDF p208–210）のClassicモードのキー表。 |
| S6 | 各社比較の旧補助資料 | 最新の割当を決める根拠には使わない。 |
| S7 | [JTEKT PCwin公式カタログ CAT-M2067-1](https://www.jtekt.co.jp/data/Tp/Catalog/CAT-M2067-1_PCwin.pdf) | p2–3のメニュー、左プロジェクトツリー、青い文書タイトル、白いラダー、ステップ欄。モニタ項目の読取り誤りをJPI / DOR / MORへ訂正。 |
| S8 | [SHARP JW-300SPユーザーズマニュアル 第3版](https://jp.sharp/sms/pdf/plc/jw-300sp/m_300sp_3.pdf)（Ver1.2、2004-05） | 第2章の8メニュー、2-193（PDF p215）のキー表、3-3〜3-4（PDF p229–230）の記号先行入力、2-112のプログラムチェック、2-129〜131の各ウィンドウ。 |

### 今回訂正した操作

- OMRON: 並列b接点は **X**。Ctrl+← / Ctrl+↑は左・上への作図であり削除ではない。H / V / Uなどの別名も対応する。F2が編集、Shift+F2が読取、Ctrl+Mがモニタ切替、Ctrl+TがPLCへの転送。Ctrl+E / Ctrl+Shift+Eはオンライン編集の開始／送信であり、通常の一括転送と区別する。Classicモードを対象とし、Smart Inputの割当とは混在させない。
- SHARP: **S / D / X**でa接点・b接点・コイル。P / Nが微分接点、E / RがSET / RST、V / CがTMR / CNT、Bが応用命令、GがOR+、Lが回路追加。まず未入力の記号を置き、Enterでアドレスを入力する。複数の記号を先に配置できる。F4を三菱の変換として流用しない。検査は編集メニューのプログラムチェック。
- JTEKT: [PCwin公式操作マニュアル](https://toyoda.jtekt.co.jp/data/Tp/Torisetu/t-a35-68-n_PCwin.pdf)は認証が必要で、キー割当を確認できていない。三菱の表の流用を廃止し、未確認の専用キーは割り当てない。記号ボタン・右クリック・ダブルクリックで編集する。

### 確認範囲と訓練用の制約

メニュー順・確認済みキー・入力の順序は上記の公式資料に基づく。色の数値、フォント、ピクセル寸法はOS・テーマ・倍率で変化するため同一値を保証しない。読みやすさのため32pxの操作領域と12px以上の文字を保つ。

全ソフトの全機能を実装しているわけではない。実PLCへのオンライン接続、通信設定、機種設定、PCwinのME-NET/CADなどは訓練対象外として無効表示する。SHARPのHによる接点なし並列など、対応していない固有機能を別の操作に勝手に割り当てない。実機の命令ステップ数と、本アプリの回路行数表示は同一ではない。

`native-plc.test.tsx` が公式キー、記号先行入力、未完成回路の実行拒否を検査する。画面操作のE2Eはメーカー別の実際の入口を使い、4社すべてにF5/F7を送る旧検査は廃止した。
