# 到着トークン発行プログラム（arrival-issuer）

展示用 PC で、開場しているあいだずっと動かすプログラムです。
TRACE_B から到着 QR のトークンを15秒ごとに受け取り、同じ PC の /display に渡します。
/display はトークンを QR にして投影し、参加者は /log の中のカメラでそれを読みます。

TRACE_B の運営用の鍵（`TRACE_ARRIVAL_ISSUER_KEY`）は、このプログラムの中だけで使います。
ブラウザ、QR、ログには出しません。/display が受け取るのは、投影するためのトークンだけです。

このプログラムは到着 QR の発行専用です。展示画面の WebSocket は中継しません。
展示画面は最終的にブラウザから TRACE_B へ直接 WSS 接続しますが、ブラウザ用の認証方式が整うまではテスト再生に留めます。

## 準備

Node.js 22 以上が要ります。追加パッケージのインストールは不要です。

このフォルダに `.env` を置きます（git には入りません）。

```
TRACE_API_ORIGIN=TRACE_B の運営用の入口（https://...、パスは付けない）
TRACE_ARRIVAL_ISSUER_KEY=TRACE_B の TRACE_ARRIVAL_ISSUER_KEY と同じ値
TRACE_EDGE_SHARED_SECRET=TRACE_B が求めるときだけ書く。TRACE_B と同じ値
DISPLAY_ORIGINS=/display を開くオリジン。複数あるときはカンマで区切る
```

`DISPLAY_ORIGINS` の例は `https://trace-log.async5855.workers.dev,http://localhost:3000` です。
ほかに、待ち受けるポート `ISSUER_PORT`（既定は 8790）と、取り直す間隔 `REFRESH_SECONDS`（既定は 15、5〜20）を変えられます。

/display を書き出すときは、`NEXT_PUBLIC_ARRIVAL_ISSUER_URL=http://127.0.0.1:8790` を設定します。
設定しないと、/display の QR は見本（ARRIVAL QR · DEMO）のままです。

あわせて、`NEXT_PUBLIC_ARRIVAL_VENUE` と `NEXT_PUBLIC_ARRIVAL_CHECKPOINT_ID` に、TRACE_B の `TRACE_ARRIVAL_VENUE` と `TRACE_ARRIVAL_CHECKPOINT_ID` と同じ値を設定します。
/display は、到着トークンから会場とチェックポイントを省いて短くし、33×33 の QR（誤り訂正 L）で映します。
/log は、同じ2つの値でトークンを組み立て直して TRACE_B に送るので、公開する /log のビルドにも同じ値が要ります（push-worker の `.env` の `ARRIVAL_VENUE` と `ARRIVAL_CHECKPOINT_ID`）。
/display に値がないときや、トークンを同じ文字列に組み立て直せないときは、トークンをそのまま QR にします。そのときの QR は細かくなります。

## 動かす

リポジトリのルートで次を実行し、閉場まで止めずにおきます。止めるときは Ctrl+C を押します。

```bash
node arrival-issuer/issuer.mjs
```

`http://127.0.0.1:8790/health` を開くと、最後にトークンを取れた時刻と、最後に失敗した理由が分かります。
公開サイトの /display からこのプログラムを読むとき、Chrome がこの PC の中のサービスへのアクセスを許可するか尋ねることがあります。そのときは許可してください。

テストは次のとおりです。

```bash
npm --prefix arrival-issuer test
```

## 動き

- 15秒ごとに `POST /v1/operator/arrival-proofs` を呼びます。トークンは25秒有効なので、取り直しに1回失敗しても前のトークンを出し続けられます。
- 残りが5秒を切ったトークンは渡しません。/display は QR を消し、「ARRIVAL QR · OFFLINE」と出します。
- TRACE_B が 429 を返したときは、`Retry-After` の秒数だけ待ってから取り直します。
- 127.0.0.1 でだけ待ち受けます。`DISPLAY_ORIGINS` にないオリジンのページや、別のホスト名で来た読み取りは断ります。

## 展示画面の WebSocket（未接続）

`/display-ws` は提供しません。HTTP の読み取りと WebSocket の Upgrade 要求は 404 になります。
表示用トークンの発行、描画用の鍵や版の設定も、このプログラムの責務ではありません。

到着 QR を読み取っても、この変更だけでは行動ログの自動再生にはつながりません。
ブラウザからの直接 WSS 接続が整うまでは、/display のテスト再生を使います。
PR #49 の `ws` クエリと `NEXT_PUBLIC_DISPLAY_WS_URL` は未設定にし、旧中継の URL を指定しないでください。

## 本番接続までに必要な対応

- TRACE_B の運営用の入口。TRACE_B の README は、運営用の API を参加者サイトの Worker を通さず、許可した機器だけが届く入口から呼ぶよう求めています。今の staging は IAM で守られていて、このプログラムからは呼べません。
- ブラウザ向けの直接 WSS 認証。TRACE_B の現行接続口は Origin を拒否し、Bearer と版の HTTP ヘッダーを要求するため、ブラウザから URL を指定するだけでは接続できません。運営者の本人確認と短命トークンの発行方式を含めた対応が必要です。運営用の鍵をブラウザや公開環境変数に渡して代用しないでください。
- /display の接続処理。PR #49 が前提としているローカル中継を直接接続に変更し、TRACE_B の投影データと再生 ACK の契約に合わせる必要があります。
