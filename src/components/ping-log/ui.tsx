import type { ButtonHTMLAttributes, ReactNode } from "react";

import { PixelIcon, type PixelIconName } from "./pixel-icon";

/** Building blocks of the /log screens, styled in src/app/log/log.css. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one action to take next, in yellow. secondary: beside it. */
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: PixelIconName;
};

export function PxButton({ variant = "primary", size = "md", block = false, icon, className, children, type = "button", ...rest }: ButtonProps) {
  const classes = ["px-btn", variant !== "primary" && `px-btn--${variant}`, size !== "md" && `px-btn--${size}`, block && "px-btn--block", className];
  return (
    <button type={type} className={classes.filter(Boolean).join(" ")} {...rest}>
      {icon && <PixelIcon name={icon} size={size === "sm" ? 15 : size === "lg" ? 24 : 18} />}
      <span>{children}</span>
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

type WindowProps = {
  /** Set into the top edge, like a game's status window. */
  title?: ReactNode;
  /** alert: the one thing asking for attention. dim: quieter, or nested. */
  tone?: "default" | "alert" | "dim";
  as?: "div" | "section";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

/** The game's message window: a light ring around a dark ground, with stepped corners. */
export function Window({ title, tone = "default", as: Tag = "div", className, children, ...aria }: WindowProps) {
  return (
    <Tag className={`px-window ${tone === "default" ? "" : `px-window--${tone}`} ${className ?? ""}`} {...aria}>
      {title && <p className="px-window__title">{title}</p>}
      {children}
    </Tag>
  );
}

/** The developer screen's boxes: a window, named in the pixel face. */
export function Frame({ tone = "default", className, panelClassName, children }: { tone?: "default" | "dim"; className?: string; panelClassName?: string; children: ReactNode }) {
  return (
    <Window tone={tone} className={className}>
      <div className={panelClassName}>{children}</div>
    </Window>
  );
}

/** A small Latin label in the pixel face. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`px-label ${className ?? ""}`}>{children}</p>;
}

export function clock(value: number | string): string {
  return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** Minutes and seconds left, from milliseconds. */
export function remaining(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
