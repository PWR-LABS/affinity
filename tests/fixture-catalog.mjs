/** Historical transport fixtures only. Never load this hook in the application or live catalog gate. */
import { registerHooks } from "node:module";

const liveCatalog = new URL("../src/lib/marketplace/catalog-data.json", import.meta.url).href;
const fixtureCatalog = new URL("./fixtures/marketplace-catalog-2026-2027.json", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url === liveCatalog ? { ...resolved, url: fixtureCatalog } : resolved;
  },
});
