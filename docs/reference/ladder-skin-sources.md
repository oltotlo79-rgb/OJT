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

## キー割当の出典 S1〜S8（Phase 7 Task 20。2026-09-20 に確認）

`DialectProfile.shortcuts` の各行が持つ `source` はこの記号を指す。キー割当表（`ShortcutHelp`）は
`出典 S1` の形で行ごとに出す。上の表（#1〜#7）は**画面の形と配置**の出典で、こちらは
**キー割当**の出典である（別物なので番号体系を分けてある）。

| 記号 | 出典 | 何が確認できたか |
|---|---|---|
| S1 | `https://ecdtejun.work/archives/972` | 三菱: `F5`/`F6`/`Shift+F5`/`Shift+F6`/`F7`/`F8`/`F9`/`Shift+F9`/`Ctrl+F9`/`Ctrl+F10` |
| S2 | `https://denkisekkeijin.com/software/gxworks2/gxworks2_base_ladder/` | 三菱: 同じ表（独立した記述）、`Shift+F7`/`Shift+F8` のパルス、回路入力ウィンドウにデバイス名を半角で打って `Enter` |
| S3 | `https://plckouza.com/st2/st2_3.html` / `st2_5.html` | 三菱: `F4`＝変換、`F2`＝書込み、`Shift+F2`＝読出し、`F3`＝モニタ、モニタ中は通電部が塗りつぶし |
| S4 | `https://plckouza.com/st2/st2_8.html` | OMRON: `C`/`/`/`O`/`I`、`Ctrl+E`、アドレス欄 `Enter` → コメント欄 `Enter`、出力の無いブロックの右端に赤線、変換の段が無い |
| S5 | `https://scrapbox.io/backman2225626-02655577/CX-Programmer` ほか個人の早見表 | OMRON: `W`（並列接点）、`Ctrl+←→`（横線）、`Ctrl+↑↓`（縦線） |
| S6 | `https://www.softech.co.jp/mm_140903_plc.htm` | 各社比較: 直列接点は三菱 `F5` / OMRON `C`、コイルは三菱 `F7` / OMRON `O` |
| S7 | `https://www.jtekt.co.jp/data/Tp/Catalog/CAT-M2067-1_PCwin.pdf` | PCwin が LD・SFC・FBD を扱うこと（画像PDFのため本文は読めない） |
| S8 | `https://jp.sharp/sms/plc/jw-300sp/jw-300sp.html` | JW-300SP: シンボル名／アドレスの2モード、行間ステートメント、マウスのドラッグ＆ドロップでの回路要素挿入、トラブルシューティング画面 |

### 確認できなかったもの

`confirmed: false` のまま `note` を付けて出す（§17.1 の方針どおり実装は止めない）。

- 三菱・OMRON の**モニタ中の通電色の具体値**（「塗りつぶし」という記述までは取れたが色名は
  取れない）。本アプリの既定（三菱=青 `#1E64FF` / OMRON=緑 `#2FA02C` / ジェイテクト=橙 /
  シャープ=水色）は**本アプリ独自**のままとする。
- 三菱の**未変換回路の灰色背景**。
- 三菱・OMRON の**既定の背景色・格子色・カーソル色・書体**（三菱は「表示→色およびフォント」で
  利用者が変えられることまでは確認できた）。
- **PCwin と JW-300SP のキー割当・入力ダイアログ・ウィンドウ構成・モニタ色は一切確認できない**。
  PCwin の公式マニュアル（`T-A35` / `T-A50`）は**ログイン必須**であることを実地で確認した。
  JW-300SP のマニュアル PDF は公開されているが 10.5MB の画像PDFで本文を機械抽出できない。
  この2方言は GX Works3風の表を流用し、`assumedTable()` が全行を `confirmed: false` ＋
  「実機マニュアル未確認のため本アプリの表記です」に落としてから出す。
- 利用者が挙げた `e-sysnet.com/plc-6`（上の表の #2）は**キー割当表ではなく「ラダー図の
  表現方法（図記号）」の解説ページ**だった。記号の形の出典としては使えるが、**キー割当の
  出典としては使えない**。
- OMRON の `Shift+W`（OR b接点）は一次資料に記載が無く、`W`（OR a接点）に合わせた
  **本アプリの割当**である。
