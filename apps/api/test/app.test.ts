import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
describe('API v1 contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  it('exposes health and paginated public projects', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .expect(200)
      .expect(({ body }) => expect(body.meta.total).toBe(1));
  });
  it('rejects unauthenticated project mutation', () =>
    request(app.getHttpServer())
      .post('/api/v1/projects')
      .send({
        title: 'Test Project',
        slug: 'test-project',
        summary: 'A sufficiently long project summary.',
        status: 'draft',
        order: 2,
      })
      .expect(401));
});
