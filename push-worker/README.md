# push-worker

`/log`（写真メモリーと精度テスト）のための Cloudflare Worker です。

- 登録したスマホへ、登録の目的に合った間隔で Web Push の通知を送ります。参加者向けの撮影のリマインダーは15分か30分ごと、開発者向けの精度テストの通知は10分ごとです。通知の登録は、登録した日の24時（日本時間）に自動で切れます。
- スマホから送られた記録を D1 に、写真を KV に保存します。参加者の記録は写真1枚と撮影したときの位置です。精度テストの記録は、測位の連続値と、開発者が指した場所と階です。
- 参加者が「参加をやめる」を押すと、その端末の記録と写真をすべて削除します。

main の push に対する「Verify frontend and Workers」が成功すると、`.github/workflows/deploy.yml` は**その検証済みcommit SHAだけ**をcheckoutし、`Production` environmentで `trace-production` だけを配備します。旧D1 migration・`trace-push`・`trace-log` は自動配備しません。
Actions の「Deploy production to Cloudflare」は明示的な `ref` を必須とし、手動実行は既定でbuildとメタデータ検証だけです。公開には `deploy=true` の明示とProduction environmentの承認が必要です（設定方法は下記）。
旧 `npm run release` と `scripts/release.mjs` は廃止しました。旧リポジトリsecretのaccount ID、URL variables、`.env` は本番CIへ渡しません。

## 構成

| 名前 | 中身 | 設定ファイル |
|---|---|---|
| `trace-push` | 通知サーバー（このフォルダの `src/`） | `wrangler.jsonc` |
| `trace-log` | 既存リハーサルの静的ページ・参加者API中継。手動操作のみ | `site.wrangler.jsonc` / `src/site.ts` |
| `trace-production` | Google Cloud本番の静的ページ・同一origin参加者/運営API中継 | `scripts/production.mjs` が固定公開JSONから専用設定を生成 |

保存先は次のとおりです。

- D1 `trace-log`（バインディング名 `DB`）：通知の登録 `subscriptions` と記録 `records`。表の定義は `migrations/` にあります。
- KV（バインディング名 `LOG_KV`）：写真だけ。キーは `photo:<記録の id>` です。

`records` の列は、分析ですぐ使う値（最後の測位、指した場所、ずれの距離など）です。
スマホが送った記録の全体は `payload` 列に JSON のまま入っています。
記録の目的は `payload` の `purpose` にあり、参加者の写真は `photo-memory`、精度テストは `accuracy` です。
`purpose` がない記録（schema 1）は、すべて精度テストの記録です。

## 独立本番配信（trace-production）

この節が Google Cloud project `trace-fes-2026`（number `350621330046`）向けの唯一の配備経路です。main自動配信もこの経路へ切り替え、以下の既存 `.env` / `deploy:site` / `deploy` 手順は本番から分離します。旧 `trace-log` / `trace-push`・D1・KV・通知購読・鍵は変更も移行もしません。PR86のhelper名変更は戻し、`site.wrangler.jsonc` は `trace-log` のまま、`wrangler.jsonc` の許可originも旧サイトだけにしています。これらのhelperを本番CIは呼びません。

### 必須の公開設定

リポジトリ内の `push-worker/production.public.json` が公開設定の唯一の入力です。次の9項目すべてが必須で、追加項目（secretを含む）・空値・別configパスは拒否します。設定JSONは公開情報だけで、`.env`形式ではありません。

配備担当者が確認した本番OAuth client ID、Cloudflare account/subdomain、originを収めています。リポジトリルートで `PRODUCTION_PUBLIC_CONFIG="$PWD/push-worker/production.public.json"` と指定します。任意の別JSONによる配備先変更はできません。公開値の変更はコードレビュー対象です。

