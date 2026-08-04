#!/usr/bin/env node
// Small DATABASE_URL helper shared by scripts/db-*.sh. Every subcommand either returns a
// non-secret fragment (dbname, redact) or a full connection string handed straight to a
// subprocess (pg_dump/pg_restore/psql/createdb all accept a connection string argument directly)
// — this file itself never prints a password to the terminal, and callers must not either.
//
// Usage:
//   node db-url.mjs dbname <DATABASE_URL>            -> prints the database name only
//   node db-url.mjs redact <DATABASE_URL>             -> prints a credential-free URL, safe to log
//   node db-url.mjs with-db <DATABASE_URL> <dbname>   -> prints the same connection with a
//                                                         different database name
//   node db-url.mjs maintenance <DATABASE_URL>        -> prints the same connection pointed at the
//                                                         server's default "postgres" maintenance
//                                                         database (needed for CREATE/DROP DATABASE,
//                                                         which cannot run against the target db itself)
//   node db-url.mjs libpq <DATABASE_URL>              -> prints the same connection, stripped of
//                                                         Prisma-only query params, for direct use
//                                                         by pg_dump/pg_restore/psql/createdb

const [, , cmd, rawUrl, arg] = process.argv;

// Prisma accepts `?schema=<name>` on DATABASE_URL to set its own default schema — this is a
// Prisma-only convention, not a valid libpq connection parameter. Every real libpq tool
// (pg_dump/pg_restore/psql/createdb) rejects it outright ("invalid URI query parameter: schema").
// Stripped everywhere a connection string is built for one of those tools; harmless to strip
// since none of those tools need it (they operate at the database level, not a single schema).
function stripPrismaOnlyParams(u) {
  u.searchParams.delete('schema');
  return u;
}

function parse(url) {
  if (!url) {
    throw new Error('A DATABASE_URL argument is required.');
  }
  const u = stripPrismaOnlyParams(new URL(url));
  if (!u.pathname || u.pathname === '/') {
    throw new Error('DATABASE_URL must include a database name.');
  }
  return u;
}

try {
  switch (cmd) {
    case 'dbname': {
      process.stdout.write(parse(rawUrl).pathname.replace(/^\//, ''));
      break;
    }
    case 'redact': {
      const u = parse(rawUrl);
      process.stdout.write(
        `postgresql://${u.hostname}:${u.port || '5432'}${u.pathname}${u.search}`,
      );
      break;
    }
    case 'with-db': {
      if (!arg) throw new Error('with-db requires a target database name argument.');
      const u = parse(rawUrl);
      u.pathname = `/${arg}`;
      process.stdout.write(u.toString());
      break;
    }
    case 'maintenance': {
      const u = parse(rawUrl);
      u.pathname = '/postgres';
      process.stdout.write(u.toString());
      break;
    }
    case 'libpq': {
      process.stdout.write(parse(rawUrl).toString());
      break;
    }
    default:
      process.stderr.write(
        'Usage: db-url.mjs <dbname|redact|with-db|maintenance> <DATABASE_URL> [arg]\n',
      );
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`db-url.mjs: ${err.message}\n`);
  process.exit(1);
}
