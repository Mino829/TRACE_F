/**
 * Drops the notification's ?prompt= from the current history entry, so a
 * reload or going back does not bring an answered reminder back. Anything
 * else on the URL (?tweaks=, the team's view settings) stays.
 */
export function dropPromptFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("prompt")) return;
  url.searchParams.delete("prompt");
  window.history.replaceState(window.history.state, "", url.pathname + url.search.replace(/%2C/g, ",") + url.hash);
}
