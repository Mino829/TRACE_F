# 到着トークン発行プログラム（arrival-issuer）

展示用 PC で、開場しているあいだずっと動かすプログラムです。
TRACE_B から到着 QR のトークンを15秒ごとに受け取り、同じ PC の /display に渡します。
/display はトークンを QR にして投影し、参加者は /log の中のカメラでそれを読みます。

TRACE_B の運営用の鍵（`TRACE_ARRIVAL_ISSUER_KEY`）は、このプログラムの中だけで使います。
ブラウザ、QR、ログには出しません。/display が受け取るのは、投影するためのトークンだけです。

## 準備

Node.js 22 以上が要ります。追加のパッケージは要りません。

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

## 動かす

リポジトリのルートで次を実行し、閉場まで止めずにおきます。止めるときは Ctrl+C を押します。

```bash
node arrival-issuer/issuer.mjs
```

`http://127.0.0.1:8790/health` を開くと、最後にトークンを取れた時刻と、最後に失敗した理由が分かります。
公開サイトの /display からこのプログラムを読むとき、Chrome がこの PC の中のサービスへのアクセスを許可するか尋ねることがあります。そのときは許可してください。

テストは次のとおりです。

```bash
node --test arrival-issuer/test/issuer.test.mjs
```

## 動き

- 15秒ごとに `POST /v1/operator/arrival-proofs` を呼びます。トークンは25秒有効なので、取り直しに1回失敗しても前のトークンを出し続けられます。
- 残りが5秒を切ったトークンは渡しません。/display は QR を消し、「ARRIVAL QR · OFFLINE」と出します。
- TRACE_B が 429 を返したときは、`Retry-After` の秒数だけ待ってから取り直します。
- 127.0.0.1 でだけ待ち受けます。`DISPLAY_ORIGINS` にないオリジンのページや、別のホスト名で来た読み取りは断ります。

## まだ決まっていないこと

- TRACE_B の運営用の入口。TRACE_B の README は、運営用の API を参加者サイトの Worker を通さず、許可した機器だけが届く入口から呼ぶよう求めています。今の staging は IAM で守られていて、このプログラムからは呼べません。
- 展示画面を TRACE_B の WebSocket（`/v1/display/ws`）につなぐ役。TRACE_B の README は、表示用トークンをブラウザに渡さないよう求めています。ブラウザの /display は直接つなげないので、このプログラムのような PC 側のプログラムが中継することになります。
