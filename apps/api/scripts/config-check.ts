import 'dotenv/config';
import { loadConfig } from '../src/config/index';

/** Validates the intended environment without starting Prisma, Nest, or any network listener —
 * safe to run in CI or locally before a real deploy to catch a missing/malformed variable early.
 * Never prints a secret value: only which field failed and why. */
function main() {
  const result = loadConfig();
  if (!result.ok) {
    console.error('Configuration is invalid:');
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  const { config } = result;
  console.log('Configuration is valid.');
  console.log(`  NODE_ENV: ${config!.NODE_ENV}`);
  console.log(`  MEDIA_STORAGE_DRIVER: ${config!.MEDIA_STORAGE_DRIVER ?? '(unset — local disk)'}`);
  console.log(
    `  CONTACT_NOTIFICATION_DRIVER: ${config!.CONTACT_NOTIFICATION_DRIVER ?? '(unset — capture)'}`,
  );
  console.log(`  RATE_LIMIT_MAX: ${config!.RATE_LIMIT_MAX}`);
  console.log(`  TRUST_PROXY: ${config!.TRUST_PROXY}`);
  console.log(`  LOG_LEVEL: ${config!.LOG_LEVEL}`);
}

main();
