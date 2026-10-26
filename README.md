# DevFest Okayama：自分だけの AI アシスタントを作ろう

キャラクターと会話できる Web アプリを、Antigravity CLI に手伝ってもらいながら作るハンズオンです。ブラウザーで操作できる **Cloud Shell** を使います。手元のパソコンへの Python のインストールは不要です。

最初は、入力した言葉をそのまま返すサンプルから始めます。順番に進めると、好きな性格・口調で返答し、Google 検索を使い、自分で作ったアバターが話すアプリになります。

## 進め方

1. [準備する](#step-1)：Vertex AIとADCを設定し、Cloud Shellを開く
2. [サンプルを動かす](#step-2)：コードを取得し、ブラウザーで表示する
3. [AI と会話できるようにする](#step-3)：Antigravity CLI で `character.py` を作る
4. [性格と口調を変える](#step-4)：自分だけのキャラクターにする
5. [Google 検索を追加する](#step-5)：最近の情報を調べられるようにする
6. [アバターを変える](#step-6)：口を開いた画像と閉じた画像を用意する
7. [終了・再開する](#step-7)

困ったときは、末尾の [うまく動かないとき](#troubleshooting) を参照してください。

### 用意するもの

- インターネットに接続できるパソコン
- Google Chrome（音声の読み上げを確認するために使います）
- Google アカウント。資料と同じく、個人のアカウントで進めることをおすすめします
- 音声を確認できるイヤホンまたはスピーカー

Cloud ShellにGoogle Cloudの利用権限を持つアカウントでログインします。画像生成でGeminiアプリを使う場合は、利用可能なアカウントで開いてください。

会話・音声・Google検索はVertex AIから利用します。課金が有効なプロジェクトを用意し、[Vertex AIの料金](https://cloud.google.com/vertex-ai/generative-ai/pricing)を確認してください。会話は `gemini-3.8-flash`、音声は `gemini-3.8-flash-tts` です。

### コマンドと指示文の違い

この README では、操作する場所を各手順に書いています。

| 操作する場所             | 入力するもの                                       |
| ------------------------ | -------------------------------------------------- |
| Cloud Shell のターミナル | `cd` や `python` で始まるコマンド                  |
| Antigravity CLI の入力欄      | 「ファイルを作成してください」など、日本語の指示文 |
| Cloud Shell エディター   | Python のコードや `.env` の設定                    |
| アプリのプレビュー画面   | キャラクターに話しかける文章                       |

ターミナルのコマンドは、コード枠の中身を **1 行ずつ貼り付けて Enter** で実行してください。コマンドの前に `$` を付ける必要はありません。

画面例は元のハンズオン資料から抜粋しています。画像内に旧CLIの画面、旧フォルダー名 `bwai-nara-companion-python` や以前のモデル名・ポート番号が写っている場合があります。**入力する値やコマンドは、この README の本文に従ってください。** ボタンやファイルの位置を探すときに画像を使います。

<a id="step-1"></a>

## 1. 準備する

### 1-1. Vertex AIとADCを準備する

[Google Cloud Console](https://console.cloud.google.com/)で課金が有効なプロジェクトを選択し、次の1-2でCloud Shellを開いてから実行します。

```bash
export GOOGLE_CLOUD_PROJECT='自分のプロジェクトID'
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud services enable aiplatform.googleapis.com --project "$GOOGLE_CLOUD_PROJECT"
export GOOGLE_CLOUD_LOCATION=global
export AGY_ADC_AUTH=true
```

Cloud Shellではログイン済みユーザーのADCを使います。承認画面が出たら承認してください。APIキーは使用しません。実行者には利用するプロジェクトの `roles/aiplatform.user` と、クォータプロジェクトの `roles/serviceusage.serviceUsageConsumer` が必要です。API有効化には `serviceusage.services.enable` 権限が必要です。既に有効な場合は有効化を省略できます。

既存のSA／Workload Identityを接続した環境では、そのADCを使います。SAキーは発行しません。ローカル開発でSAを偽装する場合のみ、実行者に対象SAの `roles/iam.serviceAccountTokenCreator` を付け、次を実行します。

```bash
# Cloud Shellの通常手順では不要。SAを偽装する場合のみ。
gcloud auth application-default login --impersonate-service-account=YOUR_SA@YOUR_PROJECT.iam.gserviceaccount.com
```

[Cloud ShellのADC](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)も参照してください。

### 1-2. Cloud Shell を開く

1. Chrome の別のタブで [Cloud Shell](https://shell.cloud.google.com/) を開きます。
2. Google アカウントでログインします。
3. 初回の説明や承認画面が表示された場合は、内容を確認して進みます。
4. 画面下部のターミナルに、文字を入力できる状態になるまで待ちます。

承認を求められた場合の画面例です。右下の「承認」から進みます。

![Cloud Shell が認証情報を使用するための承認画面。右下に「承認」があります。](docs/images/cloud-shell-authorize.png)

ターミナルは、コマンドを入力して操作する画面です。ここから先のコマンドは、**手元のパソコンのターミナルではなく、Cloud Shell のターミナル**に入力します。

Python環境と依存関係は [uv](https://docs.astral.sh/uv/) で管理します。まず `uv --version` を確認します。uvが未導入なら、macOS／Linux用の[公式インストーラー](https://docs.astral.sh/uv/getting-started/installation/)で導入します。

```bash
curl -LsSf https://astral.sh/uv/install.sh -o /tmp/uv-install.sh
sh /tmp/uv-install.sh
export PATH="$HOME/.local/bin:$PATH"
uv --version
```

リポジトリの `.python-version` でPython 3.12を指定しています。必要なPythonと専用環境はuvが用意するため、別途Pythonをインストールする操作は不要です。

<a id="step-2"></a>

## 2. サンプルを動かす

### 2-1. コードを取得する

このリポジトリがprivateの場合、参加者にはGitHub上のアクセス権が必要です。GitHubへの認証はCloud ShellのGoogle認証とは別です。未設定の場合は `gh auth login --hostname github.com --git-protocol https --web` → `gh auth setup-git` を実行してからcloneします。アクセス権がない場合は講師に配布用ブランチ／アーカイブを確認してください。

**操作場所：** Cloud Shell のターミナル。

次のコマンドを順番に実行します。

```bash
cd ~
git clone https://github.com/Harappa80/devfest-okayama-ai-assistant.git
cd ~/devfest-okayama-ai-assistant
```

`git clone` は、GitHub にあるコードを Cloud Shell にコピーする操作です。`cd` は、作業するフォルダーを移動する操作です。

続けて、ファイルを確認します。

```bash
ls
```

`app.py`、`pyproject.toml`、`static`、`templates` などが表示されれば成功です。**この時点で `character.py` がないのは正常です。この後の手順で作成します。**

### 2-2. Python の実行環境を作る

同じターミナルで実行します。

```bash
uv sync --locked
```

uvが `.venv` を作り、`uv.lock` に記録されたバージョンの依存パッケージと開発用テストツールをインストールします。仮想環境を手動で有効化する操作は不要です。以降のPythonコマンドは `uv run --locked` を付けて実行します。

インストールがエラーなく完了してから次に進みます。既存チェックアウトを更新する場合も、`git pull --ff-only origin main` の後に `uv sync --locked` を実行してください。

### 2-3. Vertex AIの設定ファイルを作る

初回だけ実行します。再実行すると設定を上書きするため、再開時はコピー不要です。

```bash
cp .env.template .env
chmod 600 .env
uv run --locked python - <<'PYTHON'
import os
from dotenv import set_key
project = os.environ.get('GOOGLE_CLOUD_PROJECT', '')
if not project or project == '自分のプロジェクトID':
    raise SystemExit('先に実際のGOOGLE_CLOUD_PROJECTを設定してください')
set_key('.env', 'GOOGLE_CLOUD_PROJECT', project)
PYTHON
```

Cloud Shellエディターで `.env` を開き、プロジェクトIDと `GOOGLE_CLOUD_LOCATION=global` を確認します。モデル名、TTSの声 `Kore`、最初のオウム返し用の `COMPANION_MODE=echo` はひな形のままです。設定はVertex AI＋ADCのみです。

![Cloud Shellエディターでフォルダーを開く位置](docs/images/cloud-shell-open-folder.png)

既存の環境変数は `.env` より優先されます。`.env` の変更後はサーバーを再起動してください。

### 2-4. Web サーバーを起動する

**操作場所：** 先ほどのターミナル。ここから「ターミナル 1」と呼びます。

次のコマンドを実行します。以降も、起動には同じコマンドを使います。

```bash
uv run --locked uvicorn app:app --host 0.0.0.0 --port 8000
```

`Uvicorn running on http://0.0.0.0:8000` と `Application startup complete.`が表示されれば成功です。

サーバーが動いている間、このターミナルにはアクセスログが表示されます。**入力待ちに戻らないのは正常です。そのまま起動しておきます。**

このコマンドはFastAPIアプリをポート8000で起動します。最初の画面は入力をオウム返ししますが、読み上げは最初からVertex AIのGemini TTSを利用します。

### 2-5. ブラウザーで表示する

1. Cloud Shell の上部にある「ウェブでプレビュー（Web Preview）」を押します。
2. 「ポート 8000 でプレビュー（Preview on port 8000）」を選びます。
3. 別のタブに、キャラクターと入力欄が表示されることを確認します。

Cloud Shell 全体の画面例です。右上にある、青いターミナルアイコンの右隣の「ウェブでプレビュー」アイコンからメニューを開きます。下部の黒い領域がターミナルです。

![Cloud Shell の画面例。右上にプレビューのアイコン、下部にターミナルがあります。](docs/images/cloud-shell-overview.png)

別のポートが選ばれている場合は、「ポートを変更（Change port）」で `8000` を指定します。ターミナルに表示される `127.0.0.1` のリンクを直接開くのではなく、**Cloud Shell のプレビュー機能から開いてください**。[プレビューの公式手順](https://docs.cloud.google.com/shell/docs/using-web-preview)

### 2-6. 最初の動作を確認する

**操作場所：** アプリのプレビュー画面。

現在の画面は白ベースで、中央に大きなキャラクター、その下に返答の吹き出しと入力欄があります。入力欄の下段左側でGemini TTSの声を選び、右側の矢印で送信します。以下は配置の参考となる旧画面です。

入力はテキストのみです。マイク入力・音声認識は使いません。「読み上げ」の選択欄は、キャラクターが返答する声を切り替えるものです。

[Gemini TTSの標準音声30種類](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/overview#prebuilt-voices)をアルファベット順に表示します。初期値は `Kore` で、`.env` の `GEMINI_TTS_VOICE` から変更できます。

Vertex AIに保存したカスタム音声を使う場合は、`.env` の `GEMINI_TTS_VOICE` をその音声ID（`voice_...`）に変更し、`GEMINI_TTS_VOICE_NAME=アニメキャラ` のように表示名を設定してください。アプリを再起動してページを再読み込みすると、標準30音声に追加され、初期選択になります。表示名を省略すると「カスタム音声」と表示します。

音声一覧はアプリの設定を `/config` から読み込んで表示します。Vertex AIに保存しただけでは自動追加されません。`GOOGLE_CLOUD_PROJECT` と `GOOGLE_CLOUD_LOCATION` は音声を保存したプロジェクト・ロケーションに合わせ、その音声を利用できるADCで起動してください。

![黒猫のキャラクターと、音声選択欄・入力欄・送信ボタンがあるアプリの初期画面](docs/images/app-start.png)

1. 音声の選択欄で `Kore` を選びます。日本語の文章は日本語で読み上げます。
2. 入力欄に「こんにちは！」と入力します。
3. 右側の送信ボタンを押します。Enter でも送信できます。改行は Shift+Enter です。

**入力した「こんにちは！」がそのまま表示され、音声が流れ、口が動けば成功です。** 会話モデルはまだ使わず、オウム返しをGemini TTSで読み上げます。通常は自動で再生します。ブラウザーが自動再生をブロックした場合だけ「音声を再生」ボタンが出るので、押して再生してください。

再生中はキャラクターの口と周囲のリング・音声マークが動き、再生が終わると元に戻ります。

音声の選択欄が空の場合は、先に [音声に関する対処方法](#voice-trouble) を確認してください。

確認できたら、ターミナル 1 に戻り、`Ctrl+C` でサーバーを止めます。Mac でも、サーバーを止める操作は `Control+C` です。

<a id="step-3"></a>

## 3. AI と会話できるようにする

### 3-1. ターミナルをもう 1 つ開く

Cloud Shell のターミナル付近にある `＋` から、新しいターミナルを追加します。ここからは、次のように使い分けます。

下の画面例では、`cloudshell` タブの右隣にある `＋` が追加ボタンです。

![Cloud Shell のターミナルタブの右隣にあるプラスボタン](docs/images/cloud-shell-new-terminal.png)

| ターミナル   | 役割                                   | 入力するもの                    |
| ------------ | -------------------------------------- | ------------------------------- |
| ターミナル 1 | Web サーバーの起動・停止、エラーの確認 | Python の起動コマンド、`Ctrl+C` |
| ターミナル 2 | Antigravity CLI に開発を依頼する            | 日本語の指示文                  |

**ターミナル 2** で、次のコマンドを実行します。新しいターミナルでも、作業フォルダーに移動して依存関係を確認します。

```bash
cd ~/devfest-okayama-ai-assistant
uv sync --locked
```

Cloud Shellでは、まず既存のCLIを確認します。

```bash
export PATH="$HOME/.local/bin:$PATH"
agy --version
agy models
```

`command not found` の場合のみ[公式インストール手順](https://antigravity.google/docs/getting-started?tab=cli)に従います。

```bash
curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/antigravity-install.sh
bash /tmp/antigravity-install.sh
export PATH="$HOME/.local/bin:$PATH"
agy --version
```

新しいターミナルでもプロジェクト・リージョン・ADC認証を設定してからCLIを起動します。

```bash
export GOOGLE_CLOUD_PROJECT='自分のプロジェクトID'
export GOOGLE_CLOUD_LOCATION=global
export AGY_ADC_AUTH=true
bash scripts/antigravity.sh -p 'ファイルを変更せず、このリポジトリの構成を日本語で簡潔に説明してください。' --output-format json
bash scripts/antigravity.sh
```

コード説明が出ることを確認します。スクリプトの既定モデルはCLI側のID `gemini-3.8-flash-medium` です。`agy models` で確認し、環境でIDが異なる場合は `ANTIGRAVITY_MODEL` でGemini 3.8 FlashのIDを指定できます。CLIはアプリの `.env` を読み込みません。以前APIキー用の `modelProvider: "gemini"` を設定した場合は、その指定をCLI設定から削除してADC認証に戻してください。[認証の公式手順](https://antigravity.google/docs/install?tab=cli)。

CLIが起動している間は日本語の指示文を入力します。上の `agy --version` などのコマンドは通常のBashに入力します。

### 3-2. `character.py` を作ってもらう

**操作場所：** ターミナル 2 の Antigravity CLI の入力欄。

次の指示文をまとめて貼り付け、送信します。複数行の貼り付けは、省略表示される場合があります。すべて貼り付けられていれば問題ありません。

```text
このプロジェクトの app.py と pyproject.toml を確認し、app.py と同じフォルダーに
character.py を作成してください。

google.adk.agents.llm_agent から LlmAgent をインポートし、
LlmAgent のインスタンスを root_agent という変数に代入してください。

設定は以下のとおりです。
- model: "gemini-3.8-flash"
- name: "companion_agent"
- instruction: 以下の文章を複数行文字列として設定する
  あなたは、親しみやすく有能な AI アシスタントです。
  ユーザーの質問に日本語で答えてください。
  回答は原則として3文以内にし、絵文字は使わないでください。

今回はツールを追加せず、character.py だけを作成してください。
既存のファイルや依存パッケージは変更しないでください。
認証情報のファイルを読み取ったり表示したりする必要はありません。
Web サーバーの起動は自分で行います。
```

ファイルの作成・編集を許可する確認が出たら、対象が `character.py` であることを確認し、「Allow once」など、今回の操作を許可する選択肢を選びます。

許可を求める画面の例です。変更対象のファイル名を確認してから、「Allow once」を選びます。

![旧CLIでcharacter.pyへの書き込みを許可する画面。現在のCLIでは表示が異なります](docs/images/gemini-cli-allow-once.png)

### 3-3. 作成されたファイルを確認する

**操作場所：** Cloud Shell エディター。

ファイル一覧から `character.py` を開きます。`app.py` と同じ階層に、次のようなコードができていれば準備完了です。空白や引用符の見た目が違っていても、設定内容が同じなら問題ありません。

```python
from google.adk.agents.llm_agent import LlmAgent

root_agent = LlmAgent(
    model="gemini-3.8-flash",
    name="companion_agent",
    instruction="""
あなたは、親しみやすく有能な AI アシスタントです。
ユーザーの質問に日本語で答えてください。
回答は原則として3文以内にし、絵文字は使わないでください。
""",
)
```

Antigravity CLI でうまく作れない場合は、エディターで `character.py` を新規作成し、このコード全体を貼り付けて保存しても進められます。

> このアプリは `character.py` のADKエージェントを読み込み、会話とTTSに同じVertex AIのADC認証を使用します。モデルは `.env` の `GEMINI_MODEL=gemini-3.8-flash` を使います。`character.py` の編集後はサーバーを再起動してください。

### 3-4. AI の返答を確認する

**操作場所：** ターミナル 1。

サーバーが停止していることを確認し、再び起動します。

```bash
uv run --locked uvicorn app:app --host 0.0.0.0 --port 8000
```

プレビュー画面を再読み込みし、次のように話しかけます。

```text
こんにちは！あなたはどんなことを手伝えますか？
```

**オウム返しではなく、質問に対する返答が表示されれば成功です。**

API の応答には時間がかかります。`Thinking...` の表示中は、続けて送信せずに待ちます。

確認できたら、ターミナル 1 で `Ctrl+C` を押して停止します。

> 以降は「編集 → 保存 → サーバーを起動 → プレビューを再読み込み → 会話 → `Ctrl+C` で停止」の順で進めます。この起動方法では、コードの変更は自動で反映されません。また、サーバーを再起動すると、それまでの会話履歴はリセットされます。

<a id="step-4"></a>

## 4. 性格と口調を変える

### 4-1. どんなキャラクターにするか決める

名前、性格、話し方、好きな話題を考えます。たとえば、次のような設定にできます。

- 名前：わく
- 性格：親しみやすく、少しおちゃめな猫
- 話し方：「ニャ」を自然に交える
- 好きな話題：日なたぼっこ、遊び、岡山のお出かけ

思いつかない場合は、そのまま次の例を使ってください。自分の案を作りたい場合は、[Gemini アプリ](https://gemini.google.com/app) に「AI アシスタントのキャラクター設定を考えて」と相談しても構いません。

### 4-2. Antigravity CLI に変更を依頼する

**操作場所：** ターミナル 2 の Antigravity CLI の入力欄。

```text
character.py の root_agent に設定されている instruction だけを変更してください。
model、name、その他のファイルは変更しないでください。

新しい instruction には、以下のキャラクター設定を複数行文字列で設定してください。

あなたは「わく」という名前の、猫のキャラクターとして話す AI アシスタントです。
親しみやすく、陽気で、少しおちゃめな性格です。

【話し方】
日本語で答え、語尾に「ニャ」を自然に交えてください。
相手をからかいすぎず、やさしく会話してください。

【好きな話題】
日なたぼっこ、猫のおもちゃ、岡山のお出かけの話が好きです。

【回答のルール】
回答は原則として3文以内にし、絵文字は使わないでください。
わからないことは、わからないと伝えてください。
```

自分の設定に変える場合は、「あなたは」以降の文章を書き換えてから送信します。

### 4-3. 話し方が変わったことを確認する

エディターで `character.py` を開き、`instruction` の内容が変わったことを確認します。

**ターミナル 1** で起動します。

```bash
uv run --locked uvicorn app:app --host 0.0.0.0 --port 8000
```

プレビューを再読み込みし、「自己紹介して」「好きなことを教えて」などと話しかけます。

**指定した性格や口調が返答に反映されれば成功です。** 反映が弱い場合は、`instruction` に具体的な話し方の例を追加してみましょう。

確認できたら、ターミナル 1 で `Ctrl+C` を押して停止します。

<a id="step-5"></a>

## 5. Google 検索を追加する

### 5-1. Antigravity CLI に検索機能を追加してもらう

**操作場所：** ターミナル 2 の Antigravity CLI の入力欄。

次の指示文を貼り付けます。

```text
character.py に Google 検索を使う機能を追加してください。

1. google.adk.tools から google_search をインポートしてください。
2. root_agent の LlmAgent に tools=[google_search] を追加してください。
3. 現在のキャラクター設定を保ったまま、instruction に以下のルールを追加してください。
   最近のニュース、イベント、最新情報について聞かれた場合は、
   google_search で調べてから答えてください。
   ニュースは3件以内で簡潔に紹介してください。
   情報の日付を確かめ、確認できないことは断定しないでください。

model と name は変更しないでください。
character.py 以外のファイルや依存パッケージは変更しないでください。
```

### 5-2. 変更箇所を確認する

**操作場所：** Cloud Shell エディター。

`character.py` に、次の 3 点があることを確認します。

1. `from google.adk.tools import google_search` がある
2. `LlmAgent(...)` の中に `tools=[google_search]` がある
3. `instruction` に、最新情報を聞かれたら検索する指示がある

「わく」の設定を使った場合の完成例です。自分で作った性格を残したい場合は、全体を置き換えず、上の 3 点を確認してください。

```python
from google.adk.agents.llm_agent import LlmAgent
from google.adk.tools import google_search

root_agent = LlmAgent(
    model="gemini-3.8-flash",
    name="companion_agent",
    instruction="""
あなたは「わく」という名前の、猫のキャラクターとして話す AI アシスタントです。
親しみやすく、陽気で、少しおちゃめな性格です。

【話し方】
日本語で答え、語尾に「ニャ」を自然に交えてください。
相手をからかいすぎず、やさしく会話してください。

【好きな話題】
日なたぼっこ、猫のおもちゃ、岡山のお出かけの話が好きです。

【回答のルール】
回答は原則として3文以内にし、絵文字は使わないでください。
わからないことは、わからないと伝えてください。
最近のニュース、イベント、最新情報について聞かれた場合は、
google_search で調べてから答えてください。
ニュースは3件以内で簡潔に紹介してください。
情報の日付を確かめ、確認できないことは断定しないでください。
""",
    tools=[google_search],
)
```

### 5-3. 最近の情報を聞いてみる

**ターミナル 1** で起動します。

```bash
uv run --locked uvicorn app:app --host 0.0.0.0 --port 8000
```

プレビューを再読み込みし、次のように質問します。`YYYY年MM月DD日` は、ハンズオン当日の日付に置き換えてください。

```text
今日は YYYY年MM月DD日 です。
岡山に関する最近のニュースを Google 検索で調べて、3件以内で教えてください。
```

返答に含まれるニュースの日付や内容を、ブラウザーでも検索して確かめます。

**検索の設定がコードに入り、エラーなく会話を続けられることを確認してください。** 検索するかどうかはモデルが判断します。検索が実行されると出典リンクとGoogle Searchの候補を画面に表示します。専用表示がない返答だけでは、検索実行を断定しないでください。[Google 検索連携の動作](https://ai.google.dev/gemini-api/docs/google-search)

確認できたら、ターミナル 1 で `Ctrl+C` を押して停止します。

<a id="step-6"></a>

## 6. アバターを変える

このアプリは「口を閉じた画像」と「口を開いた画像」の 2 枚を切り替えて、話しているように見せています。同じキャラクターで、顔の位置・大きさ・背景をそろえた 2 枚を用意しましょう。

### 6-1. 口を閉じた画像を作る

**操作場所：** [Gemini アプリ](https://gemini.google.com/app)。

画像生成を選び、次のように依頼します。キャラクターの外見は、好きなものに変えて構いません。

```text
AI アシスタントのアバター用に、親しみやすい猫のマスコットを描いてください。
明るく、くっきりした線のアニメ調にしてください。
正面を向いた、頭から肩までのポートレートにしてください。
口は閉じて、やさしくほほえんでいます。
背景は単色の白、画像は正方形にしてください。
文字や吹き出しは入れないでください。
```

### 6-2. 口を開いた画像を作る

同じ会話で、生成された画像を元にして追加で依頼します。

```text
今の画像を元に、リップシンク用の「口を開いて話している画像」を作ってください。
口だけを変更し、顔の位置、大きさ、表情、服、背景は元の画像と同じにしてください。
元の画像と同じサイズの正方形にしてください。
```

2 枚を見比べ、口以外が大きく変わっていないか確認します。画像生成が利用できない場合は、自分で用意した画像でも進められます。画像の変更を後回しにして、元のアバターを使い続けても構いません。

元の資料で作った 2 枚の例です。この例は猫耳の女の子ですが、自分の好きなキャラクターで構いません。口以外の位置や見た目をそろえることがポイントです。

| 口を閉じた画像の生成例                                                                                                       | 口を開いた画像の生成例                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/images/avatar-generate-closed.png" alt="Gemini アプリで口を閉じたキャラクター画像を生成した例" width="340" /> | <img src="docs/images/avatar-generate-open.png" alt="同じ会話で、口を開いたキャラクター画像を追加生成した例" width="340" /> |

ここに載せているのは操作画面の例です。アプリに配置するときは、スクリーンショットではなく、生成された画像そのものをダウンロードしてください。

### 6-3. 画像を保存してアップロードする

2 枚の画像を手元のパソコンにダウンロードし、次の名前で保存します。

| 画像           | ファイル名                         |
| -------------- | ---------------------------------- |
| 口を閉じた画像 | `Gemini_Generated_Image_close.png` |
| 口を開いた画像 | `Gemini_Generated_Image_open.png`  |

PNG 以外で保存された場合は、画像編集アプリなどの「書き出し」で PNG に変換してください。ファイル名の拡張子だけを変えても、画像形式は変わりません。

次に、**Cloud Shell エディター**のファイル一覧で `static` → `images` を開きます。この `images` フォルダーに 2 枚をドラッグ＆ドロップしてください。

ドラッグ＆ドロップが使えない場合は、Cloud Shell のメニューからファイルをアップロードします。ホームフォルダーに入った場合は、エディターのファイル一覧で `devfest-okayama-ai-assistant/static/images/` に移動します。

配置後は、次の状態になっていることを確認します。元の画像は残っていて構いません。

```text
devfest-okayama-ai-assistant/
└── static/
    └── images/
        ├── char-mouth-closed.png
        ├── char-mouth-open.png
        ├── Gemini_Generated_Image_close.png
        └── Gemini_Generated_Image_open.png
```

配置後のファイル一覧の例です。左側の `static` → `images` の中に、新しい 2 枚が並んでいることを確認します。右側のコードは元資料のものなので、モデル名などは本文の設定を使ってください。

![Cloud Shell エディターの static/images 内に、口を閉じた画像と開いた画像を配置した例](docs/images/cloud-shell-avatar-files.png)

### 6-4. アプリで使う画像を変更する

**操作場所：** ターミナル 2 の Antigravity CLI の入力欄。

```text
キャラクターの画像を差し替えてください。
新しい画像は static/images/ に配置済みです。

- 口を閉じた画像: Gemini_Generated_Image_close.png
- 口を開いた画像: Gemini_Generated_Image_open.png

templates/index.html の character-image の初期画像を、口を閉じた画像に変更してください。
static/app.js の closedMouthImg と openMouthImg も、新しい画像のパスに変更してください。
ブラウザーから参照するパスは /static/images/ で始めてください。

画像の参照先以外の機能は変更しないでください。
```

エディターで、以下の 3 か所が変更されたことを確認します。

`templates/index.html` の画像は、次のようになります。

```html
<img
  id="character-image"
  src="/static/images/Gemini_Generated_Image_close.png"
  alt="WakuWaku"
/>
```

`static/app.js` の 2 つの変数は、次のようになります。

```javascript
const openMouthImg = "/static/images/Gemini_Generated_Image_open.png";
const closedMouthImg = "/static/images/Gemini_Generated_Image_close.png";
```

`alt` は画像の説明なので、自分のキャラクター名に変えても構いません。

### 6-5. 見た目と口の動きを確認する

**ターミナル 1** で起動します。

```bash
uv run --locked uvicorn app:app --host 0.0.0.0 --port 8000
```

プレビューを再読み込みしてから、会話します。

- 最初に、口を閉じた新しいキャラクターが表示される
- 話している間、口を開いた画像と閉じた画像が切り替わる
- 話し終わると、口を閉じた画像に戻る

**この 3 点を確認できたら完成です。** 画像が古いままなら、Windows/Linux は `Ctrl+Shift+R`、Mac は `Command+Shift+R` で、キャッシュを更新して再読み込みします。

アバターを差し替えたあとの画面例です。キャラクターの外見は、用意した画像によって変わります。

<img src="docs/images/app-custom-avatar.png" alt="黒猫から猫耳のキャラクターにアバターを差し替えたアプリの完成例" width="460" />

<a id="step-7"></a>

## 7. 終了・再開する

### 終了するとき

1. エディターで、変更したファイルを保存します。
2. ターミナル 1 で `Ctrl+C` を押し、Web サーバーを停止します。
3. ターミナル 2 の Antigravity CLI に `/exit` と入力して終了します。
4. 必要であれば、エディターのファイル一覧から、作成した `character.py` や画像、変更したファイルをダウンロードして手元に保存します。

認証情報のJSONファイルや `.env` は成果物として共有しないでください。SAキーを作る必要はありません。

### 後日、続きから再開するとき

Cloud Shell を開き、ターミナル 1 で次のコマンドを実行します。

```bash
cd ~/devfest-okayama-ai-assistant
uv sync --locked
uv run --locked uvicorn app:app --host 0.0.0.0 --port 8000
```

その後、ポート `8000` のウェブプレビューを開きます。**ファイルが残っていれば、再度の `git clone` や `.env` のコピーは不要です。**

編集も再開する場合は、ターミナル 2 を追加して次を実行します。

```bash
cd ~/devfest-okayama-ai-assistant
uv sync --locked
bash scripts/antigravity.sh
```

## 余裕があれば、もうひと工夫

まずは 1 つだけ選び、Antigravity CLI に依頼してみましょう。

- 画面の「AI Companion」を、自分のキャラクター名に変える
- 背景やボタンの色を変える
- キャラクターの返答を、短め・丁寧・元気などに調整する
- 口の動きに合わせて、違和感の少ない 2 枚の画像に作り直す

変更を依頼するときは、「どの部分を、どう変えたいか」を具体的に伝え、1 回変更するごとにブラウザーで動作を確認します。

<a id="troubleshooting"></a>

## エラーが出た場合

`ModuleNotFoundError: No module named flask` が出る場合は、手元の `app.py` が移行前のコードです。作業フォルダーで `git switch main`、`git pull --ff-only origin main`、`uv sync --locked` の順に更新します。ローカルでの起動は `uv run --locked python app.py`、表示先は [http://127.0.0.1:8000](http://127.0.0.1:8000) です。

| 症状 | 確認事項 |
| --- | --- |
| 503／認証未設定 | `.env` の実際のプロジェクトID、ADC、起動ディレクトリ。設定後に再起動 |
| 502／モデル呼び出し失敗 | サーバーログ、Vertex AI API有効化、実行者／SAの権限、モデル利用可否、`global`リージョン |
| 429 | プロジェクトのクォータを確認し、時間を置いて再送信 |
| `agy` が見つからない | `agy --version` と `PATH`、必要な場合のみ公式インストール |
| CLIだけ認証に失敗 | 同じターミナルの `AGY_ADC_AUTH=true`、`GOOGLE_CLOUD_PROJECT`。CLIはアプリの `.env` を読み込まない |
| プレビューが開かない | サーバー稼働、ポート8000、Cloud ShellのWeb preview |
| 声が出ない | 自動再生がブロックされた場合に出る「音声を再生」ボタン、ブラウザのミュート、端末音量。音声エラーの表示も確認 |


<a id="voice-trouble"></a>

音声はブラウザー内蔵TTSではなく、Vertex AIのGemini TTSです。音声生成に失敗しても会話のテキストは残ります。自動再生がブロックされた場合は「音声を再生」を押してください。タブのミュート、端末の音量も確認してください。

## ファイルの役割

| ファイル・フォルダー   | 役割                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `app.py`               | ブラウザーからのメッセージを受け取る Web サーバー。`COMPANION_MODE=echo`で `character.py` がなければオウム返しし、作成後はADKエージェントを呼び出します。 |
| `character.py`         | ハンズオンで作成するファイル。モデル、名前、性格、利用するツールを設定します。                                               |
| `.env`                 | Vertex AIのプロジェクト・モデル・音声を設定するファイル。                                                                            |
| `.env.template`        | `.env` を作るためのひな形です。                                                                                              |
| `pyproject.toml`     | Pythonの要件とアプリ・開発用の依存関係です。                                                                   |
| `uv.lock` | すべての依存パッケージの解決結果です。リポジトリで共有します。 |
| `.python-version` | uvが使用するPythonのバージョンです。 |
| `templates/index.html` | アプリの画面と、最初に表示する画像を定義します。                                                                             |
| `static/app.js`        | メッセージ送信、返答表示、音声読み上げ、口のアニメーションを動かします。                                                     |
| `static/style.css`     | 色や配置など、画面の見た目を設定します。                                                                                     |
| `static/images/`       | キャラクターの画像を置きます。                                                                                               |

## 元になった資料

この README は、[Build with AI — ADK と Gemini CLI で自分だけの AI アシスタントを作ろう！](https://docs.google.com/presentation/d/1nKmorvq0PVMgfLKNIPDbciXQHFEJGNkVYjW7FbSMtQQ/edit) の実習手順を、このリポジトリ向けに整理したものです。

元のコード：[Harappa80/bwai-nara-companion-python](https://github.com/Harappa80/bwai-nara-companion-python)

掲載画像の出典と元スライドの対応は、[画像の出典一覧](docs/images/SOURCES.md) にまとめています。

## 接続と自動検証

別のターミナルでこのリポジトリに移動し、起動済みサーバーに対して実行します。実モデル利用の料金が発生します。

```bash
uv run --locked python scripts/check_connection.py
```

`character.py` 作成前はオウム返しとTTS、作成後はGemini会話とTTSを確認します。手順どおりの完成例は `examples/character_basic.py` と `examples/character_search.py` にあります。CLIでの生成が難しい場合は、それぞれを `character.py` にコピーして再起動できます。

## 開発用の自動検証

```bash
uv sync --locked
uv run --locked pytest -q
node tests/test_ui.cjs
bash -n scripts/antigravity.sh
```

実ブラウザ検証は、起動済みサーバーに対して実行します。

```bash
npm ci
npx playwright install chromium
npm run test:e2e
# 実際のVertex AIを使う検証（モデル利用料金が発生）
LIVE_GEMINI=1 npm run test:e2e
```

既存のChromiumを使う場合は `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` と指定できます。スクリーンショットは既定で `/tmp/companion-e2e` に保存されます。既定のブラウザテストはAI応答のみfixtureにし、画面、音声デコード、口パク、履歴、障害復旧を確認します。実行結果と未検証の範囲は [検証記録](docs/verification.md) に記載しています。

依存を変更する開発作業では `uv add パッケージ名`（開発用は `uv add --dev パッケージ名`）を使い、`pyproject.toml` と `uv.lock` を一緒にcommitします。
