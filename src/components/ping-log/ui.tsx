import type { ButtonHTMLAttributes, ReactNode } from "react";

import { PixelIcon, type PixelIconName } from "./pixel-icon";

/** Building blocks of the /log screens, styled in src/app/log/log.css. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one action to take next. secondary: beside it, on a dark ground. dark: beside it, on the beige. */
  variant?: "primary" | "secondary" | "dark";
  size?: "md" | "sm";
  block?: boolean;
  icon?: PixelIconName;
};

export function PxButton({ variant = "primary", size = "md", block = false, icon, className, children, type = "button", ...rest }: ButtonProps) {
  const classes = ["px-btn", variant !== "primary" && `px-btn--${variant}`, size === "sm" && "px-btn--sm", block && "px-btn--block", className];
  return (
    <button type={type} className={classes.filter(Boolean).join(" ")} {...rest}>
      <span className="px-btn__face">
        {icon && <PixelIcon name={icon} size={size === "sm" ? 14 : 18} />}
        <span>{children}</span>
      </span>
    </button>
  );
}

export function PxLink({ className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`px-link ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}

/** The site's pixel frame: a coloured edge with stepped corners around a dark panel. */
export function Frame({ tone = "teal", className, panelClassName, children }: { tone?: "teal" | "pink" | "dim"; className?: string; panelClassName?: string; children: ReactNode }) {
  return (
    <div className={`px-frame ${tone === "teal" ? "" : `px-frame--${tone}`} ${className ?? ""}`}>
      <div className={`px-panel ${panelClassName ?? ""}`}>{children}</div>
    </div>
  );
}

/** A small Latin label in the pixel face between two stars, as the site heads each section. */
export function Eyebrow({ children, soft = false, className }: { children: ReactNode; soft?: boolean; className?: string }) {
  return (
    <p className={`px-eyebrow ${soft ? "px-eyebrow--soft" : ""} ${className ?? ""}`}>
      <span className="px-star" />
      {children}
      <span className="px-star" />
    </p>
  );
}

export function clock(value: number | string): string {
  return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** "3分12秒" for screen text, from milliseconds. */
export function remaining(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