| JSONキー | 指定値・確認条件 |
|---|---|
| `worker` | `trace-production` 固定 |
| `origin` | `https://trace-production.` + 実際の `workersDevSubdomain` + `.workers.dev`。親担当者が最終hostnameを確認する |
| `backendUrl` | 実Cloud Runのcanonical origin `https://trace-backend-350621330046.asia-northeast1.run.app`。stagingや別projectのURLは拒否 |
| `googleClientId` | この本番projectで実際に作成したWeb OAuth client ID（`350621330046-` で始まり `.apps.googleusercontent.com` で終わる）。ダミー・staging流用不可 |
| `operatorBrokerUrl` | 同一originの相対base `/api/operator` に完全一致。localhost・別origin・末尾slashは拒否。既存8790のbrokerは変更しない |
| `cloudflareAccountId` | `297be09d2f1bfb28bb483bd6e6daae9d` 固定。deploy前にCloudflare APIのaccount情報と照合 |
| `cloudflareAccountName` | `Async5855@gmail.com's Account`。deploy前にIDと一緒に完全一致を確認 |
| `workersDevSubdomain` | 同じaccountの実subdomain。deploy前にCloudflare APIと照合 |

Google OAuth、Goの許可origin、brokerをこの本番originへ揃えます。到着QRは同じoriginの`/log` URLで、署名proofはfragment内だけに含めます。T2短縮に必要な公開contextも署名payloadから取り出してQRに含めるため、Frontend buildでvenue/checkpoint/key IDを推定・固定しません。`NEXT_PUBLIC_SITE_ORIGIN`は参加URLの表示だけに使います。標準カメラで開く入口とアプリ内読取を揃え、別originのQRは現環境へ送信しません。旧本人資格・写真の移行や署名検証の緩和はありません。切替時は展示・参加者の両画面を更新します。

### build（秘密情報不要）

Node 22以降と、ルート / `push-worker` それぞれの `npm ci` 済み依存packageが必要です。リポジトリルートで、`PRODUCTION_PUBLIC_CONFIG` に上記実値JSONの絶対パスを設定して実行します（これは公開パスであり秘密値ではありません）。

```bash
npm run build:production -- --config "$PRODUCTION_PUBLIC_CONFIG"
```

`scripts/production.mjs` は必要なソースと公開assetだけを `.production-build/source/` にコピーし、WebpackによるNext静的buildを実行します。`.env*` / `.dev.vars` はコピーも読込もせず、親プロセスの `NEXT_PUBLIC_*` や秘密環境変数もNextへ継承しません。既存の `out/` / `.next/` は変更しません。出力は `.production-build/source/out/`、配備設定は `.production-build/wrangler.json`、公開入力とWorkerソース/全静的assetのSHA-256照合記録は `.production-build/manifest.json` です。開始時に前回の専用成果物を無効化し、成功時だけmanifestを作ります。検証/配備時に設定の完全一致と成果物digestを再確認し、build後の変更を拒否します。

参加者APIは `/api/backend`、運営ブリッジは `/api/operator` に固定し、display接続先とGoogle client IDは指定した実値をbundleへ埋め込みます。生成Worker設定は `TRACE_OPERATOR_ALLOWED_ORIGIN=config.origin` を設定し、`run_worker_first` は `/api/backend/*` と `/api/operator/*` だけです。deploy前にもbindingと経路配列の完全一致を確認します。`NEXT_PUBLIC_PUSH_API_URL` は空に固定し、デモ `trace-push` へ接続しません。写真の画像バイト列は端末内だけ、任意の30分リマインダーはGoの購読APIを使います。通知を許可しなくても参加・端末保存できます。

### GitHub Production environmentの設定

