import { defineConfig } from 'vitest/config';

// Integration suites share one PostgreSQL database and some (admin
// provisioning, auth) intentionally treat singleton tables (AdminUser,
// AuditLog) as theirs to reset between cases. Running test files in
// parallel would let those resets race across files, so file-level
// parallelism is disabled for this package.
export default defineConfig({
  test: { exclude: ['**/dist/**', '**/node_modules/**'], fileParallelism: false },
});
