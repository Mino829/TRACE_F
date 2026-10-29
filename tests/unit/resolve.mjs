/**
 * Lets node:test import the app's TypeScript the way Next resolves it: "@/"
 * is src/, an import without an extension is a .ts file, and a .json import
 * (the campus graph) is JSON without the `with { type: "json" }` Next does not need.
 */

const src = new URL("../../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const mapped = specifier.startsWith("@/") ? new URL(specifier.slice(2), src).href : specifier;
  try {
    const resolved = await nextResolve(mapped, context);
    return mapped.endsWith(".json") ? { ...resolved, importAttributes: { type: "json" } } : resolved;
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !/^(\.{1,2}\/|file:)/.test(mapped)) throw error;
    return nextResolve(`${mapped}.ts`, context);
  }
}