1. Repository Settings → Environments → **Production** を作成/選択します。必要なreviewer・配備可能branch/tagを設定します。main自動配備を許可し、統合PRの手動検証時だけ承認済みbranchも許可します。Environmentの作成だけではreviewer承認は強制されないため、必要な保護規則を明示してください。
2. workflowは `secrets.CLOUDFLARE_API_TOKEN` を使用します。Production environmentに同名secretがあれば優先し、なければ既存repository secretへGitHub標準のfallbackを使います。既存tokenの値を読み出す必要はありません。まず手動 `deploy=false` で実権限を確認し、不足した場合だけ承認済みaccountに限定した有効期限付きtokenを配備担当者が作成し、Production environmentの同名secretへ安全に登録/更新します。必要権限は `Account Settings: Read`（account ID/name照合）と `Workers Scripts: Edit`（subdomain/secret metadata参照・公式Wranglerのコード/asset配備）です。D1・KV・他accountの権限は不要です。Read-only検証成功はEdit権限や実配備成功の証明ではありません。
3. accountは固定JSONから取得するため `CLOUDFLARE_ACCOUNT_ID` secretは不要です。URLやGoogle IDのGitHub Variables、Go Edge secretのGitHub Secretも不要です。既存repositoryのURL variablesや旧account secretは本番に継承しません。
4. 既存Worker `trace-production` の `TRACE_EDGE_SHARED_SECRET` がGoと同じ値として設定済みであることを配備担当者が確認します。CIは [Worker secrets一覧API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/) の名前と `secret_text` 型だけを検証し、秘密値の取得・作成・更新・rotationはしません。binding欠落・権限不足・account/subdomain不一致は配備前に停止します。

手動実行例（repository root、`gh`で認証済みの配備担当者）:

```bash
# このworkflow定義を持つ明示branchを --ref、配備対象を -f ref に指定する。
# SHA指定を推奨。既定ではリモートのGETだけで、Worker変更・公開なし。
gh workflow run deploy.yml --ref fix/production-ci-pr86-20261031 \
  -f ref=fix/production-ci-pr86-20261031 -f deploy=false

# 配備の明示承認後だけtrue。Productionの保護規則にも従う。
gh workflow run deploy.yml --ref fix/production-ci-pr86-20261031 \
  -f ref=fix/production-ci-pr86-20261031 -f deploy=true
```

手動refは選択したcommitをbuild/検証しますが、それ自体ではVerify suite合格を意味しません。通常のmain配備は同repository・mainへのpushによるVerify成功だけを受け付け、その `head_sha` をcheckoutして一致を確認します。checkoutのcredential永続化を無効化し、GitHub権限は `contents: read` のみ、concurrencyはproduction専用です。依存installとbuildへCloudflare credentialを渡さず、メタデータ検証/配備stepだけに渡します。`.env`ファイルや秘密artifactを生成しません。

### ローカル検証・配備（Edgeの入力不要）

認証は次のどちらか一方だけを明示します。両方指定・未指定は拒否します。新しいcredential平文ファイル、秘密値のコピー、`set -x`、値を表示する `env` / `echo`、トークンのargv指定は禁止です。専用scriptは既存 `scripts/wrangler.mjs` / `.env` loaderを使用しません。

- API token方式: `CLOUDFLARE_API_TOKEN` を配備担当者が親プロセス環境へ安全に投入します。
- 公式OAuth方式（ローカルの承認済み担当者だけ）: `TRACE_PRODUCTION_AUTH_HOME` に確認済み公式Wrangler認証の `XDG_CONFIG_HOME` 絶対パスを指定します。専用scriptは公式 `wrangler auth token --json` でKeychainを含むネイティブ認証・refreshを利用し、出力はメモリ内だけで捕捉します。端末でこのauthコマンドを直接実行しないでください。CIはAPI token方式だけです。

```bash
npm --prefix push-worker run validate:production -- --config "$PRODUCTION_PUBLIC_CONFIG"
# 公開が承認された場合だけ。標準入力/Secret Managerへのアクセスは不要。
npm --prefix push-worker run deploy:production -- --config "$PRODUCTION_PUBLIC_CONFIG"
```

両コマンドとも同じ固定JSONで成功した専用buildが必要です。検証は成果物/config/account ID/name/subdomain/既存Edge bindingの実読取照合だけです。配備は再検証後、隔離cwd/config homeと明示accountで公式Wranglerを1回呼びます。`workers_dev: true` / preview無効 / cronなし / D1・KV・routeなしで `trace-production` だけを配備し、既存secretはWrangler標準の継承で保持します。secret PUTやsubdomain APIによる別途公開切替はありません。配備後もbinding metadataを照合し、確認不能なら成功扱いにしません。失敗時の自動rollbackはせず、担当者が実状態を確認します。

