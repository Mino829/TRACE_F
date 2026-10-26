# TRACE Frontend

`/`は旧参加者の状態確認・停止・削除画面、`/log`は写真ごとに参加者がチェックポイントを選ぶ画面です。どちらも新しいGPS取得・送信は行いません。`/log`の写真記録とWeb Pushは`push-worker/`の`trace-push` Workerが扱い、Go APIの写真保存とは別です。

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

サイトWorkerはCloudflareが設定する`CF-Connecting-IP`が正規のIPv4/IPv6アドレスの場合だけ、Go APIへ`X-Trace-Client-IP`として1つ送ります。ブラウザからの`X-Forwarded-For`と`X-Trace-Client-IP`は転送しません。値がない場合や不正な場合はヘッダーを付けず、Go側は接続元アドレスへフォールバックします。この信頼境界はCloudflare経由の配信を前提とし、Go側は共有secretが一致するときだけ転送IPを信頼します。

静的アセットはsecretなしでも配信できますが、参加者APIは503で閉じます。`trace-push`のD1/KVやWeb Pushのsecretとは別に管理してください。

`/log`の写真送信と通知は、ビルド時の`NEXT_PUBLIC_PUSH_API_URL`が指す`trace-push`を使います。未設定でも端末内には写真を保存できますが、Workerへの送信と通知は使えません。

```sh
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_PUSH_API_URL=https://trace-push.async5855.workers.dev npm run build
cd push-worker
npm run deploy:site
```

上記の配信は管理者が設定を確認して手動で行います。現在のGo stagingはIAM保護されたままで、サイトWorkerから直接呼べません。本番用Go公開経路はバックエンドリポジトリの`docs/cloudflare-origin.md`を確認し、受付停止・レート制限・E2Eが成立してから別途有効化します。設計上の候補は設計リポジトリの`docs/cloudflare-web-backend-option.md`です。

## 実装範囲と確認

`/`の新規受付は、旧Backend同意文に位置情報の記述が残るため一時停止し、既存のMemorySession・LivePresenceSessionの状態確認、位置参加の停止、個別削除、両資格情報による全削除だけを維持します。既存の位置データや資格情報は自動削除しません。`/log`は写真の撮影場所をチェックポイントから選び、EXIFを引き継がないJPEGを保存します。開発者向け精度テストの新規取得と通知購読を廃止し、端末に残る旧GPS記録は保持して再送しません。削除操作は残します。

**公開前の条件:** `/log`の位置情報なし同意文は未承認の草案です。設計 #23、Backend #26、およびプライバシー承認 #9 で同意版・既存Liveセッション・入口の扱いを確定するまで、新たな参加者への配信・受付は承認済みとは扱わないでください。Go APIの写真保存、描画WebSocket、Go APIによる通知はこの変更には含みません。

```sh
npm run lint
npm run typecheck
NEXT_STATIC_EXPORT=1 npm run build
cd push-worker && npm test && npm run typecheck
```

参加者のE2EはローカルGo APIと使い捨ての検証DBを使い、`npm run test:e2e`で実行します。本番や共有stagingのDBをテスト対象にしないでください。
