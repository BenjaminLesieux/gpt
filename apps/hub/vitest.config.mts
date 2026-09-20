/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/hub',
  test: {
    name: '@gpt/hub',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],

    // One worker, one file at a time. Eleven of these specs open a
    // better-sqlite3 database, and under `nx run-many` — which runs projects
    // concurrently, each starting its own pool — the forks racing to load and
    // unload that native addon died on teardown: *worker exited unexpectedly*,
    // then *timeout terminating forks worker*, with the assertions themselves
    // all passing. Serial costs a few seconds and buys a suite that reports
    // what it found instead of how it exited.
    //
    // Forks, not threads, and that part is not a preference. better-sqlite3's
    // prebuilt addon takes down the whole process under `worker_threads` on
    // Linux — `Segmentation fault (core dumped)` before the first file runs —
    // while surviving it on macOS, so a green local run says nothing here.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
