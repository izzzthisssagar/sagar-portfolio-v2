import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status === 500) console.error('Unhandled exception', exception);
    const raw =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message =
      typeof raw === 'string'
        ? raw
        : ((raw as { message?: string | string[] }).message ?? 'Request failed');
    const code =
      typeof raw === 'object' && raw !== null && typeof (raw as { code?: unknown }).code === 'string'
        ? (raw as { code: string }).code
        : `HTTP_${status}`;
    response.status(status).json({ error: { code, message, requestId: randomUUID() } });
  }
}
@Controller()
export class HealthController {
  @Get('health') health() {
    return { status: 'ok', service: 'portfolio-api', version: 'v1' };
  }
}
