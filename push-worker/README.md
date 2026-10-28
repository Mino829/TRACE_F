# push-worker

`/log`（写真メモリーと精度テスト）のための Cloudflare Worker です。

- 登録したスマホへ、登録の目的に合った間隔で Web Push の通知を送ります。参加者向けの撮影のリマインダーは15分か30分ごと、開発者向けの精度テストの通知は10分ごとです。通知の登録は、登録した日の24時（日本時間）に自動で切れます。
- スマホから送られた記録を D1 に、写真を KV に保存します。参加者の記録は写真1枚と撮影したときの位置です。精度テストの記録は、測位の連続値と、開発者が指した場所と階です。
- 参加者が「参加をやめる」を押すと、その端末の記録と写真をすべて削除します。

main に push され、GitHub Actions の「Verify frontend and Workers」が通ると、`.github/workflows/deploy.yml` が `npm run release` を実行してデプロイします。
Actions の画面から「Deploy to Cloudflare」を手で実行することもできます。
このワークフローには、リポジトリの secret に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が必要です。
`PUSH_API_URL`、`TRACE_API_URL`、`ARRIVAL_VENUE`、`ARRIVAL_CHECKPOINT_ID` は、リポジトリの variable に設定したものだけを `.env` に書きます。

## 構成

| 名前 | 中身 | 設定ファイル |
|---|---|---|
| `trace-push` | 通知サーバー（このフォルダの `src/`） | `wrangler.jsonc` |
| `trace-log` | `/` と `/log` の静的ページ、参加者APIのGo中継 | `site.wrangler.jsonc` / `src/site.ts` |

保存先は次のとおりです。

- D1 `trace-log`（バインディング名 `DB`）：通知の登録 `subscriptions` と記録 `records`。表の定義は `migrations/` にあります。
- KV（バインディング名 `LOG_KV`）：写真だけ。キーは `photo:<記録の id>` です。

`records` の列は、分析ですぐ使う値（最後の測位、指した場所、ずれの距離など）です。
スマホが送った記録の全体は `payload` 列に JSON のまま入っています。
記録の目的は `payload` の `purpose` にあり、参加者の写真は `photo-memory`、精度テストは `accuracy` です。
`purpose` がない記録（schema 1）は、すべて精度テストの記録です。

## 通知の目的と間隔

`subscriptions` の各行は、`purpose`（`photo` か `accuracy`）と `interval_minutes` を持ちます。
`/subscribe` が受け付ける組み合わせは、`photo` の15分か30分と、`accuracy` の10分だけです。
1台のスマホが持てる登録は1つなので、あとから登録した目的で上書きされます。

定期実行は5分ごとです。
実行のたびに、予定時刻の分が `interval_minutes` で割り切れる登録にだけ通知を送ります。
日本時間と UTC の差（540分）はどの間隔でも割り切れるので、15分ごとなら日本時間の 00・15・30・45 分に届きます。
通知の本文は目的ごとに変わり、位置、写真、参加記号は入れません。
通知の有効期限は、間隔と同じ長さにしています。

## 準備

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

## デプロイ

まとめて公開するときは、リポジトリのルートで次の1行を実行します。
マイグレーションの適用、通知サーバーのデプロイ、ページの静的書き出し、ページのデプロイを、この順に行います。
途中で失敗すると、その段階で止まります。
ページは `.env` の `PUSH_API_URL` に向けて書き出します（書いていなければ `https://trace-push.async5855.workers.dev`）。
`.env` に `TRACE_API_URL=/api/backend` を書くと、/log はこのサイトの `/api/backend` を通して、TRACE_B に参加を作るようになります。
書いていなければ、/log は今までどおり端末と通知サーバーだけで動きます。
この行を書くのは、下の2つの secret を `trace-log` に設定し、TRACE_B につながることを確かめてからにしてください。
`.env` に `ARRIVAL_VENUE` と `ARRIVAL_CHECKPOINT_ID` も書きます。値は TRACE_B の `TRACE_ARRIVAL_VENUE` と `TRACE_ARRIVAL_CHECKPOINT_ID` と同じにします。
/log はこの2つを使って、ブースの短い到着 QR を TRACE_B のトークンに組み立て直します（arrival-issuer/README.md）。

```bash
npm --prefix push-worker run release
```

1つずつ実行するときは、次の手順です。

ページ本体を更新するとき（画面を変えたら毎回）は、リポジトリのルートで静的書き出しをしてから、このフォルダでデプロイします。

```bash
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_PUSH_API_URL=https://trace-push.<サブドメイン>.workers.dev npm run build
```

```bash
npm run deploy:site
```

参加者画面のAPI中継を使う場合、`trace-log`側へ`TRACE_BACKEND_URL`（Go APIのHTTPSオリジン）と`TRACE_EDGE_SHARED_SECRET`（Go側と同じ32バイト以上の値）をsecretとして設定します。設定されるまで`/api/backend/*`は503を返し、静的ページだけが表示されます。`trace-push`のVAPID secretとは別です。

中継するのは、参加者画面が使う TRACE_B の API だけです（一覧は `src/site.ts` の `allowed`）。
参加の作成・取得・削除、写真（作成、一覧、アップロード URL、完了、削除、記録の取得）、到着（`arrival`、`arrival/skip`）、撮影リマインダー（`push-subscription` の PUT、PATCH、DELETE）、ライブ位置を通します。
運営用（`/v1/operator/*`）と展示画面用（`/v1/display/*`）の API には 404 を返します。
POST、PUT、PATCH は、本文が空でも `Content-Type: application/json` を付けないと 415 になります。

```bash
npm run wrangler -- secret put TRACE_BACKEND_URL --config site.wrangler.jsonc
npm run wrangler -- secret put TRACE_EDGE_SHARED_SECRET --config site.wrangler.jsonc
```

既存のGo stagingはIAM認証で保護され、共有ヘッダーだけでは呼べません。IAM設定や参加受付の公開を変更する前に、[Go側の接続条件](https://github.com/Mino829/TRACE_B/blob/main/docs/cloudflare-origin.md)を確認してください。このリンクはバックエンド側PRのマージ後に有効になります。

通知サーバーを更新するとき（`src/` や `wrangler.jsonc` を変えたとき）だけ、次を実行します。

```bash
npm run deploy
```

`migrations/` に表の定義を追加したときは、本番の D1 へ適用します。
`0003_subscription_plan.sql` のように、新しい通知サーバーが使う列を足すときは、デプロイの前に適用してください。
D1 のデータベースは、初回のデプロイで自動的に作られます。

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