`TRACE_BACKEND_URL` と `TRACE_OPERATOR_ALLOWED_ORIGIN` は公開varとして固定JSONから設定します。Edge値をbundle・生成config・ファイル・子プロセス環境/argvへ渡しません。Wranglerログ書込とmetricsは無効、子プロセス応答とCloudflare応答本文は表示しません。初回secret設定/欠落復旧はCI外での明示承認が必要です。担当者がGoの固定数値versionと一致する値を安全な公式secret入力経路で既存本番Workerへ設定し、値をGitHubへ複製せず、再検証します。本pipelineは新Workerの初回作成やsecret修復を代行しません。

参加者用 `/api/backend` のallowlist・origin確認・JSON制約・Edge付与・client IP信頼境界は維持し、operator/display APIをここへ開放しません。空ストリームのDELETEは許可し、実体のあるDELETEは400です。本番専用 `/api/operator` は明示したHTTPS originとリクエストoriginが一致するときだけ開き、未設定の既存リハーサルWorkerでは404のままです。資格発行・到着proof・現在/本人全資格失効の4経路だけを許可し、本文・query・未知経路・別origin・redirectを拒否します。Edge secretはWorkerからGoへの通信にだけ付与します。描画資格とWSSはGoへ直接接続し、Goの認証・IAM・受付制御は変更しません。

### 本番展示PCの操作

メンバーは `https://trace-production.async5855.workers.dev/display` を開き、既存の **waysui00babe@gmail.com のみ**でGoogleログインします。展示PCにはNode.js・gcloud・ローカルブローカーも、ローカルネットワークアクセス許可も不要です。上記build/deployは配備担当者だけの手順であり、メンバーPCで実行しません。切替後は展示 `/display` と参加者 `/log` の両方を再読み込みしてください。

共有PCを離れる際は現在の運営資格を失効し、Googleからもログアウトします。「自分の全運営資格を失効」は同じwaysuiアカウントの他PC・タブも対象です。主描画は同時に1台だけで、他PCの待機は正常です。環境別の接続確認は [arrival-issuer/README.md](../arrival-issuer/README.md) を参照してください。

以下は統合前の本番作業記録です。今回のPR86統合版・新CI/tokenでの再現確認ではありません。新CIの権限検証・実配備・ブラウザsmokeは統合担当者が別途実施し、結果が出るまでは未検証として扱います。統合前の同一origin運営ブリッジでは、実Chromeでloopback拒否・本番8792停止のまま、実Google認証200・QR周期更新200・loopback要求0件・到着200/展示完了・現在資格失効204/失効後401を確認した記録があります。

10月30日の旧配備では、Go `trace-backend-00005-6rj`、Wrangler応答`febeacb9-1be4-41ef-8ed7-278f1136ba67`（後続secret反映前）、リハーサル説明文`rehearsal-device-photos-push-v2`を使い、写真/地点登録・T2 QRの仮想カメラ読取・到着/展示完了・本人削除を確認しました。53ノードの`hq-5f`→`shibalab`経路を生成し、合成データは削除済みです。実機/実Push・正式公開受入とは別です。

現在のWebは`https://trace-production.async5855.workers.dev`、同origin運営中継配備のWrangler応答は`0e16e41a-96bf-4e4a-ba12-42dff199aec2`（後続secret反映前）。10月31日にBackendの同意版・本文・問い合わせ先だけを更新し、Goは同一imageの`trace-backend-00006-9x9`へ切替。案内は`2026-10-31-v1`、問い合わせは「教室棟301のASYNCブースのスタッフ」。保持6時間＋24時間、受付/任意Push ON、画像upload/GPS OFFを維持し、Workerの再配備は不要でした。実同意画面、新版参加201・旧版409・本人削除204/404を確認済み。suite再実行・commit/pushは行っていません。


## 通知の目的と間隔

