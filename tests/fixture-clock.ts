/** Deterministic clock for fixture-only gates; never imported by application code. */
import { mock } from "node:test";
import catalog from "../src/lib/marketplace/catalog-data.json";
mock.timers.enable({ apis: ["Date"], now: Date.parse(catalog.checkedAt) + 1_000 });
