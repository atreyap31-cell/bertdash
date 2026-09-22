// Runs the test suites, one process each.
//
// Why this exists rather than a chain of `node tests/*.mjs`:
//
// On this machine (Node 24.19 on Windows) the fuzz suite dies with a raw
// access violation in V8 roughly one run in five. It is not a test failure —
// no assertion runs, nothing is printed, and Node's own --report-on-fatalerror
// cannot catch it because the process is killed by the OS rather than by a V8
// fatal error. It reproduces from a plain script with node:test removed
// entirely, it happens at a different point every time, and it is present at
// every commit going back months, so it is not something the game does wrong:
// pure JavaScript cannot segfault a correct engine.
//
// What it does correlate with is how much work one process does. Measured with
// a loop that builds and runs every level N times over:
//
//   1 pass    ~7% of processes died
//   4 passes  ~60%
//   12 passes ~100%
//
// So this runner retries a suite that *crashes*, and only that. A suite that
// fails an assertion is reported and the run stops: a real failure is never
// retried and never hidden. Every retry is printed, so the flake stays visible
// instead of quietly costing someone an afternoon later.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = [
  'engine', 'abilities', 'replay', 'ghost', 'reachability',
  // Split in two on purpose: each process carries half the fuzzing.
  'fuzz', 'fuzz-geometry',
  'profile',
];

/** How many times a crashing suite is re-run before the whole thing fails. */
const MAX_ATTEMPTS = 4;

/** Windows reports an access violation as this exit code. */
const ACCESS_VIOLATION = 3221225477;

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(ROOT, 'tests', `${file}.test.mjs`)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', (code, signal) => resolve({ code, signal, out }));
  });
}

/**
 * Did the process die rather than report a result?
 *
 * The test runner always prints a summary, even when everything fails. No
 * summary at all means it never got that far.
 */
function crashed({ code, signal, out }) {
  if (signal) return true;
  if (code === ACCESS_VIOLATION) return true;
  const reported = /^ℹ (pass|fail) \d+/m.test(out);
  return code !== 0 && !reported;
}

let failed = false;
const flaky = [];

for (const suite of SUITES) {
  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await run(suite);
    if (!crashed(result)) break;

    const how = result.signal ?? `exit ${result.code}`;
    if (attempt < MAX_ATTEMPTS) {
      console.log(`  ${suite}: process died (${how}) without running any test — `
        + `retrying (${attempt}/${MAX_ATTEMPTS - 1})`);
      flaky.push(suite);
    } else {
      console.error(`\n${suite}: process died (${how}) on every one of `
        + `${MAX_ATTEMPTS} attempts. That is not a flake.`);
      failed = true;
    }
  }

  if (crashed(result)) continue;

  process.stdout.write(result.out);
  if (result.code !== 0) {
    console.error(`\n${suite}: FAILED`);
    failed = true;
    break;              // a real failure stops the run
  }
}

if (flaky.length) {
  const counts = flaky.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());
  console.log(`\nSuites that had to be retried after a crash: `
    + [...counts].map(([s, n]) => `${s} (x${n})`).join(', '));
  console.log('This is the V8 access violation described in tools/run-tests.mjs, '
    + 'not a fault in the suite.');
}

process.exit(failed ? 1 : 0);
