import 'dotenv/config';
import { loadWebConfig } from '../lib/env';

function main() {
  const result = loadWebConfig();
  if (!result.ok) {
    console.error('Web configuration is invalid:');
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Web configuration is valid.');
  console.log(`  NODE_ENV: ${result.config!.NODE_ENV}`);
  console.log(`  NEXT_PUBLIC_API_URL: ${result.config!.NEXT_PUBLIC_API_URL}`);
  console.log(`  ALLOW_STATIC_CONTENT_FALLBACK: ${result.config!.ALLOW_STATIC_CONTENT_FALLBACK}`);
}

main();
