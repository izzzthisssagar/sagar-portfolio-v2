import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from './cookies';
import { loadAccessTokenConfig } from './jwt-config';

export interface AuthenticatedAdmin {
  sub: string;
  role: 'admin';
  exp: number;
}

export type AdminRequest = Request & { user?: AuthenticatedAdmin };

function extractAccessToken(request: Request): string | undefined {
  const [scheme, bearer] = request.headers.authorization?.split(' ') ?? [];
  if (scheme === 'Bearer' && bearer) return bearer;
  return request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = extractAccessToken(request);
    const config = loadAccessTokenConfig();
    if (!token || !config) {
      throw new UnauthorizedException('Valid administrator session required');
    }
    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedAdmin>(token, {
        secret: config.secret,
        algorithms: ['HS256'],
        issuer: config.issuer,
        audience: config.audience,
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
