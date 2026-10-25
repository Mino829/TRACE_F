# 到着トークン発行プログラム（arrival-issuer）

展示用 PC で、開場しているあいだずっと動かすプログラムです。
TRACE_B から到着 QR のトークンを15秒ごとに受け取り、同じ PC の /display に渡します。
/display はトークンを QR にして投影し、参加者は /log の中のカメラでそれを読みます。

TRACE_B の運営用の鍵（`TRACE_ARRIVAL_ISSUER_KEY`）は、このプログラムの中だけで使います。
ブラウザ、QR、ログには出しません。/display が受け取るのは、投影するためのトークンだけです。

同じプログラムが、/display の WebSocket を TRACE_B の `/v1/display/ws` へ中継します。
TRACE_B は表示用トークンをブラウザに渡さないよう求めているので、ブラウザの /display は TRACE_B に直接つなげません。

## 準備

Node.js 22 以上が要ります。最初に一度、リポジトリのルートで次を実行して ws を入れます。

```bash
npm --prefix arrival-issuer install
```

このフォルダに `.env` を置きます（git には入りません）。

```
TRACE_API_ORIGIN=TRACE_B の運営用の入口（https://...、パスは付けない）
TRACE_ARRIVAL_ISSUER_KEY=TRACE_B の TRACE_ARRIVAL_ISSUER_KEY と同じ値
TRACE_EDGE_SHARED_SECRET=TRACE_B が求めるときだけ書く。TRACE_B と同じ値
DISPLAY_ORIGINS=/display を開くオリジン。複数あるときはカンマで区切る
TRACE_DISPLAY_ISSUER_KEY=TRACE_B の TRACE_DISPLAY_ISSUER_KEY と同じ値（WebSocket を中継するときだけ）
TRACE_COORDINATE_VERSION=TRACE_B の設定と同じ版（中継するときだけ）
TRACE_CAMPUS_GRAPH_VERSION=TRACE_B の設定と同じ版（中継するときだけ）
TRACE_THREE_D_MAP_VERSION=TRACE_B の設定と同じ版（中継するときだけ）
```

`TRACE_DISPLAY_ISSUER_KEY` を書かなければ、WebSocket は中継しません。そのとき `/display-ws` は 503 を返します。

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
npm --prefix arrival-issuer test
```

## 動き

- 15秒ごとに `POST /v1/operator/arrival-proofs` を呼びます。トークンは25秒有効なので、取り直しに1回失敗しても前のトークンを出し続けられます。
- 残りが5秒を切ったトークンは渡しません。/display は QR を消し、「ARRIVAL QR · OFFLINE」と出します。
- TRACE_B が 429 を返したときは、`Retry-After` の秒数だけ待ってから取り直します。
- 127.0.0.1 でだけ待ち受けます。`DISPLAY_ORIGINS` にないオリジンのページや、別のホスト名で来た読み取りは断ります。

## 展示画面の WebSocket の中継

/display は `ws://127.0.0.1:8790/display-ws` につなぎます。つないだ先の中身は、TRACE_B の `/v1/display/ws` と同じです。
中継はメッセージ、ping、pong を変えずに両方向へ流し、TRACE_B へつなぐときに表示用トークンと3つの版のヘッダーを足すだけです。
そのため /display は、TRACE_B の README の「描画WebSocket」どおりに送受信します。送る JSON には `schemaVersion` と3つの版を入れ、主描画機のリース（`renderer.primary.acquire`）、再生の開始と完了の報告、`renderer.heartbeat` も /display が送ります。

- /display のつなぎ1本ごとに、TRACE_B へのつなぎを1本作ります。どちらかが閉じると、もう一方も閉じます。
- TRACE_B の ping は /display に届き、/display が返した pong だけが TRACE_B に戻ります。中継は代わりに pong を返しません。/display が止まると TRACE_B から見ても応答が止まり、再生中の到着は skipped になります。
- TRACE_B が接続を閉じたときは、その番号と理由のまま /display を閉じます。TRACE_B が接続を断ったときは 4000 に HTTP の状態を足した番号にします（4401 は資格、4409 は版の不一致、4503 は機能が無効）。TRACE_B に届かないときは 1011 です。
- つなぎ直すのは /display の役目です。間隔を少しずつ延ばしながらつなぎ直してください。中継は、つなぎ直しのたびに新しい表示用トークンを取ります。TRACE_B は50分で接続を閉じるので、そのときもつなぎ直します。
- TRACE_B が答える前に /display が送ったメッセージは、64件まで中継が預かり、つながったら順に送ります。

## まだ決まっていないこと

- TRACE_B の運営用の入口。TRACE_B の README は、運営用の API を参加者サイトの Worker を通さず、許可した機器だけが届く入口から呼ぶよう求めています。今の staging は IAM で守られていて、このプログラムからは呼べません。
- /display 側の WebSocket の処理。/display にはまだ、`/display-ws` につないでリースを取り、到着を再生する処理がありません。
