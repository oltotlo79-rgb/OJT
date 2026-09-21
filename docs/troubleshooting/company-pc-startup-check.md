# 会社 PC で起動しないときの確認手順（v1.0.0 ポータブル版）

作成日: 2026-09-21。対象: 会社 PC に GitHub Release の `DenkiKyoikuTool-1.0.0-x64.zip` を展開して `電気教育ツール.exe` を起動したが、何も表示されずに消えたケース。

## 0. 前提

- v1.0.0 はコード署名なし。SmartScreen の「Windows によって PC が保護されました」は README のとおり「詳細情報 → 実行」で回避できるが、今回はメッセージなしで消えたので別原因の可能性が高い。
- アプリ側には起動失敗時のログ出力・エラーダイアログがない（v1.0.0 時点）。そのため Windows 側の記録で切り分ける。
- 会社 PC で試したこと・出た表示・時刻をメモしておく（情シスへの照会に使う）。

## 1. 展開方法の確認（最初に確認する）

- zip を右クリック →「すべて展開」→ 展開先フォルダの中の `電気教育ツール.exe` をダブルクリック。
- エクスプローラーの zip プレビュー内から直接 exe をダブルクリックしていないか。この場合 DLL や `resources/` が揃わず、一瞬で消える。
- 展開先はユーザーのドキュメント配下など普通のフォルダでよい（日本語パス可）。%TEMP% や OneDrive 同期フォルダは避ける。
- zip のプロパティに「ブロックの解除」チェックがあればオンにしてから展開する（ダウンロードの印 MOTW を外す。SmartScreen には効くが、AppLocker やウイルス対策には効かない）。

## 2. ウイルス対策（Microsoft Defender）の隔離記録

- Windows セキュリティ → ウイルスと脅威の防止 → 保護の履歴 → フィルターで「隔離済み」を表示。履歴はしばらくすると消えるので早めに確認する。
- 展開先フォルダから `電気教育ツール.exe` が消えていないか確認する。消えていれば隔離の可能性が高い。
- PowerShell（管理者権限不要）:

```powershell
Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 10
Get-MpThreat
```

- 検出名が `Trojan:Win32/Wacatac.*!ml` や `Program:Win32/Wacapew.C!ml` のように末尾 `!ml` のものは機械学習ヒューリスティックで、未署名の Electron アプリで誤検知が頻発するパターン。

## 3. イベントビューアーで確認

Win+R → `eventvwr.msc`。実行した時刻の前後 1〜2 分に絞って探す。

| ログの場所 | イベント ID | 意味 | 該当したら |
|---|---|---|---|
| アプリケーションとサービス ログ → Microsoft → Windows → Windows Defender → Operational | 1116 | 脅威を検出 | 5-A |
| 同上 | 1117 | 処置を実施（Action が Quarantine / Remove なら隔離確定。No Action / Allowed なら隔離されていない） | 5-A |
| 同 → CodeIntegrity → Operational | 3077 | WDAC（App Control for Business）による実行ブロック | 5-C |
| 同 → AppLocker → EXE and DLL | 8004 | AppLocker による実行ブロック（通常はブロックのダイアログが出る） | 5-C |
| Windows ログ → Application | 1000 / 1001 | アプリ自体のクラッシュ（署名とは無関係） | 5-D |

- 上記のどれにも記録がなく exe だけ消えている場合は、他社製 EDR（CrowdStrike、SentinelOne、Trend Micro Apex One、Sophos、ESET など）の可能性が高い。これらはローカルに記録を残さず情シスのコンソールにだけ通知することが多い → 5-B。

## 4. 追加の切り分け（任意）

コマンドプロンプトから起動して終了コードとログを見る。

```bat
cd /d <展開先フォルダ>
"電気教育ツール.exe" --enable-logging=file --log-file=%USERPROFILE%\Desktop\denki-startup.log
echo %ERRORLEVEL%
```

- ログファイルが作られない／空 → プロセスが動き出す前に止められている（ウイルス対策・AppLocker・WDAC の可能性が高い）。
- ログに Chromium のエラーが出る → アプリ側のクラッシュ。内容を控えて 5-D。
- 画面が出ないが GPU 関連のエラーがある場合は `--disable-gpu` を付けて再試行する。

## 5. 原因別の対処

### 5-A. Defender に隔離された

- 情シスに「ファイルハッシュの許可」を依頼する（Defender for Endpoint なら Microsoft Defender ポータル → 設定 → エンドポイント → インジケーター → ファイルハッシュ → 許可）。
- 自分でできる無料の対処: Microsoft の誤検知申請 https://www.microsoft.com/en-us/wdsi/filesubmission に「Software developer」として zip を送る（上限 500 MB、通常数日で反映）。ただし社内の Defender ポリシーが優先されるので、情シス依頼と併用する。

### 5-B. 他社製 EDR に止められた

- 情シスにファイル名・SHA256・実行時刻・PC 名を伝え、隔離の有無の確認とハッシュ許可を依頼する（6 のテンプレ）。

### 5-C. AppLocker / WDAC でブロックされた

- 情シスにルール追加（ハッシュ／パス／発行者）を依頼する。署名がないので発行者ルールは作れない。
- AppLocker の既定ルールは Program Files と Windows 配下しか許可しない。ポータブル版の展開先も、インストーラ版の既定インストール先（ユーザー単位: `%LOCALAPPDATA%\Programs\電気教育ツール`）も対象外なので、パスルールで通す場合は管理者権限で Program Files 配下にインストールする必要がある。