`subscriptions` の各行は、`purpose`（`photo` か `accuracy`）と `interval_minutes` を持ちます。
`/subscribe` が受け付ける組み合わせは、`photo` の15分か30分と、`accuracy` の10分だけです。
1台のスマホが持てる登録は1つなので、あとから登録した目的で上書きされます。

定期実行は5分ごとです。
実行のたびに、予定時刻の分が `interval_minutes` で割り切れる登録にだけ通知を送ります。
日本時間と UTC の差（540分）はどの間隔でも割り切れるので、15分ごとなら日本時間の 00・15・30・45 分に届きます。
通知の本文は目的ごとに変わり、位置、写真、参加記号は入れません。
通知の有効期限は、間隔と同じ長さにしています。

## 既存リハーサルの準備（本番CI対象外）

デプロイ先は、チームの共通 Cloudflare アカウントです（workers.dev のサブドメインは `async5855`）。
API トークンは一人ずつ、共通アカウントで自分用に作ります。有効期限を付けてください。

このフォルダに `.env` を置きます（git には入りません）。

```
CLOUDFLARE_API_TOKEN=自分の API トークン（Edit Cloudflare Workers テンプレートに「Account / D1 / Edit」を追加したもの）
CLOUDFLARE_ACCOUNT_ID=共通アカウントの ID（ダッシュボードの Account details に出ます）
PUSH_API_URL=https://trace-push.async5855.workers.dev
```

wrangler は必ず `npm run wrangler -- <コマンド>` のように、`scripts/wrangler.mjs` 経由で実行します。
この `.env` と、このフォルダ専用の設定置き場（`.wrangler-home/`）だけを使い、PC に保存された別の Cloudflare ログインには触れません。
`wrangler login` は実行しないでください。

```bash
npm install
```

## 既存リハーサルの手動配備（別途承認が必要）

以下は既存の `trace-log` / `trace-push` / D1 / KV を直接変更する管理者向け記録です。本番配備のためには実行しません。今回の統合では実行もresource変更も行いません。旧一括releaseは削除し、個別の手動helperだけを残しています。`.env`のURL設定を本番buildへ流用しないでください。

`site.wrangler.jsonc` は旧 `trace-log` 固定、`wrangler.jsonc` は旧 `trace-push` / D1 / KV固定です。PR86でサイトhelperを `trace-production` へ改名すると旧release経由で通知DBまで変更してしまうため、その改名は採用しません。設定を元に戻すことはリモートWorkerの改名・削除・再配備ではありません。

ページ本体を更新するとき（画面を変えたら毎回）は、リポジトリのルートで静的書き出しをしてから、このフォルダでデプロイします。

```bash
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_PUSH_API_URL=https://trace-push.<サブドメイン>.workers.dev npm run build
```

```bash
npm run deploy:site
```

旧参加者画面のAPI中継を使う場合、`trace-log`側へ`TRACE_BACKEND_URL`（Go APIのHTTPSオリジン）と`TRACE_EDGE_SHARED_SECRET`（Go側と同じ32バイト以上の値）をsecretとして設定します。設定されるまで`/api/backend/*`は503を返し、静的ページだけが表示されます。`trace-push`のVAPID secretや新本番とは別です。

中継するのは、参加者画面が使う TRACE_B の API だけです（一覧は `src/site.ts` の `allowed`）。
参加の作成・取得・削除、/v2 の写真 metadata 作成・一覧・story・削除、到着（`arrival`、`arrival/skip`）、Memory 参加停止（`stop`）、撮影リマインダー（`push-subscription` の PUT、PATCH、DELETE）を通します。写真の本体は端末に残します。
旧 Live の本人照会・停止・削除と旧クラウド写真の本人閲覧・削除も通し、停止後・失効後も `deleteAfter` まで本人閲覧・削除を維持します。旧写真 upload/complete と新規 GPS 書き込みは通しません。
運営用（`/v1/operator/*`）と展示画面用（`/v1/display/*`）の API には 404 を返します。Edge secret は Worker だけが保持し、ブラウザには渡しません。
POST、PUT、PATCH は、本文が空でも `Content-Type: application/json` を付けないと 415 になります。
DELETEは本文のストリームが存在しても、実際のデータが0バイトなら許可します。Cloudflareが本文なしの要求を空のReadableStreamとして渡す場合も同じです。1バイト以上の本文があるDELETEは、上流へ送らず400 `BODY_NOT_ALLOWED`で拒否します。

