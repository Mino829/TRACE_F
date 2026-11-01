import { useSyncExternalStore } from "react";

/**
 * The participant's language on /log: Japanese, or English for visitors whose
 * phone is not set to Japanese. The copy stays where it is used, both
 * languages side by side: t("閉じる", "Close"). Switching re-renders the
 * screen from PingLogScreen down; text already shown (a message, an error)
 * stays in the language it was made in.
 */

export type Lang = "ja" | "en";

const LANG_KEY = "trace-lang";

function initial(): Lang {
  if (typeof window === "undefined") return "ja";
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    // Private mode: fall back to the phone's language.
  }
  return (navigator.languages?.[0] ?? navigator.language ?? "ja").toLowerCase().startsWith("ja") ? "ja" : "en";
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(LANG_KEY, next);
  } catch {
    // Private mode: the choice lasts as long as the page.
  }
  document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

/** The Japanese copy, or its English one. */
export function t(ja: string, en: string): string {
  return current === "en" ? en : ja;
}

/** Re-renders on a switch; called once at the top of the participant's screen. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => "ja",
  );
}
