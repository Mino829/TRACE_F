"use client";

import { loadDefaultJapaneseParser } from "budoux";
import { Fragment, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { PixelIcon, type PixelIconName } from "./pixel-icon";

/** Building blocks of the /log screens, styled in src/app/log/log.css. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one action to take next, in yellow. secondary: beside it. danger: deletes, in red. */
  variant?: "primary" | "secondary" | "danger";
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

/** A hint for the next step, behind a TIP chip. */
export function Tip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={`px-note ${className ?? ""}`} data-tone="coach">
      <span className="px-chip px-chip--tip mt-1">TIP</span>
      <span>{typeof children === "string" ? <Sentences text={children} /> : children}</span>
    </p>
  );
}

/** The state behind an "i": whether its note is open, and the id that ties the two. Escape closes it. */
export function useInfo() {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  return { open, id, toggle: () => setOpen((value) => !value) };
}

export type Info = ReturnType<typeof useInfo>;

/**
 * The "i" beside a label: a 20px square to see, a 44px square to tap. A word
 * joiner ties it to the word before, so it never wraps onto a line alone.
 */
export function InfoButton({ info, label }: { info: Info; label: string }) {
  return (
    <>
      {"\u2060"}
      <button type="button" className="px-info__button" aria-label={label} aria-expanded={info.open} aria-controls={info.id} onClick={info.toggle}>
        <span aria-hidden="true">i</span>
      </button>
    </>
  );
}

/**
 * What an "i" holds. It opens in place below its row and pushes the rest of
 * the screen down, so it never covers a button or the next window.
 */
export function InfoNote({ info, children }: { info: Info; children: ReactNode }) {
  return (
    <div id={info.id} role="note" className="px-info__note" hidden={!info.open}>
      {children}
    </div>
  );
}

/**
 * Marks a scrolling box while more of it lies below, so its foot fades as a
 * hint that the text goes on.
 */
export function useScrollHint<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      element.dataset.more = String(element.scrollTop + element.clientHeight < element.scrollHeight - 4);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    // A dialog's box has no size until it opens.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return ref;
}

const parser = loadDefaultJapaneseParser();

/**
 * The 「」 and （） spans short enough to keep on one line, as the indexes of
 * their brackets: a button's name like 「写真を撮る」, or （教室棟301）. A long
 * aside in the consent text still wraps between its phrases.
 */
function shortSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const open: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if ("「（".includes(text[index])) open.push(index);
    else if ("」）".includes(text[index])) {
      const start = open.pop();
      if (start !== undefined && index - start < 12) spans.push([start, index]);
    }
  }
  return spans;
}

/**
 * BudouX's phrases, with three kinds kept on one line: a number and the
 * counter after it ("15" and "分か" become "15分か"), words joined by a
 * no-break space (written "QR\u00a0コード" in the copy), and a short span in
 * brackets.
 */
function phrases(text: string): string[] {
  const spans = shortSpans(text);
  const out: string[] = [];
  let offset = 0;
  for (const phrase of parser.parse(text)) {
    const last = out.length > 0 ? out[out.length - 1] : "";
    const inside = spans.some(([open, close]) => open < offset && offset <= close);
    const joined = inside || (/[0-9]$/.test(last) && /^[^\s0-9A-Za-z]/.test(phrase)) || last.endsWith("\u00a0") || phrase.startsWith("\u00a0");
    if (joined && out.length > 0) out[out.length - 1] = last + phrase;
    else out.push(phrase);
    offset += phrase.length;
  }
  return out.map(solid);
}

/** Where a line may still break with keep-all: before an opening bracket, and after a closing one, a comma or a hyphen. */
const BEFORE = "「『（【〔〈《";
const AFTER = "」』）】〕〉》、。！？-";

/**
 * keep-all stops breaks between letters, but a line can still break at a
 * space inside a phrase, around a bracket or after the hyphen in "Wi-Fi",
 * which starts a line with "）に", "の" or "Fi". A word joiner and a no-break
 * space close those gaps; the space before a phrase still breaks.
 */
function solid(phrase: string): string {
  let out = "";
  for (let index = 0; index < phrase.length; index += 1) {
    const char = phrase[index];
    const next = phrase[index + 1];
    out += char;
    if (next !== undefined && (AFTER.includes(char) || BEFORE.includes(next))) out += "\u2060";
  }
  return out.replace(/(\S) (?=\S)/g, "$1\u00a0");
}

/**
 * A text that wraps only between phrases, so a line never starts in the
 * middle of a word or with a lone 。. A phrase too long for the line still
 * breaks rather than running out of its box.
 */
export function Phrases({ text }: { text: string }) {
  return (
    <span className="px-phrases">
      {phrases(text).map((phrase, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {phrase}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A short text with each sentence on its own line, wrapping between phrases.
 * A 。 inside 「」 or （） stays where it is.
 */
export function Sentences({ text }: { text: string }) {
  // A loop rather than a lookbehind pattern, which older iPhones cannot parse.
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ("「『（".includes(char)) depth += 1;
    else if ("」』）".includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "。" && depth === 0) {
      parts.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) parts.push(text.slice(start));
  // One span, so a flex box around it (a note) sees one item, not a row of sentences.
  return (
    <span>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          <Phrases text={part} />
        </Fragment>
      ))}
    </span>
  );
}

export function clock(value: number | string): string {
  return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** Minutes and seconds left, from milliseconds. */
export function remaining(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
