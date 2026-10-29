# TRACE Frontend

`/`は旧参加者の状態確認・停止・削除画面、`/log`は写真ごとに参加者がチェックポイントを選ぶ画面です。どちらも新しいGPS取得・送信は行いません。`/log`の写真は端末内だけに保存し、どこにも送信しません。撮影リマインダーのWeb Pushは、TRACE_Bの参加資格情報を持つタブではTRACE_Bが、それ以外では`push-worker/`の`trace-push` Workerが送ります。

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

`/log`の`trace-push`による通知は、ビルド時の`NEXT_PUBLIC_PUSH_API_URL`が指すWorkerを使います。未設定でも写真は端末内に保存できますが、`trace-push`の通知は使えません。

```sh
NEXT_STATIC_EXPORT=1 NEXT_PUBLIC_PUSH_API_URL=https://trace-push.async5855.workers.dev npm run build
cd push-worker
npm run deploy:site
```

配信は管理者が設定を確認して行います。IAM非公開のGoへEdge keyだけで到達することはできず、既存のpublic-preview+Edge境界をこの実装のため無断変更しません。公開経路はBackendのdocs/cloudflare-origin.mdに従い、実配備の受付停止・レート制限・E2Eと大学/運営承認の後だけ有効化します。ローカル結合の成功をCloudflare TLS/IAMや実Google設定済みとはみなしません。

## 実装範囲と確認

`/`の新規受付は、旧Backend同意文に位置情報の記述が残るため一時停止し、既存のMemorySession・LivePresenceSessionの状態確認、位置参加の停止、個別削除、両資格情報による全削除だけを維持します。既存の位置データや資格情報は自動削除しません。`/log`は写真の撮影場所をチェックポイントから選び、EXIFを引き継がないJPEGを保存します。開発者向け精度テストの新規取得と通知購読を廃止し、端末に残る旧GPS記録は保持して再送しません。削除操作は残します。

**公開前の条件:** /logの同意文は未承認の草案です。設計#23/Backend#26とプライバシー#9で同意版・旧Live・入口を確認し、配信/受付を無断で開始しません。metadata API・直接描画WSS・任意Go Pushに対応するコードと、実配備/実Google/カメラ・投影機材/公開承認を区別します。新しい画像バイト列をGoへ送らない契約は維持します。

```sh
npm run lint
npm run typecheck
NEXT_STATIC_EXPORT=1 npm run build
cd push-worker && npm test && npm run typecheck
```

参加者のE2EはローカルGo APIと使い捨ての検証DBを使い、`npm run test:e2e`で実行します。本番や共有stagingのDBをテスト対象にしないでください。

## 展示用ログインと到着 QR

`/display` は Google の本人確認を使い、描画用 displayToken と、到着 QR を発行する個人用 operator credential を**別々に**取得します。運営資格はタブのメモリ内だけに保持し、短命資格の更新・現在の資格失効・本人の全資格失効に対応します。描画だけ許可されている場合は描画を継続し、運営権限の拒否を別に表示します。未認証・未設定時の偽 QR や、認証なしの常時 QR 発行はありません。

運営 API の Edge secret は展示 PC の loopback ブローカーにのみ設定します。起動、Go の独立 allowlist、ブラウザ環境変数、実 UI と broker のスモーク手順は [arrival-issuer/README.md](arrival-issuer/README.md) を参照してください。公開 key ID と purpose に対応した T2 到着 QR は、Go の署名済み文字列を正確に復元できる場合だけ短縮します。

## Memory 参加状態

参加者 API は `memorySession.status` の `main` / `arrived` / `ended` と、到着前の `replayStatus: null` を使用します。到着の再送は同じ arrival ID と**現在の**再生状態を反映します。廃止された展示用色・記号は要求しません。Memory の参加停止は `POST /v1/memory-sessions/{id}/stop` で終端化し、単なる通知解除や全データ削除と区別します。停止後も保存期限まで本人の状態確認・削除権利を保持し、旧 Live の資格は対応する本人用の状態確認・停止・削除にのみ使用します。写真が1枚でも「ShibaLab へ」の到着経路を利用できます。
