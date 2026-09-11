import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
