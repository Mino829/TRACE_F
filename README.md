# TRACE Frontend

`/`は旧参加者の状態確認・停止・削除画面、`/log`は写真ごとに参加者がチェックポイントを選ぶ画面です。どちらも新しいGPS取得・送信は行いません。`/log`の写真は端末内だけに保存し、どこにも送信しません。撮影リマインダーのWeb Pushは、TRACE_Bの参加資格情報を持つタブではTRACE_Bが、それ以外では`push-worker/`の`trace-push` Workerが送ります。

## ローカルで参加者画面を試す

Node.js 22以降、Go 1.25以降、PostgreSQL 17のコマンドを用意します。

```sh
npm ci
npm run dev:local
```

`http://127.0.0.1:3000`を開きます。`dev:local`は隣の`../trace_Backend`からGo APIをビルドし、ローカルPostgreSQL、API、Next.jsを起動します。別checkoutを使うときは`TRACE_BACKEND_REPO`で指定します。3000、8080、55432番が使用中なら起動を止めます。データは`.local/postgres`に残り、停止しても消しません。検証用に分離する場合は`TRACE_LOCAL_DATA_DIR`で専用ディレクトリを指定できます。

起動時にFrontendの固定Graphから3つの版をGoへ渡し、参加者Originを`127.0.0.1:3000`と`localhost:3000`に揃えます。受付・写真metadata等の機能flagや同意文を自動で有効化・承認することはありません。新規参加の結合検証は使い捨てDBとテスト専用の同意版・本文・明示的な機能設定を使い、公開環境から分離してください。

参加者APIの既定は`/api/backend`です。`NEXT_PUBLIC_TRACE_API_URL`が未設定・空文字でもBackendへ接続し、端末だけのデモ参加には退避しません。通常の`npm run dev`では、このパスを`TRACE_BACKEND_URL`（既定は`http://127.0.0.1:8080`）へ転送します。`dev:local`は同じパスとローカルGoを明示して起動します。

## Cloudflareでの参加者画面

本番 `https://trace-production.async5855.workers.dev` は、固定公開設定 `push-worker/production.public.json` から生成する専用Worker設定で配信します。`push-worker/src/site.ts` が `/api/backend/*` と `/api/operator/*` をGoへ中継します。ブラウザの参加トークンは同一originのAPIパスへヘッダーで送り、公開URLやビルド時の環境変数には入れません。運営資格と描画用接続の境界は [環境別手順](arrival-issuer/README.md) を参照してください。

