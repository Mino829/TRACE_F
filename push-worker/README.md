# push-worker

`/log`（定期ログ）のための Cloudflare Worker です。

- 10分ごと（毎時 00・10・20…分）に、登録したスマホへ Web Push で通知を送ります。通知の登録は、登録した日の24時（日本時間）に自動で切れます。
- スマホから送られた記録（位置情報、校正用に指した場所、端末と通信の情報）を D1 に、添えられた写真を KV に保存します。
- 参加者が「参加をやめる」を押すと、その端末の記録と写真をすべて削除します。

デプロイは手動です（自動デプロイは設定していません）。
Cloudflare アカウントを誰が運用するかは、チームで相談中です。

## 構成

| 名前 | 中身 | 設定ファイル |
|---|---|---|
| `trace-push` | 通知サーバー（このフォルダの `src/`） | `wrangler.jsonc` |
| `trace-log` | `/log` のページ本体（Next の静的書き出し `../out`） | `site.wrangler.jsonc` |

保存先は次のとおりです。

- D1 `trace-log`（バインディング名 `DB`）：通知の登録 `subscriptions` と記録 `records`。表の定義は `migrations/` にあります。
- KV（バインディング名 `LOG_KV`）：写真だけ。キーは `photo:<記録の id>` です。

`records` の列は、分析ですぐ使う値（最後の測位、指した場所、ずれの距離など）です。
スマホが送った記録の全体は `payload` 列に JSON のまま入っています。

## 準備

このフォルダに `.env` を置きます（git には入りません）。

```
CLOUDFLARE_API_TOKEN=Cloudflare の API トークン（Edit Cloudflare Workers テンプレートに「Account / D1 / Edit」を追加したもの）
CLOUDFLARE_ACCOUNT_ID=アカウント ID
```

wrangler は必ず `npm run wrangler -- <コマンド>` のように、`scripts/wrangler.mjs` 経由で実行します。
この `.env` と、このフォルダ専用の設定置き場（`.wrangler-home/`）だけを使い、PC に保存された別の Cloudflare ログインには触れません。
`wrangler login` は実行しないでください。

```bash
npm install
```

## デプロイ

ページ本体を更新するとき（画面を変えたら毎回）は、リポジトリのルートで静的書き出しをしてから、このフォルダでデプロイします。

```bash
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_PUSH_API_URL=https://trace-push.<サブドメイン>.workers.dev npm run build
```

```bash
npm run deploy:site
```

通知サーバーを更新するとき（`src/` や `wrangler.jsonc` を変えたとき）だけ、次を実行します。

```bash
npm run deploy
```

`migrations/` に表の定義を追加したときは、デプロイのあとに本番の D1 へ適用します。
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
通知の期限（日本時間の24時）と距離の計算も確かめます。

## 無料プランでの上限

- 1回の定期実行で送れる通知は 50 件までです（Workers の外部リクエスト数の上限。有料プランは 10,000 件）。登録が50台を超える前に、有料プランにするか、送信を分ける仕組みが要ります。
- D1 は1日 10 万行の書き込み、合計 5GB（1データベース 500MB）まで無料です。
- KV（写真）は1日 1,000 回の書き込み、合計 1GB まで無料です。
