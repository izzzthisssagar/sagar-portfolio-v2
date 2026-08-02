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
    const raw =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message =
      typeof raw === 'string'
        ? raw
        : ((raw as { message?: string | string[] }).message ?? 'Request failed');
    response
      .status(status)
      .json({ error: { code: `HTTP_${status}`, message, requestId: randomUUID() } });
  }
}
@Controller()
export class HealthController {
  @Get('health') health() {
    return { status: 'ok', service: 'portfolio-api', version: 'v1' };
  }
}
