import { PixelIcon } from "./pixel-icon";
import type { DemoPhotoName } from "./pixel-photo";

/**
 * The demo's campus, simplified on a 120x96 grid. It is a picture of the idea,
 * not the real layout. The route is the made-up morning of the demo: four
 * photos from the main gate to the deck, then the walk to ShibaLab, room 301
 * of the classroom building.
 * Each leg is drawn by how sure the route is, in line pattern as well as
 * colour: solid (high), dashed (medium), dotted (low), and a sparse grey
 * dotted line where the position was not known.
 */

type Point = readonly [number, number];

export type Certainty = "high" | "mid" | "low" | "unknown";

export type Stop = {
  id: string;
  /** Minutes after the first photo (10:12). */
  minutes: number;
  point: Point;
  label: string;
  photo: DemoPhotoName | null;
};

export type Leg = {
  certainty: Certainty;
  /** The estimated walking time; null where the position was not known. */
  walkMinutes: number | null;
  points: Point[];
};

const START_MINUTES = 10 * 60 + 12;

export const STOPS: Stop[] = [
  { id: "gate", minutes: 0, point: [28, 90], label: "正門", photo: "gate" },
  { id: "stalls", minutes: 19, point: [62, 50], label: "中庭の模擬店", photo: "stalls" },
  { id: "research", minutes: 46, point: [42, 38], label: "研究棟のあたり", photo: "research" },
  { id: "deck", minutes: 88, point: [96, 46], label: "運河沿いのデッキ", photo: "deck" },
  { id: "arrival", minutes: 106, point: [84, 29], label: "ShibaLab に到着", photo: null },
];

/** Leg i runs from stop i to stop i + 1. */
export const LEGS: Leg[] = [
  { certainty: "high", walkMinutes: 6, points: [[28, 90], [28, 72], [48, 64], [62, 50]] },
  { certainty: "mid", walkMinutes: 21, points: [[62, 50], [52, 46], [42, 38]] },
  { certainty: "unknown", walkMinutes: null, points: [[42, 38], [50, 31], [74, 31], [96, 46]] },
  { certainty: "low", walkMinutes: 18, points: [[96, 46], [93, 38], [84, 29]] },
];

export const STORY_MINUTES = STOPS[STOPS.length - 1].minutes;

/** ShibaLab's door, just below the classroom building so the star never covers its wall. */
const ARRIVAL = STOPS[STOPS.length - 1].point;

/** The clock time of a moment in the story, to the minute. */
export function storyClock(minutes: number): string {
  const total = START_MINUTES + Math.floor(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const STROKE: Record<Certainty, { stroke: string; width: number; dash?: string }> = {
  high: { stroke: "#ffd23f", width: 2 },
  mid: { stroke: "#ffd23f", width: 2, dash: "5 3" },
  low: { stroke: "#ffd23f", width: 2, dash: "2 3" },
  unknown: { stroke: "#9aa0c4", width: 1.5, dash: "1.5 4" },
};

/** A short sample of a leg's line, for the legend and the story's timeline. */
export function LineSample({ certainty, className }: { certainty: Certainty; className?: string }) {
  const style = STROKE[certainty];
  return (
    <svg viewBox="0 0 24 6" width={36} height={9} className={className} aria-hidden="true">
      <line x1={1} y1={3} x2={23} y2={3} stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} />
    </svg>
  );
}

/** The first part of a polyline, `fraction` of its length. */
function partial(points: Point[], fraction: number): Point[] {
  if (fraction >= 1) return points;
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  let left = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, fraction);
  const out: Point[] = [points[0]];
  for (let index = 0; index < lengths.length; index += 1) {
    if (left >= lengths[index]) {
      out.push(points[index + 1]);
      left -= lengths[index];
      continue;
    }
    const k = lengths[index] === 0 ? 0 : left / lengths[index];
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    out.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]);
    break;
  }
  return out;
}

type Block = { x: number; y: number; width: number; height: number; label: string };

const BUILDINGS: Block[] = [
  { x: 6, y: 6, width: 34, height: 26, label: "研究棟" },
  { x: 56, y: 8, width: 34, height: 16, label: "教室棟" },
  { x: 36, y: 70, width: 22, height: 18, label: "本部棟" },
  { x: 64, y: 68, width: 26, height: 18, label: "交流棟" },
];

type Props = {
  /** How far into the story to draw, in minutes; null draws the whole day without the walker. */
  minutes: number | null;
  /** A ring of light at each photo spot as the walker reaches it. */
  ripples?: boolean;
  className?: string;
};

