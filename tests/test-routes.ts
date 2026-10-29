/**
 * Walks the exhibit should replay without passing through walls (issue #76):
 * the stops a tester passes as /display?stops=..., in order. Shared by
 * tests/unit/test-routes.test.mjs (floors and the way between them) and
 * tests/display.spec.ts (the walk plays through to ShibaLab).
 *
 * floorChanges: each change of height on the walk, as "from→to kind" (metres).
 * Stops ending in -car are the elevator cars (the floor's own point is further
 * down its corridor), so a walk rides through without a detour.
 * bridges: the heights where the walk crosses a bridge.
 */
export interface TestRoute {
  id: string;
  name: string;
  stops: string[];
  floorChanges: string[];
  bridges: number[];
}

export const TEST_ROUTES: TestRoute[] = [
  {
    id: "A",
    name: "研究棟 11F 運河側 → EV B で 6F → 渡り廊下 → 教室棟 6F → エスカレーターで 3F → ShibaLab",
    stops: ["research-11f-east", "classroom-research-6f-bridge", "k6-019", "shibalab"],
    floorChanges: ["48.3→44.4 elevator", "44.4→40.5 elevator", "40.5→36 elevator", "36→31 elevator", "31→26 elevator", "26→21 escalator", "21→16 escalator", "16→11 escalator"],
    bridges: [26],
  },
  {
    id: "B",
    name: "本部棟 11F → EV で 4F → 渡り廊下 → 交流棟 4F → 渡り廊下 → 教室棟 4F → エスカレーターで 3F → ShibaLab",
    stops: ["hq-11f", "hq-4f-bridge", "x4-025", "x4-024", "classroom-4f-lobby", "classroom-3f-lobby", "shibalab"],
    floorChanges: ["48→43.6 elevator", "43.6→39.2 elevator", "39.2→34.8 elevator", "34.8→30.4 elevator", "30.4→26 elevator", "26→21 elevator", "21→16 elevator", "16→11 escalator"],
    bridges: [16],
  },
  {
    id: "C",
    name: "研究棟 14F 教室棟側 → EV A で 3F → 教室棟 3F → ShibaLab",
    stops: ["research-14f", "research-3f-car", "classroom-3f-kenkyu", "shibalab"],
    floorChanges: ["60→56.1 elevator", "56.1→52.2 elevator", "52.2→48.3 elevator", "48.3→44.4 elevator", "44.4→40.5 elevator", "40.5→36 elevator", "36→31 elevator", "31→26 elevator", "26→21 elevator", "21→16 elevator", "16→11 elevator"],
    bridges: [],
  },
  {
    id: "D",
    name: "研究棟 5F 運河側 → EV B で 2F → 芝生 → 教室棟の曲がり角 2F → EV A で 3F → ShibaLab",
    stops: ["research-5f-east", "research-2f-east-car", "research-gate", "research-2f-car", "shibalab"],
    floorChanges: ["21→16 elevator", "16→11 elevator", "11→6 elevator", "6→11 elevator"],
    bridges: [],
  },
  {
    id: "E",
    name: "研究棟 10F 運河側 → EV B で 8F → 8F を渡る → EV A で 3F → ShibaLab",
    stops: ["research-10f-east", "research-8f-east-car", "research-8f-car", "research-3f-car", "shibalab"],
    floorChanges: ["44.4→40.5 elevator", "40.5→36 elevator", "36→31 elevator", "31→26 elevator", "26→21 elevator", "21→16 elevator", "16→11 elevator"],
    bridges: [],
  },
  {
    id: "F",
    name: "SIT の芝生 → ゲート → 北の外階段で道路へ → 教室棟の道路側 → ShibaLab",
    stops: ["sit-lawn", "research-gate", "research-road", "classroom-road", "shibalab"],
    floorChanges: ["6→0 stairs", "0→6 escalator", "6→11 escalator"],
    bridges: [],
  },
  {
    id: "G",
    name: "大学入口 → 本部棟ピロティ → 玄関 → EV で 4F → 渡り廊下 → 交流棟 → 教室棟 → ShibaLab",
    stops: ["o-126", "hq-piloti", "hq-entrance", "hq-4f-bridge", "x4-025", "x4-024", "classroom-4f-lobby", "shibalab"],
    floorChanges: ["0→6 elevator", "6→11 elevator", "11→16 elevator", "16→11 escalator"],
    bridges: [16],
  },
  {
    id: "H",
    name: "本部棟 2F → EV で 6F → 渡り廊下 → 交流棟 6F 大講義室 → 教室棟 6F → ShibaLab",
    stops: ["hq-2f", "hq-6f-bridge", "x6-022", "exchange-6f-hall", "x6-021", "k6-019", "shibalab"],
    floorChanges: ["6→11 elevator", "11→16 elevator", "16→21 elevator", "21→26 elevator", "26→21 escalator", "21→16 escalator", "16→11 escalator"],
    bridges: [26],
  },
  {
    id: "I",
    name: "本部棟 3F → 大階段で 4F → 渡り廊下 → 交流棟 4F → 教室棟 4F → ShibaLab",
    stops: ["hq-3f", "hq-4f-hall", "hq-4f-bridge", "x4-025", "x4-024", "classroom-4f-lobby", "shibalab"],
    floorChanges: ["11→16 stairs", "16→11 escalator"],
    bridges: [16],
  },
  {
    id: "J",
    name: "交流棟 1F 入口 → EV で 2F → 渡り廊下 → 教室棟 2F → エスカレーターで 3F → ShibaLab",
    stops: ["exchange-1f", "exchange-2f-car", "x2-006", "k1-008", "shibalab"],
    floorChanges: ["0→6 elevator", "6→11 escalator"],
    bridges: [6],
  },
  {
    id: "K",
    name: "交流プラザ → 玄関の階段 → 広場 → 教室棟の入口 → ShibaLab",
    stops: ["koryu-plaza", "o-081", "classroom-entrance", "shibalab"],
    floorChanges: ["0.8→0 stairs", "0→6 escalator", "6→11 escalator"],
    bridges: [],
  },
  {
    id: "L",
    name: "研究棟 運河側の端 → 大階段 → 芝生 → 教室棟の曲がり角 2F → EV A で 3F → ShibaLab",
    stops: ["research-south", "grand-stairs-bottom", "sit-lawn", "research-gate", "research-2f-car", "shibalab"],
    floorChanges: ["0→2 stairs", "2→4 stairs", "4→6 stairs", "6→11 elevator"],
    bridges: [],
  },
  {
    id: "M",
    name: "教室棟 7F の庭園 → 7F のエスカレーターの着き場 → エスカレーターで 3F → ShibaLab",
    stops: ["classroom-7f-koryu", "classroom-7f", "k6-019", "shibalab"],
    floorChanges: ["31→26 escalator", "26→21 escalator", "21→16 escalator", "16→11 escalator"],
    bridges: [],
  },
  {
    id: "N",
    name: "本部棟 10F → EV で 1F → ロビー → 玄関 → 外 → 教室棟の入口 → ShibaLab",
    stops: ["hq-10f", "hq-1f-car", "hq-entrance", "classroom-entrance", "shibalab"],
    floorChanges: ["43.6→39.2 elevator", "39.2→34.8 elevator", "34.8→30.4 elevator", "30.4→26 elevator", "26→21 elevator", "21→16 elevator", "16→11 elevator", "11→6 elevator", "6→0 elevator", "0→6 escalator", "6→11 escalator"],
    bridges: [],
  },
];
