import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { getConfig } from './config';

export async function bootstrap() {
  // Validated before anything else starts (Nest, Prisma, the HTTP listener) — a malformed or
  // incomplete environment fails immediately with a readable message, never a partially-started
  // process serving traffic against broken configuration.
  const env = getConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sagar Portfolio API')
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  await app.listen(env.PORT);
  return app;
}
if (process.env.NODE_ENV !== 'test') void bootstrap();
