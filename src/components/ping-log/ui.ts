/** Shared neutral styling for the /log screens: the template's foreground/background tokens and greys only. */

export const PRIMARY = "rounded-md bg-foreground px-4 py-3 font-bold text-background disabled:opacity-40";
export const SECONDARY = "rounded-md border border-neutral-300 px-4 py-3 disabled:opacity-40 dark:border-neutral-700";
export const LINK = "text-sm text-neutral-500 underline disabled:opacity-40";
export const CARD = "space-y-4 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700";
/** One choice among several; `chosen` fills it. */
export function choice(chosen: boolean): string {
  return `rounded-md border px-3 py-2 text-sm ${chosen ? "border-foreground bg-foreground text-background" : "border-neutral-300 dark:border-neutral-700"}`;
}

export function clock(value: number | string): string {
  return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
