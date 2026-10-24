import { defineConfig } from 'vitest/config';
// Test files share one database and reset its schema, so they must run one after another.
export default defineConfig({ test: { fileParallelism: false } });