### 5-D. アプリ自体がクラッシュした

- イベント 1000 の例外コード・障害モジュール名、4 のログを控えて開発側に共有する。

## 6. 情シスへの照会テンプレ

```
件名: 社内教育ツール（電気教育ツール v1.0.0）の起動ブロックについて確認依頼

以下のファイルを実行したところ、メッセージなしで終了しました。
ウイルス対策／EDR による隔離・ブロックの有無をご確認いただき、
問題なければハッシュ許可（または実行許可）をお願いします。

- ファイル名: 電気教育ツール.exe（DenkiKyoikuTool-1.0.0-x64.zip を展開したもの）
- zip の SHA256: D8DDC7AA4336B78212E0109812659B844236A8091BA6A93FE1833D98067CCA0F
- exe の SHA256: <certutil -hashfile "電気教育ツール.exe" SHA256 の結果>
- 実行日時: yyyy-mm-dd hh:mm
- PC 名: 
- 用途: 新入社員向けの社内教育ツール。オフラインで動作し、外部通信は行いません。
- 配布元: 社内開発（GitHub の非公開リポジトリからのリリース）
```

exe の SHA256 は展開先で次を実行して求める。

```bat
certutil -hashfile "電気教育ツール.exe" SHA256
```

参考: インストーラ版 `DenkiKyoikuTool-1.0.0-x64.exe` の SHA256 は `A9DDB0827DDADE5C031E404AB0927441CB86169F9FE9DA97D4B9120CD9F9966D`（`docs/releases/v1.0.0.md` に記載）。

## 7. コード署名についての結論（2026-09-21 調査）

- 無料の公的コード署名サービスは本プロジェクトには該当しない。SignPath Foundation は公開 OSS（OSI ライセンス + CI ビルド）限定で、本リポジトリは非公開かつライセンス未宣言。Certum の OSS 向け証明書も OSS 限定で有料。Sigstore は Windows の Authenticode ではないので使えない。
- 有料なら会社名義の Azure Trusted Signing（Basic 月額約 9.99 米ドル）が最安。日本在住の個人は登録不可で、法人登録が必要。
- 署名しても SmartScreen は評判が溜まるまで警告が出る（2024 年以降 OV / EV とも即時解除はない）。AppLocker / WDAC / EDR は情シスのルール追加が必要で、署名だけでは通らない。ウイルス対策の誤検知は署名で減るが、なくなる保証はない。
- 社内限定で使うなら、自己署名または社内 CA の証明書で署名し、情シスが GPO で「信頼されたルート証明機関」「信頼された発行元」に配布するのが無料の現実解。ただしウイルス対策の隔離には無関係。

## 8. 会社 PC でリポジトリをクローンしてビルドする案

署名の問題は解決しない（ビルドしても未署名のまま）。効くかどうかはブロックの種類次第。

| ブロックの種類 | ローカルビルドで通るか |
|---|---|
| SmartScreen / MOTW | 通る（ローカル生成物にはダウンロードの印が付かない） |
| ハッシュ単位のブロック、「ダウンロード由来の exe」を条件にした EDR ルール | 通る可能性あり（ハッシュと由来が変わる） |
| 機械学習ヒューリスティック（Wacatac 等） | 通らない可能性が高い（中身が同じなので判定も同じ） |
| AppLocker / WDAC | 通らない（ユーザー書き込み可能フォルダからの実行は同じ） |

- 最も見込みがあるのは開発モードで動かす方法。`pnpm --filter @ojt/desktop dev` は `node_modules/electron/dist/electron.exe`（改変していない素の Electron 本体）で起動するので、広く流通していて評判のあるバイナリで動かせる。ただし AppLocker / WDAC 環境では同様にブロックされる。
- 必要なもの: Git、Node.js 22 以上、pnpm 11.2.2（`corepack enable` で入る）、非公開リポジトリへのアクセス権、初回 `pnpm install` 時の npm レジストリと GitHub Releases へのアクセス（Electron 44.3.0 本体 約 100 MB 超を `%LOCALAPPDATA%\electron\Cache` に取得）、`dist` 初回の electron-builder ヘルパー取得（`%LOCALAPPDATA%\electron-builder\Cache`）。
- 会社のプロキシで GitHub のダウンロードが塞がれていると `pnpm install` が失敗する。自宅 PC の上記キャッシュフォルダを持ち込むか、`ELECTRON_MIRROR` を社内ミラーに向ければ回避できる。install 後は dev も dist も完全オフラインで動く（ネイティブモジュールなし、マニュアル PDF も Electron 自身で生成）。
- 管理者権限がなくても Node.js の zip 版と Git の portable 版で可能だが、会社の開発ツール持ち込みルールを先に確認する。
- 手順:

```bat
git clone https://github.com/oltotlo79-rgb/OJT.git
cd OJT
corepack enable
pnpm install
pnpm --filter @ojt/desktop dev
```

配布用に固めるときは `pnpm --filter @ojt/desktop dist` で `apps/desktop/release/` に zip とインストーラができる。

## 9. 開発側の今後の課題（未着手）

- 起動失敗時のログ出力・エラーダイアログを主プロセスに追加する。
- README とマニュアルにウイルス対策による隔離と「一瞬で消える」症状のトラブルシュートを追記する。
