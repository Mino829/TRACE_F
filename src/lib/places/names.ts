/**
 * English names of the checkpoints in places.json, by id, for /log in English.
 * A checkpoint missing here (places.json regenerated with a new one) keeps
 * its Japanese name.
 */

import { lang } from "@/lib/i18n";

import type { BuildingId } from "./types";

const BUILDINGS: Record<BuildingId, string> = {
  kenkyu: "Research Building",
  kyoshitsu: "Classroom Building",
  koryu: "Exchange Building",
  honbu: "Headquarters Building",
  outdoor: "Outdoors",
};

const CHECKPOINTS: Record<string, string> = {
  "grand-stairs-bottom": "Foot of the grand stairs (plaza)",
  "sit-lawn": "SIT lawn (top of the grand stairs)",
  "classroom-research-corner": "Corner of the Classroom and Research Buildings",
  "hq-exchange-bridge": "Under the bridge between the Headquarters and Exchange Buildings",
  "hq-entrance": "Headquarters Building entrance",
  "koryu-plaza": "Exchange Plaza",
  "research-south": "Research Building, canal end",
  "classroom-3f-lobby": "Classroom Building 3F, escalator",
  shibalab: "ShibaLab (Classroom Building 3F, Room 301)",
  "classroom-4f-lobby": "Classroom Building 4F, escalator",
  "classroom-5f-lobby": "Classroom Building 5F, escalator",
  "exchange-4f": "Exchange Building 4F, Rooms 401 and 402",
  "exchange-6f-hall": "Exchange Building 6F, large lecture hall",
  "hq-4f-bridge": "Headquarters Building 4F, bridge entrance",
  "hq-6f-bridge": "Headquarters Building 6F, bridge entrance",
  "o-126": "University entrance",
  "k1-005": "Classroom Building 1F, escalator",
  "k1-008": "Classroom Building 2F, escalator",
  "k6-019": "Classroom Building 6F, escalator",
  "x4-024": "Bridge between the Classroom and Exchange Buildings, 4F",
  "x6-021": "Bridge between the Classroom and Exchange Buildings, 6F",
  "x2-001": "Exchange Building 2F, shop",
  "x2-006": "Bridge between the Classroom and Exchange Buildings, 2F",
  "classroom-7f": "Classroom Building 7F, escalator",
  "exchange-1f": "Exchange Building 1F, gym",
  "exchange-3f": "Exchange Building 3F, cafeteria",
  "exchange-5f": "Exchange Building 5F",
  "hq-2f": "Headquarters Building 2F",
  "hq-5f": "Headquarters Building 5F",
  "hq-7f": "Headquarters Building 7F",
  "hq-8f": "Headquarters Building 8F",
  "hq-9f": "Headquarters Building 9F",
  "research-1f": "Research Building 1F, Classroom Building side",
  "research-2f": "Research Building 2F, Classroom Building side",
  "research-3f": "Research Building 3F, Classroom Building side",
  "research-4f": "Research Building 4F, Classroom Building side",
  "research-5f": "Research Building 5F, Classroom Building side",
  "research-6f": "Research Building 6F, Classroom Building side",
  "research-7f": "Research Building 7F, Classroom Building side",
  "research-8f": "Research Building 8F, Classroom Building side",
  "research-9f": "Research Building 9F, Classroom Building side",
  "research-10f": "Research Building 10F, Classroom Building side",
  "research-11f": "Research Building 11F, Classroom Building side",
  "research-12f": "Research Building 12F, Classroom Building side",
  "research-13f": "Research Building 13F, Classroom Building side",
  "research-14f": "Research Building 14F, Classroom Building side",
  "hq-10f": "Headquarters Building 10F",
  "hq-11f": "Headquarters Building 11F",
  "hq-12f": "Headquarters Building 12F",
  "hq-13f": "Headquarters Building 13F",
  "hq-14f": "Headquarters Building 14F",
  "hq-3f": "Headquarters Building 3F",
  "classroom-research-6f-bridge": "Bridge between the Classroom and Research Buildings, 6F",
  "classroom-8f": "Classroom Building 8F, escalator",
  "classroom-1f-koryu": "Classroom Building 1F, Exchange Building side",
  "classroom-1f-kenkyu": "Classroom Building 1F, Research Building side",
  "classroom-2f-koryu": "Classroom Building 2F, Exchange Building side",
  "classroom-2f-kenkyu": "Classroom Building 2F, Research Building side",
  "classroom-3f-kenkyu": "Classroom Building 3F, Research Building side",
  "classroom-4f-koryu": "Classroom Building 4F, Exchange Building side",
  "classroom-4f-kenkyu": "Classroom Building 4F, Research Building side",
  "classroom-5f-koryu": "Classroom Building 5F, Exchange Building side",
  "classroom-5f-kenkyu": "Classroom Building 5F, Research Building side",
  "classroom-6f-koryu": "Classroom Building 6F, Exchange Building side",
  "classroom-6f-kenkyu": "Classroom Building 6F, Research Building side",
  "classroom-7f-koryu": "Classroom Building 7F, Exchange Building side",
  "classroom-7f-kenkyu": "Classroom Building 7F, Research Building side",
  "classroom-8f-kenkyu": "Classroom Building 8F, Research Building side",
  "research-1f-east": "Research Building 1F, canal side",
  "research-2f-east": "Research Building 2F, canal side",
  "research-3f-east": "Research Building 3F, canal side",
  "research-4f-east": "Research Building 4F, canal side",
  "research-5f-east": "Research Building 5F, canal side",
  "research-6f-east": "Research Building 6F, canal side",
  "research-7f-east": "Research Building 7F, canal side",
  "research-8f-east": "Research Building 8F, canal side",
  "research-9f-east": "Research Building 9F, canal side",
  "research-10f-east": "Research Building 10F, canal side",
  "research-11f-east": "Research Building 11F, canal side",
  "research-12f-east": "Research Building 12F, canal side",
  "research-13f-east": "Research Building 13F, canal side",
  "research-14f-east": "Research Building 14F, canal side",
};

/** A checkpoint's name in the participant's language. */
export function placeName(id: string, name: string): string {
  return lang() === "en" ? (CHECKPOINTS[id] ?? name) : name;
}

/** A building's name in the participant's language. */
export function buildingLabel(id: BuildingId, name: string): string {
  return lang() === "en" ? BUILDINGS[id] : name;
}

/** A floor's label: "3F" as it is, the open ground as Outdoors. */
export function floorLabel(label: string): string {
  return lang() === "en" ? label.replace("屋外", "Outdoors ").trim() : label;
}
