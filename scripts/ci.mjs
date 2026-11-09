#!/usr/bin/env node
// Local CI pipeline mirroring .github/workflows/ci.yml so the same gates run
// on this machine without GitHub Actions minutes.
//
//   corepack pnpm run ci
//
// Steps: install (frozen lockfile), type check, unit tests, build, and the
// container image build when Docker is available.
import { spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const shell = windows;

function pnpmInvocation(args) {
  return windows
    ? { command: 'corepack pnpm', args }
    : { command: 'corepack', args: ['pnpm', ...args] };
}

function runStep(label, command, args) {
  console.log(`\n===== ${label} =====`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell });
  if (result.error) {
    console.error(`Could not start: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`Step failed with exit code ${result.status}.`);
    return false;
  }
  return true;
}

function dockerAvailable() {
  const probe = spawnSync('docker', ['--version'], { stdio: 'ignore', shell });
  return !probe.error && probe.status === 0;
}

const steps = [
  ['Install dependencies (frozen lockfile)', ['install', '--frozen-lockfile']],
  ['Type check (tsc + svelte-check)', ['run', '-r', 'check']],
  ['Unit tests (vitest)', ['run', '-r', 'test']],
  ['Build (vite + tsc)', ['run', '-r', 'build']],
];

let failed = false;
for (const [label, stepArgs] of steps) {
  const { command, args } = pnpmInvocation(stepArgs);
  if (!runStep(label, command, args)) {
    failed = true;
    break;
  }
}

if (!failed) {
  if (dockerAvailable()) {
    failed = !runStep('Container image build', 'docker', ['build', '--tag', 'techshan-home:local', '.']);
  } else {
    console.log('\n===== Container image build =====');
    console.log('Docker was not found; skipping the image build. Install Docker to include it.');
  }
}

console.log(failed ? '\nLocal CI FAILED.' : '\nLocal CI passed.');
process.exit(failed ? 1 : 0);
