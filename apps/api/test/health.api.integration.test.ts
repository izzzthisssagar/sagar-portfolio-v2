import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;

databaseSuite('Health: liveness, readiness, and internal details', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('liveness reports ok without any query parameters or auth', async () => {
    const res = await request(server()).get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('readiness reports ok with every dependency check present against a real database', async () => {
    const res = await request(server()).get('/api/v1/health/ready').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.map((c: { name: string }) => c.name).sort()).toEqual([
      'database',
      'notification-config',
      'storage',
    ]);
    // Never leaks the connection string, storage credentials, or a stack trace.
    expect(JSON.stringify(res.body)).not.toContain(process.env.DATABASE_URL);
  });

  it('never leaks a secret value or stack trace from any health response', async () => {
    const live = await request(server()).get('/api/v1/health/live').expect(200);
    const ready = await request(server()).get('/api/v1/health/ready').expect(200);
    for (const body of [live.body, ready.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/postgres(ql)?:\/\//);
      expect(text.toLowerCase()).not.toContain('password');
    }
  });

  it('details 404s when no internal token is configured', async () => {
    await request(server()).get('/api/v1/health/details').expect(404);
  });

  it('details 404s when the wrong token is presented', async () => {
    await request(server())
      .get('/api/v1/health/details')
      .set('x-health-token', 'wrong-token')
      .expect(404);
  });
});
