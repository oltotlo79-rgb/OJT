# 配布ツールの補修

`app-builder-lib@26.15.3.patch` は、固定している26.15.3のポータブル版の生成だけを補修する。

- `unpackDirName: false` が、[公式の説明](https://www.electron.build/docs/api/app-builder-lib.interface.portableoptions/#unpackdirname)どおり起動ごとの `$PLUGINSDIR/app` を使うようにする。元の条件式はfalseでもビルド単位の固定名を定義していた。
- Electronの終了直後にGPU等のプロセスが実行ファイルやDLLを解放するまで、NSISが自分の展開先の削除を250ms間隔・最大240回（60秒）だけ再試行する。ほかの起動や利用者のファイルには触れない。

v1.3.0の配布物検査で、10秒の再試行後にもEXEだけが残る事例を検出した。13秒間削除を拒否するWindowsの読取ハンドルを保持する実物検査を追加し、旧版では失敗、新版では解放を待って片付けることを確認する。検査側も製品の60秒の待機を途中で打ち切らない。

根拠: [NSIS RMDirの削除失敗とエラーフラグ](https://nsis.sourceforge.io/Reference/RMDir)、[Windows FileShareのDelete許可](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare)。

pnpmのpatchedDependenciesとlockfileで適用を固定する。依存を更新するときは、補修を黙って捨てず、`e2e:packaged` で起動ごとの展開先の違い・同時起動・片方を閉じた後の課題表示・全展開物の削除を実際のEXEで確認する。
