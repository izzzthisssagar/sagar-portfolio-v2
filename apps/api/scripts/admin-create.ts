import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AdminAlreadyExistsError,
  InvalidEmailError,
  WeakPasswordError,
  provisionAdmin,
} from '../src/provisioning/admin-provisioning';

const ENTER_CODES = new Set([10, 13]); // LF, CR
const CTRL_C_CODE = 3;
const BACKSPACE_CODES = new Set([8, 127]);

/**
 * Reads a password from stdin without echoing it to the terminal. Never
 * logs the characters typed. CI/non-interactive callers should set
 * ADMIN_PASSWORD instead of relying on this prompt.
 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('ADMIN_PASSWORD must be set when not running in an interactive terminal.'));
      return;
    }
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (chunk: string) => {
      const code = chunk.charCodeAt(0);
      if (chunk.length === 1 && ENTER_CODES.has(code)) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      if (chunk.length === 1 && code === CTRL_C_CODE) {
        process.stdout.write('\n');
        process.exit(130);
      }
      if (chunk.length === 1 && BACKSPACE_CODES.has(code)) {
        input = input.slice(0, -1);
        return;
      }
      input += chunk;
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const first = await promptHidden('Administrator password: ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) throw new Error('Passwords did not match.');
  return first;
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error('ADMIN_EMAIL is required.');
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 2;
    return;
  }

  let password: string;
  try {
    password = await readPassword();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not read a password.');
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const admin = await provisionAdmin({ prisma, email, password });
    console.log(`Administrator provisioned: ${admin.email} (${admin.id}).`);
  } catch (error) {
    if (
      error instanceof AdminAlreadyExistsError ||
      error instanceof InvalidEmailError ||
      error instanceof WeakPasswordError
    ) {
      console.error(error.message);
      process.exitCode = error instanceof AdminAlreadyExistsError ? 4 : 5;
    } else {
      console.error(
        'Administrator provisioning failed.',
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 3;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
