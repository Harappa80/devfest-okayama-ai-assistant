# ハンズオン検証記録

## 2026-10-26：uvへの移行

依存管理を `pyproject.toml`／`uv.lock` に統一し、`.python-version` は3.12としました。旧依存ファイルと互換用セットアップスクリプトは削除しました。現行の実行手順はREADMEを参照してください。

既存の仮想環境・`.env`を含めない新しいディレクトリにソースとlockfileをコピーし、uv 0.12.23／Python 3.12.14で次を実行しました。

| 確認 | 結果 |
| --- | --- |
| `uv lock --check` | lockfileと依存宣言の整合性を確認 |
| `uv sync --locked` | 新規`.venv`へ52パッケージを導入。`uv pip check`も成功 |
| `uv run --locked pytest -q` | 22件成功。`.env`作成後も成功。旧スクリプト専用の2件はスクリプトとともに削除 |
| `node tests/test_ui.cjs` | 成功 |
| Chromiumによるfixture E2E | 履歴、WAVデコード・再生、口パク、PC／モバイル表示、障害復旧を確認 |
| `uv run --locked python app.py` | 起動と終了を確認（検証用ポート8010） |
| `uv run --locked python scripts/check_connection.py --base-url http://127.0.0.1:8010` | ページ・設定・画像・OpenAPIすべて200。オウム返し200、Vertex AI TTS 200、24 kHz／3.20秒のWAV |
| 旧Flask環境の整理 | 検証用環境にFlask 3.1.2を追加後、`uv sync --locked`でFlaskと不要な依存が除去されることを確認。FastAPIのimportも成功 |
| README | Bash／Pythonコードの構文、画像リンク、旧インストール手順が残っていないことを確認 |

モックAPIテストは教材用の`.env`／`character.py`から独立させました。新しいuvコマンドでpytestを実行できるよう、テスト時のモジュール探索パスも設定しました。Starlette TestClientのhttpx移行に関する非推奨警告1件は残っています。

今回の変更は依存管理と手順の整理です。Cloud ShellでのCLI認証・Web preview操作、およびmacOS上の実行はこのLinux環境では再検証していません。

## 2026-10-24：移行前の検証履歴

以下はuv導入前に実行した検証の記録です。ここに記載された旧セットアップのコマンドは現行手順ではありません。

検証日：2026-10-24（日本時間）。実行環境はCodexのLinuxクラウド環境であり、Google Cloud Shellそのものではありません。Cloud Shellの画面操作・CLI起動を実行済みとは扱いません。

### 方法

作業ディレクトリに既存の `venv`／`.venv` があることに依存しないよう、アプリ・画像・設定テンプレート・スクリプト・テストを `/tmp` の新しいディレクトリにコピーし、新規 `.venv` を `python -m venv` で作成しました。READMEと同じ `pip install -r requirements.txt`、`.env.template` のコピー、プロジェクト設定、Uvicorn起動を実行しました。認証は接続済みSAのWorkload Identity／ADCで、APIキーは使っていません。

環境：Python 3.12.14、Node.js 24.19.0、Chromium 154、Playwright 1.64.1。Python 3.11での実行は未確認です。

### 実行結果

| 手順 | 結果・証拠 |
| --- | --- |
| 空の仮想環境で依存インストール | 成功。`pip check` は `No broken requirements found.` |
| `.env`からプロジェクトとモデルを読み込み | 成功。親プロセスのプロジェクト・モデル・APIキー環境変数を除いた状態で起動 |
| ADCによるVertex AI認証 | 既存の接続済みSAで実モデル呼び出し成功。SA作成・キー発行・IAM変更なし |
| `uvicorn app:app --reload --host 127.0.0.1 --port 8000` | 起動・再起動成功 |
| `uvicorn app:app --reload --host 0.0.0.0 --port 8000` | Cloud Shell向けと同じ起動コマンドで成功。Cloud Shellプロキシ経由のアクセスは未確認 |
| `python scripts/check_connection.py` | ページ・設定・画像・OpenAPIすべて200。会話200、TTS 200、24 kHz／4.20秒のWAVを検証 |
| 実ブラウザとVertex AIの会話 | 2往復、履歴を使った合言葉の想起、Kore→Puck切替を確認 |
| 音声再生と口パク | 実WAVをブラウザがデコードし、`currentTime`が進み、口の画像が交互に変わることを確認。停止で閉口、再開で再生を確認 |
| レイアウト | 1280×900と390×844でスクリーンショットを取得。入力・送信ボタンが画面内に収まることを検証 |
| ページ再読み込み | 履歴リセットを検証 |
| `.env`の性格変更＋再起動 | 新しいプロセスで「ワク」「にゃ」を含む実応答を確認。AoedeによるWAV生成も200 |
| `python app.py` | `PORT=8001`で起動し、上記の性格変更確認に使用 |
| サーバー終了 | SIGINTによる正常終了とポート8000が閉じることを確認 |
| Python自動テスト | 24件成功（Starlette TestClientのhttpx移行に関する非推奨警告1件）。入力検証、API指定、ADC固定、履歴分離、WAV、障害時応答、互換設定、CLI引数転送を検証 |
| NodeのUIテスト | 成功。APIエラー、文字列の安全な表示、手動再生案内を検証 |
| 実ブラウザのfixtureテスト | 成功。実DOM・音声デコード・履歴・モバイル表示・TTS 502後のテキスト保持・429後の再送可能状態を検証 |

