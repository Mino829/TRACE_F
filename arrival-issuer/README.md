# 展示 PC の運営認証ブローカー（arrival-issuer）

`/display` から TRACE_B の運営 API を呼ぶ、127.0.0.1 専用のローカルプログラムです。バックグラウンドで QR を発行せず、認証なしの QR 配布・共有キャッシュもありません。ブラウザは Google 本人確認から独立した2分間の **operator credential** を取得し、その資格だけで到着 QR を発行します。描画用 displayToken、参加者トークン、Google ID token 自体は QR 発行の資格ではありません。

Edge secret はこのプロセスだけに設定します。ブラウザ、QR、公開環境変数、ログへ渡しません。追加パッケージは不要、Node.js 22 以上を使用します。

## 設定

このフォルダの `.env`（git 管理対象外）に設定します。

```dotenv
TRACE_API_ORIGIN=https://YOUR-TRACE-B-OPERATOR-ORIGIN
TRACE_EDGE_SHARED_SECRET=SERVER-SIDE-ONLY
DISPLAY_ORIGINS=https://trace-production.async5855.workers.dev,http://localhost:3000
ISSUER_PORT=8790
```

`TRACE_API_ORIGIN` はパス・クエリ・ユーザー情報を含まない HTTPS オリジンです。開発用 `localhost` / `127.0.0.1` のみ HTTP を許可します。`DISPLAY_ORIGINS` は必須で、Go の **OperatorAllowedOrigins** と一致する承認済みオリジンだけに絞ってください。Go が Edge secret を要求する場合は同じ値を設定します。長期の発行用署名鍵や更新間隔の環境設定はありません。

`/display` と `/log` のビルド設定:

```dotenv
NEXT_PUBLIC_DISPLAY_API_URL=https://YOUR-TRACE-B-RENDERER-ORIGIN
NEXT_PUBLIC_GOOGLE_CLIENT_ID=768829535838-9v4875nkjopo91uobrmggneqodmvec85.apps.googleusercontent.com
NEXT_PUBLIC_ARRIVAL_ISSUER_URL=http://127.0.0.1:8790
NEXT_PUBLIC_ARRIVAL_VENUE=GO-CONFIGURED-VENUE
NEXT_PUBLIC_ARRIVAL_CHECKPOINT_ID=GO-CONFIGURED-CHECKPOINT
NEXT_PUBLIC_ARRIVAL_PROOF_KEY_ID=arrival-proof-v1
```

Google の Client ID は本人確認の公開設定で、本人確認を共有しても描画権限と運営権限は共有しません。Go の operator 機能・独立 allowlist を明示的に有効化し、初期の許可アカウントは **async5855@gmail.com のみ**です。描画だけ許可されたアカウントは描画を続けられますが、運営認証エラーが表示され、到着 QR は出ません。ブローカー未設定時も偽の DEMO QR は出ません。

会場・チェックポイント・公開 key ID は Go と `/display`・`/log` で揃えます。完全に同じ署名済み文字列へ復元できるときだけ短い QR 形式を使用し、それ以外は署名済みトークン全体を使用します。key ID は署名鍵そのものではありません。

### Go と描画ブラウザの接続条件

`NEXT_PUBLIC_DISPLAY_API_URL` は参加者用 `/api/backend` ではなく、ブラウザから到達できる **Go のオリジン**です。ローカルでは、例えばブローカーの `TRACE_API_ORIGIN` とともに `http://localhost:8080` に揃えます。HTTPS の展示ページでは HTTPS/WSS の Go オリジンを使用してください。描画用 `POST /v1/operator/display-tokens` と `GET /v1/display/ws` は Go が直接認証するため Edge secret は付けません。その他の運営 API だけはブローカーが Edge secret を追加します。

展示ページを `http://localhost:3000/display` で開く場合、次の各設定にはパスなしの `http://localhost:3000` を許可します。`127.0.0.1` は別 Origin なので混在させません。

- Go の `TRACE_DISPLAY_ALLOWED_ORIGINS`（直接の資格発行・WS）
- Go の `TRACE_OPERATOR_ALLOWED_ORIGINS` とブローカーの `DISPLAY_ORIGINS`（ブローカーは元のブラウザ Origin を Go へ転送）
- Google Web クライアントの承認済み JavaScript 生成元（既存設定を管理者が確認）

現在の UI は同じ Google ID token を2つの独立した資格発行に使用するため、`NEXT_PUBLIC_GOOGLE_CLIENT_ID`、Go の `TRACE_DISPLAY_GOOGLE_CLIENT_ID`、`TRACE_OPERATOR_GOOGLE_CLIENT_ID` は同じ Web client ID に揃えます。メールの許可リストは引き続き描画用・運営用で独立です。Go の `TRACE_DISPLAY_ENABLED`、`TRACE_OPERATOR_ENABLED`、`TRACE_ARRIVAL_ENABLED` は各機能を使用する場合だけ明示的に有効化し、署名鍵は Edge・display・arrival 間で共有しません。

描画の3つの版も Go の既定値に任せず、配布する `models/trace/campus_graph.json` と Go の `internal/route/campus_graph.json` に合わせます。現在の同梱グラフに対応する Go 設定は次の通りです。

