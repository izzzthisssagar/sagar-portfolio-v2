import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthenticatedAdmin {
  sub: string;
  role: 'admin';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedAdmin }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (scheme !== 'Bearer' || !token || !secret || secret.startsWith('replace-')) {
      throw new UnauthorizedException('Valid administrator session required');
    }
    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedAdmin>(token, { secret });
      if (!payload.sub || payload.role !== 'admin') throw new Error('Invalid claims');
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Valid administrator session required');
    }
  }
}