CLI引数転送のテストには記録用スタブを使っています。これはAntigravity CLI本体の実行確認ではありません。実ブラウザによる再生の進行は確認しましたが、物理スピーカーを人が聴く確認はしていません。

### 発見して修正した点

- 前のREADMEにはCloud ShellのWebプレビュー手順がありませんでした。ポート8000での起動・プレビュー・別ターミナル・再起動・終了を含む順序に書き直しました。
- 認証をVertex AI＋ADCに固定し、APIキー設定用スクリプトを削除しました。古いAPIキー環境変数が残っていてもADCを明示指定することを自動テストしました。
- `.env`や`character.py`の変更には再起動が必要です。既存教材に合わせてADK 2.13.0と`character.py`の読み込み、Google検索を維持しました。ADKにもTTSと同じVertex AIの認証済みクライアントを渡します。
- 実ブラウザ検証で一時的な上流504を検出しました。SDKのタイムアウトを120秒、一時エラーの試行を最大2回（初回を含む）としました。外部APIの可用性は保証されません。失敗時にテキスト・再送手段を維持する処理も検証しています。
- 外部Webフォントへの依存を外し、通信制限があってもローカルフォントで表示できるようにしました。
- CLIのモデル名をAPIのモデル設定から分離し、公式headless例の `gemini-3.8-flash-medium` を既定にしました。`ANTIGRAVITY_MODEL` で変更でき、実環境の `agy models` で確認する手順を加えました。

### Cloud Shellで残る確認

次はこの環境から実行できていません。

1. Cloud Shellの実アカウントでのAPI有効化・ADC承認。既存SAでのVertex AI利用成功は、この操作の代わりにはなりません。
2. Cloud Shellにある `agy` のバージョン・モデル一覧、ADC認証、非対話プロンプトと対話CLIの実行。
3. Cloud ShellのWeb previewボタンからの表示。
4. 変更を含むブランチをリモートに反映した後の、新規GitHub cloneからの実行。今回の検証対象はローカル変更のコピーです。

このCodex環境には `agy` がなく、公式インストーラーへのHTTPS接続は環境の許可ホスト制限で403になりました。**これはCloud Shellで使えないという意味ではありません。** Googleの[Cloud Shell向けCodelab](https://codelabs.developers.google.com/sdd-agy-cli)と[CLIの公式手順](https://antigravity.google/docs/getting-started?tab=cli)を照合し、READMEは既存CLIを確認してから、なければ導入する構成にしました。

Cloud Shell上ではREADMEのステップ1〜7を実行し、特にステップ3のCLIとステップ2のWeb previewを確認してください。

### 教材との照合

作業開始時のローカルHEADより新しいリモートの教材コミット `0ef7e4a` を確認し、そのREADME・13枚の画面例・出典一覧を取り込みました。性格変更・Google検索・アバター差し替えの学習段階を保持しています。APIキー用の設定画面は現行手順から除外し、過去の参考画像としてファイルを保存しています。リポジトリがprivateであるため、参加者のGitHub認証とアクセス権がcloneの前提になることも追記しました。

### 教材の段階ごとの追加実行

- `COMPANION_MODE=echo`、`character.py`なし：完全一致のオウム返し200、Vertex TTSは24 kHz／1.04秒のWAV。
- `examples/character_basic.py`を`character.py`へコピーして再起動：ADKで2往復とも会話200／TTS 200。1回目は209,308 bytes／4.20秒、2回目は80,668 bytes／1.52秒。履歴から合言葉を想起し、Kore→Puck、停止・再開、口パク、PC／モバイル表示を実ブラウザで確認。
- `examples/character_search.py`で別プロセスを起動：Vertex AI経由のGoogle検索が200。公式Cloud Shellドキュメントを出典とする1件のgrounding sourceとGoogle Search候補HTMLを取得。「にゃ」を含む性格変更後の応答も確認。
- 画像差し替え：既存の2枚のPNGを教材の`Gemini_Generated_Image_close.png`／`open.png`へ複製し、READMEの3箇所を変更。実ブラウザで新しいパスの交互表示と停止時の閉口を確認。新しい絵を生成する外部アプリ操作は未実行で、教材の「用意した画像でも進める」経路を使用。
- 検索UI：上で実際に取得したgroundingのJSONと生成済みWAVをブラウザへ再生し、出典リンクとsandbox付きGoogle Search候補の表示を確認。このUI確認でモデルを再度呼び出してはいません。

最終の空の仮想環境にもADKを含む依存関係を再インストールし、`pip check`とPythonテスト24件を実行しました。
