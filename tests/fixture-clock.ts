/** Historical fixture clock; never imported by application code or live catalog validation. */
import { mock } from "node:test";
import catalog from "./fixtures/marketplace-catalog-2026-2027.json";
mock.timers.enable({ apis: ["Date"], now: Date.parse(catalog.checkedAt) + 1_000 });
