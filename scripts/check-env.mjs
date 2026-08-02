const required = [
  'DATABASE_URL',
  'ACCESS_TOKEN_SECRET',
  'ACCESS_TOKEN_ISSUER',
  'ACCESS_TOKEN_AUDIENCE',
  'REFRESH_TOKEN_SECRET',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