```bash
npm run wrangler -- secret put TRACE_BACKEND_URL --config site.wrangler.jsonc
npm run wrangler -- secret put TRACE_EDGE_SHARED_SECRET --config site.wrangler.jsonc
```

既存のGo stagingはIAM認証で保護され、共有ヘッダーだけでは呼べません。IAM設定や参加受付の公開を変更する前に、[Go側の接続条件](https://github.com/Mino829/TRACE_B/blob/main/docs/cloudflare-origin.md)を確認してください。このリンクはバックエンド側PRのマージ後に有効になります。

通知サーバーを更新するとき（`src/` や `wrangler.jsonc` を変えたとき）だけ、次を実行します。

```bash
npm run deploy
```

以下は旧リハーサルD1へのremote変更です。新本番への配備には不要で、実行には別途承認が必要です。既存DBは `wrangler.jsonc` の明示IDで参照し、新規作成はしません。旧通知サーバーに新しい列を追加するときだけ、配備前に対応するmigrationを適用します。

```bash
npm run wrangler -- d1 migrations apply DB --remote
```

ページの公開 URL を変えたときは、`wrangler.jsonc` の `ALLOWED_ORIGINS` に追加してから `npm run deploy` してください。

## 秘密情報（VAPID 鍵）

通知サーバーには、次の3つを Cloudflare の secret として登録してあります。

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_JWK`：Web Push の鍵。`npm run vapid` で `.vapid.json` に作られます。
- `VAPID_SUBJECT`：通知の配信元（Google・Apple など）に伝える送信者の連絡先。今はリポジトリの URL です。

VAPID 鍵を作り直すと、登録済みのスマホすべてで通知の登録をやり直すことになります。
`.vapid.json` はチームで共有できる安全な場所に控えてください。
別のアカウントへ移すときも、同じ鍵を登録し直せば通知の登録はそのまま使えます。

## データの取り出し

記録は SQL で取り出せます。
次の例は、記録をすべて JSON でファイルに書き出します（出力ファイルは git に入れないでください）。

```bash
npm run wrangler -- d1 execute DB --remote --json --command "SELECT * FROM records ORDER BY taken_at" > records.json
```

写真は、記録の `photo_key` を指定して1枚ずつ取り出します。

```bash
npm run wrangler -- kv key get --binding LOG_KV --remote "photo:<記録の id>" > photo.jpg
```

## ローカルで試す

`.dev.vars` に VAPID の3項目を書き、リポジトリのルートの `.env.local` に `NEXT_PUBLIC_PUSH_API_URL=http://localhost:8787` を書きます。
初回だけ、ローカルの D1 に表を作ります。

```bash
npm run wrangler -- d1 migrations apply DB --local
```

```bash
npm run dev -- --port 8787
```

`http://localhost:8787/__scheduled` を開くと、定期実行を1回起こせます。

## テスト

```bash
npm test
```

Web Push の暗号化と署名を、参照実装（http_ece と node:crypto）で検証します。
通知の期限（日本時間の24時）と距離の計算、通知の間隔の判定、受け付ける目的と間隔の組み合わせも確かめます。

## 無料プランでの上限

- 1回の定期実行で送れる通知は 50 件までです（Workers の外部リクエスト数の上限。有料プランは 10,000 件）。毎時 00 分と 30 分にはすべての登録が同時に対象になるので、5分ごとに実行しても上限に近づく台数は変わりません。登録が50台を超える前に、有料プランにするか、送信を分ける仕組みが要ります。
- D1 は1日 10 万行の書き込み、合計 5GB（1データベース 500MB）まで無料です。
- KV（写真）は1日 1,000 回の書き込み、合計 1GB まで無料です。