main pushの「Verify frontend and Workers」成功後は、`Production` environmentでその検証済みSHAだけをcheckoutし、本番専用build・既存account/subdomain/Edge bindingの検証・`trace-production`だけの配備を行います。手動「Deploy production to Cloudflare」は明示 `ref` が必須、既定は検証のみで、公開は `deploy=true` の明示が必要です。詳細なGitHub設定・token権限・コマンドは [push-worker/README.md](push-worker/README.md#独立本番配信trace-production) を参照してください。

ローカルも `npm run build:production -- --config "$PWD/push-worker/production.public.json"` の後、同じ絶対パスで `npm --prefix push-worker run validate:production -- --config <固定JSON絶対パス>`、承認済みの場合だけ `deploy:production` を使います。`.env`・旧URL variables・旧一括releaseは使用しません。旧 `trace-log`・`trace-push`・D1/KV・購読・通常の `out/` は変更/移行しません。本番の写真は端末内のみ、任意の撮影通知はGoのみです。

`TRACE_BACKEND_URL` と `TRACE_OPERATOR_ALLOWED_ORIGIN` は公開varとして固定JSONから設定します。既存Workerの `TRACE_EDGE_SHARED_SECRET` はGoと同じ値を保持し、CIはbindingの名前/型だけを照合します。秘密値の読取・更新・標準入力・GitHubへの複製は不要です。binding欠落時は公開前に失敗し、初回設定/復旧だけを配備担当者が別途承認のもと実施します。

サイトWorkerはCloudflareが設定する`CF-Connecting-IP`が正規のIPv4/IPv6アドレスの場合だけ、Go APIへ`X-Trace-Client-IP`として1つ送ります。ブラウザからの`X-Forwarded-For`と`X-Trace-Client-IP`は転送しません。値がない場合や不正な場合はヘッダーを付けず、Go側は接続元アドレスへフォールバックします。この信頼境界はCloudflare経由の配信を前提とし、Go側は共有secretが一致するときだけ転送IPを信頼します。

旧リハーサルの `site.wrangler.jsonc` は `trace-log`、`wrangler.jsonc` は `trace-push` を指す管理者用helperのままです。本番CIから呼ばず、手動利用には別途承認が必要です。旧サイトのsecret・D1/KV・VAPIDを本番と混ぜません。今回の統合版について、CIの実権限・実配備とブラウザsmokeの成否は統合担当者の実行後に判断し、過去の本番作業記録を新CIの検証済みとは扱いません。

配信は管理者が設定を確認して行います。IAM非公開のGoへEdge keyだけで到達することはできず、既存のpublic-preview+Edge境界をこの実装のため無断変更しません。公開経路はBackendのdocs/cloudflare-origin.mdに従い、実配備の受付停止・レート制限・E2Eと大学/運営承認の後だけ有効化します。ローカル結合の成功をCloudflare TLS/IAMや実Google設定済みとはみなしません。

## 実装範囲と確認

`/`は既存MemorySession・旧LivePresenceSessionの状態確認、停止、個別削除、両資格情報による全削除を維持します。新規参加は`/log`でGoの公開設定と同意文を取得し、表示した本文・版・言語への明示同意後、MemorySessionの作成成功を確認して開始します。受付停止・設定取得失敗・参加作成失敗をローカル参加成功として扱いません。同意版が変わった場合は新本文を表示し、再同意を求めます。同意した本文は端末に保持し、参加後もメニューから確認できます。既存の位置データや資格情報は自動削除しません。`/log`の写真は撮影場所をチェックポイントから選び、EXIFを引き継がないJPEGとして端末内だけに保存します。開発者向け精度テストの新規取得と通知購読は廃止し、旧GPS記録は保持して再送しません。削除操作は残します。

**公開前の条件:** 同意文はBackendの公開設定を正本としますが、配信できることは承認済みを意味しません。既定の未承認草案では受付を閉じたままにします。設計#23/Backend#26とプライバシー#9で同意版・旧Live・入口を確認し、配信/受付を無断で開始しません。metadata API・直接描画WSS・任意Go Pushに対応するコードと、実配備/実Google/カメラ・投影機材/公開承認を区別します。新しい画像バイト列をGoへ送らない契約は維持します。

```sh
npm run lint
npm run typecheck
NEXT_STATIC_EXPORT=1 npm run build
cd push-worker && npm test && npm run typecheck
```

参加者のE2EはローカルGo APIと使い捨ての検証DBを使い、`npm run test:e2e`で実行します。本番や共有stagingのDBをテスト対象にしないでください。

接続確認では、API公開設定の同意表示、参加作成、写真の端末保存と`/v2`metadataのみの送信、Memory停止後の期限/本人権利維持、写真・Memory削除を実Goで確認します。`/`の空bodyの停止POSTも`application/json`を付け、配信Workerの制限を通します。API未設定時の偽成功、閉鎖・通信失敗、同意版409後の再同意は`tests/log-tabs.spec.ts`で回帰確認します。API stand-inのブラウザテストと、実Workerポリシー→Goの結合確認、実Cloudflare TLS/IAMの確認は別の検証です。

## 展示用ログインと到着 QR

`/display` は Google の本人確認を使い、描画用 displayToken と、到着 QR を発行する個人用 operator credential を**別々に**取得します。運営資格はタブのメモリ内だけに保持し、短命資格の更新・現在の資格失効・本人の全資格失効に対応します。描画だけ許可されている場合は描画を継続し、運営権限の拒否を別に表示します。未認証・未設定時の偽 QR や、認証なしの常時 QR 発行はありません。

本番の運営 API は同一originの `/api/operator` ブリッジ経由で呼び、Edge secret は本番Worker内だけで付与します。既存リハーサルのみ展示PCのloopbackブローカーを使います。[環境別の手順](arrival-issuer/README.md)を参照してください。到着QRは展示と同じoriginの`/log` URLで、短命proofはfragmentにだけ含めます。標準カメラで正しい参加者ページを開き、参加済みなら実到着処理へ、未参加なら通常の同意・参加画面へ進みます。アプリ内スキャナーも同じURLだけを読み取り、別originへ本人資格を送信しません。T2はURL内の内部圧縮にだけ使い、公開contextは署名payloadから導出してビルド環境へ依存させません。

既に開いている`/log`へのURL遷移も処理し、参加前に読んだproofは参加後へ持ち越しません。参加・展示のQR形式を同時に切り替えたため、配備後は両画面を再読み込みしてください。到着の冪等性記録には入力のSHA-256 fingerprintだけを保持し、proof本文をlocalStorageへ残しません。

waysui本番は`trace-fes-2026`と`https://trace-production.async5855.workers.dev`へ独立配備済みです。参加は必ず同じ本番の`/log`、展示は`/display`を使い、旧`trace-log`の参加から新本番QRを読みません。参加案内は`2026-10-31-v1`、問い合わせ先は「教室棟301のASYNCブースのスタッフ」。参加・metadata・到着・任意30分PushをON、画像upload/GPSをOFFにし、保持6時間＋24時間と既存同意記録を維持しています。実UIで参加→端末写真/地点登録→実QRの仮想カメラ読取→到着200→展示完了→本人削除204/照会404・端末写真0枚まで確認済みです。実スマホ・投影機材・実Push配信と正式公開受入は別です。[本番配備](push-worker/README.md)と[展示ログイン](arrival-issuer/README.md)を参照してください。旧参加データ・鍵は移行しません。

本番の展示PCは上記 `/display` をブラウザで開き、既存の **waysui00babe@gmail.com のみ**でログインします。Node.js・gcloud・ローカルブローカー・ローカルネットワークアクセス許可は不要です。ブリッジ切替の配備後は `/display` と `/log` の両画面を再読み込みします。共有PCを離れる際は現在の運営資格を失効し、Googleからもログアウトしてください。「自分の全運営資格を失効」は同アカウントの他PC・タブにも作用します。描画の主担当は同時に1台だけで、他PCは待機になります。従来の実UI確認記録は、このブリッジ切替後の検証結果ではありません。

同梱 bundle は `coordinateVersion=toyosu-2026-08-28.1`、`campusGraphVersion=toyosu-graph-2026-10-29.1.draft`、`threeDMapVersion=toyosu-3dmap-2026-10-30` です（Frontend #81・Backend #50）。Go も同一の Graph 本体と3つの版に揃え、旧 bundle の Session は書き換えません。14ルートの描画確認は [docs/display/README.md](docs/display/README.md) を参照してください。

## Memory 参加状態

参加者 API は `memorySession.status` の `main` / `arrived` / `ended` と、到着前の `replayStatus: null` を使用します。到着の再送は同じ arrival ID と**現在の**再生状態を反映します。廃止された展示用色・記号は要求しません。Memory の参加停止は `POST /v1/memory-sessions/{id}/stop` で終端化し、単なる通知解除や全データ削除と区別します。停止後も保存期限まで本人の状態確認・削除権利を保持し、旧 Live の資格は対応する本人用の状態確認・停止・削除にのみ使用します。写真が1枚でも「ShibaLab へ」の到着経路を利用できます。
