import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthenticatedAdmin {
  sub: string;
  role: 'admin';
  exp: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedAdmin }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    const secret = process.env.ACCESS_TOKEN_SECRET;
    const issuer = process.env.ACCESS_TOKEN_ISSUER;
    const audience = process.env.ACCESS_TOKEN_AUDIENCE;
    if (
      scheme !== 'Bearer' ||
      !token ||
      !secret ||
      secret.length < 32 ||
      secret.startsWith('replace-') ||
      !issuer ||
      !audience
    ) {
      throw new UnauthorizedException('Valid administrator session required');
    }
    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedAdmin>(token, {
        secret,
        algorithms: ['HS256'],
        issuer,
        audience,
      });
      if (!payload.sub || payload.role !== 'admin' || typeof payload.exp !== 'number') {
        throw new Error('Invalid claims');
      }
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Valid administrator session required');
    }
  }
}
