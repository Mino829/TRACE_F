# TRACE Frontend

`/`はGo APIに接続する参加者画面、`/log`は位置精度を調べる既存デモです。後者のWeb Pushと調査記録は`push-worker/`の`trace-push` Workerが扱い、参加者画面の正本データとは分離します。

## ローカルで参加者画面を試す

Node.js 22以降、Go 1.25以降、PostgreSQL 17のコマンドを用意します。

```sh
npm ci
npm run dev:local
```

`http://127.0.0.1:3000`を開きます。`dev:local`は隣の`../trace_Backend`からGo APIをビルドし、ローカルPostgreSQL、API、Next.jsを起動します。3000、8080、55432番が使用中なら起動を止めます。データは`.local/postgres`に残り、停止しても消しません。

通常の`npm run dev`でも、`/api/backend/*`は`TRACE_BACKEND_URL`（既定は`http://127.0.0.1:8080`）へ転送されます。これはローカル開発用のNext.js rewriteです。

## Cloudflareでの参加者画面

静的書き出しの参加者画面と`/log`は、`push-worker/site.wrangler.jsonc`の`trace-log` Workerから配信します。同じWorkerの`/api/backend/*`は`push-worker/src/site.ts`がGo APIへ中継します。ブラウザの参加トークンは同一オリジンのAPIパスへヘッダーで送り、公開URLやビルド時の環境変数には入れません。

サイトWorkerには次の2つのsecretを設定します。Go側にも**同じ**`TRACE_EDGE_SHARED_SECRET`をSecret Managerから設定します。32バイト以上のランダム値を使用し、リポジトリ、`.env`、コマンドログへ値を残さないでください。

- `TRACE_BACKEND_URL`: Go APIのHTTPSオリジン。末尾のパスを含めない
- `TRACE_EDGE_SHARED_SECRET`: WorkerからGoへのアクセス確認用。`/v1/*`へ`X-Trace-Edge-Secret`として送る

静的アセットはsecretなしでも配信できますが、参加者APIは503で閉じます。`trace-push`のD1/KVやWeb Pushのsecretとは別に管理してください。

`/log`の通知と記録は、ビルド時の`NEXT_PUBLIC_PUSH_API_URL`が指す`trace-push`を使います。付けずにビルドすると、`/log`の通知と記録が使えません。

```sh
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_PUSH_API_URL=https://trace-push.async5855.workers.dev npm run build
cd push-worker
npm run deploy:site
```

上記の配信は管理者が設定を確認して手動で行います。現在のGo stagingはIAM保護されたままで、サイトWorkerから直接呼べません。本番用Go公開経路はバックエンドリポジトリの`docs/cloudflare-origin.md`を確認し、受付停止・レート制限・E2Eが成立してから別途有効化します。設計上の候補は設計リポジトリの`docs/cloudflare-web-backend-option.md`です。

## 実装範囲と確認

参加者画面は受付状態と同意文の取得、メモリー参加と任意の位置参加、最新位置送信、`on-site`切り替え、停止・削除を扱います。通常GPSの履歴は端末へ保存・再送しません。資格情報と操作キーはタブごとの`sessionStorage`に置きます。写真保存、到着QR、描画WebSocketはGo API側を含めて未実装です。

```sh
npm run lint
npm run typecheck
NEXT_STATIC_EXPORT=1 npm run build
cd push-worker && npm test && npm run typecheck
```

参加者のE2EはローカルGo APIと使い捨ての検証DBを使い、`npm run test:e2e`で実行します。本番や共有stagingのDBをテスト対象にしないでください。