export function DemoMap({ minutes, ripples = false, className }: Props) {
  const now = minutes ?? STORY_MINUTES;
  const reached = STOPS.filter((stop) => stop.minutes <= now);
  const drawn = LEGS.map((leg, index) => {
    const from = STOPS[index].minutes;
    const to = STOPS[index + 1].minutes;
    return { leg, points: now <= from ? [] : partial(leg.points, (now - from) / (to - from)) };
  });
  const current = drawn.findLast((item) => item.points.length > 0);
  const walker = minutes !== null && minutes < STORY_MINUTES && current ? current.points[current.points.length - 1] : null;
  const arrived = now >= STORY_MINUTES;

  return (
    <svg
      viewBox="0 0 120 96"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="キャンパスの地図（イメージ）。正門から中庭、研究棟のあたり、運河沿いのデッキを通って、教室棟の ShibaLab まで歩いた道のり"
    >
      <rect width={120} height={96} fill="#262e6b" />

      {/* The canal along the east side, and the deck beside it. */}
      <rect x={106} y={0} width={14} height={96} fill="#1d4fa8" />
      {[8, 22, 37, 52, 66, 81].map((y, index) => (
        <rect key={y} x={index % 2 ? 110 : 113} y={y} width={4} height={1} fill="#67e8f9" opacity={0.7} />
      ))}
      <text x={113} y={48} fontSize={4.5} fill="#fff7e6" textAnchor="middle" dominantBaseline="central" writingMode="vertical-rl">
        運河
      </text>
      <rect x={96} y={22} width={10} height={52} fill="#6b4a2a" />
      {Array.from({ length: 17 }, (_, index) => (
        <rect key={index} x={96} y={24 + index * 3} width={10} height={1} fill="#83592f" />
      ))}
      <text x={101} y={79} fontSize={4.5} fill="#fff7e6" textAnchor="middle" dominantBaseline="central">
        デッキ
      </text>

      {/* The courtyard. */}
      <rect x={44} y={34} width={38} height={24} fill="#2c6a4a" />
      {[[48, 38], [56, 44], [74, 38], [78, 52], [50, 54]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={2} height={2} fill="#3f8f5f" />
      ))}
      <text x={52} y={38.5} fontSize={4.5} fill="#fff7e6" textAnchor="middle" dominantBaseline="central">
        中庭
      </text>

      {BUILDINGS.map((block) => (
        <g key={block.label}>
          <rect x={block.x} y={block.y} width={block.width} height={block.height} fill="#0b0d1f" />
          <rect x={block.x + 1} y={block.y + 1} width={block.width - 2} height={block.height - 2} fill="#38418f" />
          <rect x={block.x + 1} y={block.y + 1} width={block.width - 2} height={1} fill="#4c56ad" />
          <text x={block.x + block.width / 2} y={block.y + block.height / 2 + 0.5} fontSize={4.5} fill="#e4e7fa" textAnchor="middle" dominantBaseline="central">
            {block.label}
          </text>
        </g>
      ))}

      {/* The main gate: two posts at the south edge. */}
      <rect x={22} y={89} width={3} height={6} fill="#a9adc2" />
      <rect x={31} y={89} width={3} height={6} fill="#a9adc2" />
      <text x={12} y={92} fontSize={4.5} fill="#fff7e6" textAnchor="middle" dominantBaseline="central">
        正門
      </text>

      {drawn.map(({ leg, points }, index) =>
        points.length > 1 ? (
          <polyline
            key={index}
            points={points.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke={STROKE[leg.certainty].stroke}
            strokeWidth={STROKE[leg.certainty].width}
            strokeDasharray={STROKE[leg.certainty].dash}
            strokeLinejoin="miter"
            shapeRendering="auto"
          />
        ) : null,
      )}

      {reached
        .filter((stop) => stop.photo)
        .map((stop) => (
          <g key={stop.id}>
            {ripples && <circle className="px-map-ripple" cx={stop.point[0]} cy={stop.point[1]} r={3} />}
            <rect x={stop.point[0] - 2.5} y={stop.point[1] - 2.5} width={5} height={5} fill="#0b0d1f" />
            <rect x={stop.point[0] - 1.5} y={stop.point[1] - 1.5} width={3} height={3} fill="#fff7e6" />
          </g>
        ))}

      {walker && (
        <g>
          <rect x={Math.round(walker[0]) - 2} y={Math.round(walker[1]) - 2} width={4} height={4} fill="#0b0d1f" />
          <rect x={Math.round(walker[0]) - 1} y={Math.round(walker[1]) - 1} width={2} height={2} fill={current?.leg.certainty === "unknown" ? "#9aa0c4" : "#fff1a8"} />
        </g>
      )}

      {arrived && (
        <g>
          {ripples && <circle className="px-map-ripple" cx={ARRIVAL[0]} cy={ARRIVAL[1]} r={4} />}
          <g transform={`translate(${ARRIVAL[0] - 4.5} ${ARRIVAL[1] - 4.5})`} className="text-(--px-yellow)">
            <rect x={-0.5} y={-0.5} width={10} height={10} fill="#0b0d1f" />
            <PixelIcon name="star" size={9} />
          </g>
        </g>
      )}
    </svg>
  );
}
