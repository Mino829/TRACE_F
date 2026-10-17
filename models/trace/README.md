# TRACE チェックポイント（CampusGraph）

担当：渡部　／　2026-10-17 下書き（#8）

来場者の位置（誤差 15〜30m）を近いチェックポイントにまとめて、点から点へ光の線でたどるためのデータです。
**バックエンドで使うのは `campus_graph.json` だけです。**

![まとめ](figures/00_まとめ.jpg)

## campus_graph.json

- 点 23 か所（外 14・建物の中 9）・つながり 34 本。`campusGraphVersion` は `toyosu-graph-2026-10-17.draft`
- 点（`nodes`）

| 項目 | 中身 |
|---|---|
| `id` / `name` | 例：`classroom-entrance` / 教室棟・交流棟の入口（アプリの原点） |
| `building` / `floor` | 建物と階（屋外は `null` / `屋外`） |
| `lat` / `lon` | 緯度経度（WGS84） |
| `local.east` / `local.north` | アプリのローカル座標（m）。原点 = 教室棟1F南面の自動ドア。`coordinateVersion` = `toyosu-2026-08-28.1` の式で緯度経度から計算 |
| `heightMetres` | 地面からの高さ。MVP は高さ固定なので経路の計算には使わない（演出用） |
| `threeD` | 3DCG（`キャンパス全体.blend`）の座標。1 = 1m、Z が上 |
| `radiusMetres` | この点にまとめる範囲（今は全部 15m） |
| `gpsSnap` | `true` = GPS の位置をこの点にまとめてよい。`false` = 建物の上の階の点。GPS では階を見分けられないので演出だけに使う |

- つながり（`edges`）：`from` / `to` / `kind`（`ground` 地上の道・`stairs` 階段・`escalator` エスカレーター・`indoor` 建物の中・`bridge` 渡り廊下）/ `lengthMetres`（平面の直線距離）/ `passable`
- `gpsSnap: true` の点どうしは、すべて 30m 以上離してある

## 決めたこと
- 建物の中は**第54回芝浦祭（2026/10/31〜11/1）の会場の階**だけ（[芝浦祭のフロアマップ](https://shibaurasai.jp/map54/)）。研究棟の中は作らない
  - 教室棟：3F（ShibaLab は **301**・ロビー）、4F（403〜408）、5F（502〜511）、6F（交流棟の大講義室への渡り廊下の口）
  - 交流棟：4F（401・402）、6F（大講義室）
  - 本部棟：会場はないが、交流棟と渡り廊下でつながる 4F・6F
  - 階どうしはエスカレーター・階段、建物どうしは渡り廊下（教室棟〜交流棟は 4F・6F、交流棟〜本部棟は 4F・6F）でつないだ
- 外の点は増やさない（2026-10-17 ユーザーの判断。いったん 7 か所足したが戻した）
- 3DCG の座標は PLATEAU と同じ平面直角座標系 第IX系なので、そのまま緯度経度に直せる。アプリの原点を 3DCG に置くと、教室棟の壁から 0.45m 以内に乗る（アプリと 3DCG の座標はずれていない）
- ⑯ 大樹（豊洲駅側の角）は、芝浦祭のキャンパス図で豊洲駅から来る入口になっているので足した

## まだ決まっていないこと
- 位置の確認：⑩ 本部棟 玄関・⑪ ピロティ・⑯ 大樹（推定）、⑤ 研究棟 道路側の口の高さ
- つながりは点どうしを直線で結んだだけ。建物の上を通る線（⑧→⑯ など）があるので、道に沿う形（途中の点）を足す
- #8 のコメントにある、node/edge ID の決まり・通行止め・版の組み合わせ（`coordinateVersion` / `campusGraphVersion` / `threeDMapVersion`）

## 軌跡の見せ方（試した結果）
- 線を 3D の中にそのまま置くと、本部棟のピロティ・研究棟のゲートの下・教室棟の中などで建物に隠れて、ほとんど見えない（`figures/04`）
- 建物を消すと、階の重なりと渡り廊下が見える（`figures/08`）
- 建物と線を別々にレンダーして、線をグローつきで上に重ねると、全体の道すじがはっきり見える（`figures/05`・`06`）。TouchDesigner でも同じようにレイヤーを重ねる想定
- 角を丸めた線（`06`）の方が光が流れる感じが出る

## ファイル

```
trace/
├─ campus_graph.json        ← バックエンドに渡すもの（export() で書き出す）
├─ campus_graph.src.json    ← 元データ（点の位置 = 3DCG の座標）
├─ trace_graph.py           ← Blender で点と線を置く・書き戻す・書き出す
├─ render_graph_plan.py / label_graph_plan.py   ← 配置図（figures/01）
├─ render_figures.py / glow_composite.py         ← 3D の図と軌跡の例（figures/02・04〜06・08）
├─ fig_3F_and_table.py / fig_summary.py          ← 3F の図・一覧表・まとめ（figures/03・07・00）
└─ figures/
```

座標の変換は `../scripts/trace_geo.py`（第IX系 ↔ 緯度経度 ↔ アプリのローカル座標）。

## 点を動かすとき（Blender 5.2）
1. `キャンパス全体.blend` を開く。点はコレクション `30_TRACE_チェックポイント` の空オブジェクト `CP_<id>`。動かすと線もついてくる
2. Python コンソールで `exec(open(r"<models のパス>/trace/trace_graph.py", encoding="utf-8").read())`
3. `pull()`（動かした位置を `campus_graph.src.json` へ）→ `export()`（`campus_graph.json` を書き出す）
- 元データから作り直すときは `build()`。`scripts/make_campus_all.py` の最後でも `build()` するので、作り直しても点は消えない
- 図はレンダーしたあと PNG を JPG にして入れている
