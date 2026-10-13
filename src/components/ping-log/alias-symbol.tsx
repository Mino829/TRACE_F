import type { AliasColor, AliasSymbol, DisplayAlias } from "@/lib/trace-api/client";

import { PixelIcon, type PixelIconName } from "./pixel-icon";

/**
 * あなたの記号: the colour and shape the room's screen shows for a
 * participant. The backend names them; the pixel icons and the Japanese names
 * are ours. Each has a shape as well as a colour, so no one has to tell
 * colours apart.
 */

const COLORS: Record<AliasColor, { css: string; name: string }> = {
  cyan: { css: "var(--px-cyan)", name: "水色" },
  magenta: { css: "#f472d0", name: "赤紫" },
  amber: { css: "var(--px-amber)", name: "山吹色" },
  violet: { css: "#a78bfa", name: "紫" },
  lime: { css: "#a3e635", name: "黄緑" },
  coral: { css: "#ff8a65", name: "さんご色" },
};

const SYMBOLS: Record<AliasSymbol, { icon: PixelIconName; name: string }> = {
  circle: { icon: "circle", name: "丸" },
  triangle: { icon: "triangle", name: "三角" },
  diamond: { icon: "diamond", name: "ひし形" },
  star: { icon: "star", name: "星" },
  wave: { icon: "wave", name: "波" },
  square: { icon: "square", name: "四角" },
};

export type AliasLook = { icon: PixelIconName; css: string; label: string };

/** The demo's own symbol, for when there is no backend to give one. */
const DEMO_LOOK: AliasLook = { icon: "star", css: "var(--px-yellow)", label: "黄色い星" };

export function aliasLook(alias: DisplayAlias | null): AliasLook {
  if (!alias) return DEMO_LOOK;
  const color = COLORS[alias.color as AliasColor];
  const symbol = SYMBOLS[alias.symbol as AliasSymbol];
  // A name added to the backend later still shows something, and says so plainly.
  return {
    icon: symbol?.icon ?? "star",
    css: color?.css ?? "var(--px-yellow)",
    label: color && symbol ? `${color.name}の${symbol.name}` : "あなたの記号",
  };
}

type Props = { look: AliasLook; size: number; className?: string; label?: string };

export function AliasSymbolIcon({ look, size, className, label }: Props) {
  return (
    <span className="inline-grid" style={{ color: look.css }}>
      <PixelIcon name={look.icon} size={size} className={className} label={label} />
    </span>
  );
}
