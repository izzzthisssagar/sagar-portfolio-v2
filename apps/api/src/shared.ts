import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
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
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization !== 'Bearer sprint-1-test-token')
      throw new UnauthorizedException();
    return true;
  }
}
