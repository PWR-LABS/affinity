/**
 * eval:production-readiness — the headless bundle gate, built up milestone by milestone.
 *
 * Runs each milestone eval as a subprocess and fails if any fails. The bundle grows per milestone:
 * M0 added { m0-smoke, api-mrf-diff }; M1 added { match }; M2 added { cost }; M3 added { verify }; the
 * hardening pass added the unit suite ({ test }) + the live-wiring dry-run ({ live-dryrun }). Keeping one
 * bundle command means CI/operators have a single green/red signal.
 */
import { spawnSync } from "node:child_process";

const GATES = [
  "test",
  "eval:m0-smoke",
  "eval:api-mrf-diff",
  "eval:match",
  "eval:cost",
  "eval:verify",
  "eval:live-dryrun",
  "eval:ui-smoke",
];

function run(script: string): boolean {
  console.log(`\n━━━ ${script} ━━━`);
  const res = spawnSync(`npm run -s ${script}`, { shell: true, stdio: "inherit", env: process.env });
  return res.status === 0;
}

function main(): void {
  console.log("eval:production-readiness — [affinity.] bundle");
  const failures = GATES.filter((g) => !run(g));
  if (failures.length) {
    console.log(`\n✗ production-readiness FAILED: ${failures.join(", ")}\n`);
    process.exit(1);
  }
  console.log(`\n✓ production-readiness PASSED (${GATES.length} gates)\n`);
  process.exit(0);
}

main();