```dotenv
TRACE_COORDINATE_VERSION=toyosu-2026-08-28.1
TRACE_CAMPUS_GRAPH_VERSION=toyosu-graph-2026-10-29.1.draft
TRACE_THREE_D_MAP_VERSION=toyosu-3dmap-2026-10-30
```

ブラウザはこの同梱グラフの版と `schemaVersion: 1` を WS の初回認証と後続メッセージに付けます。不一致は Go が close code `4409` で拒否します。版の文字列だけを変更して異なるグラフを接続しないでください。

## 起動と UI スモーク

```sh
node arrival-issuer/issuer.mjs
```

別ターミナルで上記 `NEXT_PUBLIC_*` を設定した `npm run dev` を起動し、許可したオリジンの `/display` を開きます。

1. 未ログインでは QR が空欄であることを確認します。
2. Google ログイン後、描画の `LINK` と運営認証の結果を別々に確認します。
3. 運営権限がある場合だけ到着 QR が表示されます。表示中は15秒ごとに取得し、2分資格は Google 本人確認で更新します。Google 本人確認の期限後は再ログインが必要です。
4. 「ログアウト・現在の運営資格を失効」または「自分の全運営資格を失効」で実際の DELETE を呼び、成功後にメモリ内の資格を消します。失効に失敗した場合はエラーを表示し、成功扱いにしません。
5. Google の権限拒否・ブローカー停止時は QR が消え、明示的な再試行が必要です。描画だけの認証は運営の失敗に巻き込みません。

実 Go へ接続する確認では DevTools の Network で次も確認します（後述の Playwright は API/WS を模擬するため、実接続の証明とは別です）。

- 描画資格は Go への `POST /v1/operator/display-tokens`、WS は同じ Go オリジンの `/v1/display/ws` へ直接接続し、初回送信は `renderer.authenticate`。`display.snapshot` → `renderer.primary.acquire` → `renderer.primary.granted` で `LINK · 再生担当` になります。別の主描画機がいる場合は待機が正常です。
- 運営資格は loopback への `POST /operator/credentials`、QR は `GET /arrival-token`。Google ID token は資格発行だけ、QR 発行と DELETE は opaque operator token だけを使い、ブラウザのどの要求にも `X-Trace-Edge-Secret` がないことを確認します。資格や QR 本文は記録・共有しないでください。
- テスト用 Memory の `/log` で実 QR を読み取った場合は、WS の `participant.arrived` / `arrival.replay.requested` に続き、`arrival.replay.started` への `renderer.ack` 後にのみ再生されることを確認します。写真0枚なら経路アニメーションなしの到着カードが正常です。
- ブローカーを停止すると QR が消え、運営通信エラーが表示される一方、描画 WS は独立していることを確認します。実 Google ログインが使えない場合、実資格発行・到着再生は未検証として扱います。

公開 HTTPS サイトから loopback へ接続するときは、ブラウザのローカルネットワークアクセス許可が必要な場合があります。実 Google アカウント、staging の IAM/ネットワーク、投影機材の確認は別途必要です。このプログラムはそれらの設定やデプロイを行いません。

## ローカル HTTP 契約

すべての経路で Host は実際の待受ポートを含む `localhost` / `127.0.0.1` のみ、Origin は許可リストの正確な1値のみです。URL クエリ、リクエスト本文、重複 Authorization は許可しません。転送先は設定済み Go オリジンの固定パスのみで、リダイレクトには従いません。

| ローカル経路 | Authorization | Go 転送先 |
| --- | --- | --- |
| `POST /operator/credentials` | Google ID token | `POST /v1/operator/credentials` |
| `GET /arrival-token` | opaque operator token | `POST /v1/operator/arrival-proofs` |
| `DELETE /operator/credentials/current` | opaque operator token | 同名 `/v1` 経路 |
| `DELETE /operator/credentials` | opaque operator token | 同名 `/v1` 経路（本人の全資格） |
| `GET /health` | 不要（許可 Origin は必要） | 転送なし、プロセスの応答のみ |

ブローカー起動だけを確認する例（QR 発行は行いません）:

```sh
curl -H 'Origin: http://localhost:3000' http://127.0.0.1:8790/health
```

成功応答もエラーも `Cache-Control: no-store` です。運営 API のエラーはステータスと安全なエラーコードを返し、秘密や本人情報をログ出力しません。QR は Go が署名し、無効な proof は参加者 API の `400 INVALID_ARRIVAL_PROOF` になります。すでに到着した本人の再送は同じ arrival ID と現在の再生状態を取得できます。

描画 WebSocket はブラウザから Go に直接接続します。このブローカーは WS 中継・描画資格の発行をしません。

## 検証コマンド

```sh
npm --prefix arrival-issuer test
npm run test:unit
npm run typecheck
npm run lint
NEXT_STATIC_EXPORT=1 npm run build
```

ブラウザの描画・運営フロー確認は、テスト用環境変数で起動した開発サーバーに対して `npx playwright test tests/display-link.spec.ts` を実行します。本物の参加者データや共有 DB は使用しないでください。
