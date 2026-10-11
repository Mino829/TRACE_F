import { PixelIcon } from "./pixel-icon";
import type { DemoPhotoName } from "./pixel-photo";

/**
 * The demo's campus, simplified on a 120x96 grid. It is a picture of the idea,
 * not the real layout. The route is the made-up morning of the demo: four
 * photos from the main gate to the deck, then the walk to ShibaLab, room 301
 * of the classroom building.
 */

type Point = readonly [number, number];

export type Stop = {
  id: string;
  /** Minutes after the first photo (10:12). */
  minutes: number;
  point: Point;
  label: string;
  photo: DemoPhotoName | null;
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
const LEGS: Point[][] = [
  [[28, 90], [28, 72], [48, 64], [62, 50]],
  [[62, 50], [52, 46], [42, 38]],
  [[42, 38], [50, 31], [74, 31], [96, 46]],
  [[96, 46], [93, 38], [84, 29]],
];

/** From the first photo to the arrival, in minutes. */
export const STORY_MINUTES = STOPS[STOPS.length - 1].minutes;

/** ShibaLab's door, just below the classroom building so the star never covers its wall. */
const ARRIVAL = STOPS[STOPS.length - 1].point;

/** The clock time of a moment in the story, to the minute. */
export function storyClock(minutes: number): string {
  const total = START_MINUTES + Math.floor(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type Block = { x: number; y: number; width: number; height: number; label: string };

const BUILDINGS: Block[] = [
  { x: 6, y: 6, width: 34, height: 26, label: "研究棟" },
  { x: 56, y: 8, width: 34, height: 16, label: "教室棟" },
  { x: 36, y: 70, width: 22, height: 18, label: "本部棟" },
  { x: 64, y: 68, width: 26, height: 18, label: "交流棟" },
];

/** The whole route of the demo's day, from the main gate to ShibaLab. */
export function DemoMap({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 96"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="キャンパスの地図（イメージ）。正門から中庭、研究棟のあたり、運河沿いのデッキを通って、教室棟の ShibaLab まで歩いた軌跡"
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

      {LEGS.map((points, index) => (
        <polyline
          key={index}
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="#ffd23f"
          strokeWidth={2}
          strokeLinejoin="miter"
          shapeRendering="auto"
        />
      ))}

      {STOPS.filter((stop) => stop.photo).map((stop) => (
        <g key={stop.id}>
          <rect x={stop.point[0] - 2.5} y={stop.point[1] - 2.5} width={5} height={5} fill="#0b0d1f" />
          <rect x={stop.point[0] - 1.5} y={stop.point[1] - 1.5} width={3} height={3} fill="#fff7e6" />
        </g>
      ))}

      <g transform={`translate(${ARRIVAL[0] - 4.5} ${ARRIVAL[1] - 4.5})`} className="text-(--px-yellow)">
        <rect x={-0.5} y={-0.5} width={10} height={10} fill="#0b0d1f" />
        <PixelIcon name="star" size={9} />
      </g>
    </svg>
  );
}
