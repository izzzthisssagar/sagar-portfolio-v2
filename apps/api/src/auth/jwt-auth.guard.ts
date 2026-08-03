import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from './cookies';
import { loadAccessTokenConfig } from './jwt-config';

export interface AuthenticatedAdmin {
  sub: string;
  role: 'admin';
  exp: number;
  tokenVersion: number;
}

export type AdminRequest = Request & { user?: AuthenticatedAdmin };

function extractAccessToken(request: Request): string | undefined {
  const [scheme, bearer] = request.headers.authorization?.split(' ') ?? [];
  if (scheme === 'Bearer' && bearer) return bearer;
  return request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

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
      if (
        !payload.sub ||
        payload.role !== 'admin' ||
        typeof payload.exp !== 'number' ||
        typeof payload.tokenVersion !== 'number'
      ) {
        throw new Error('Invalid claims');
      }
      // Logout-all bumps AdminUser.tokenVersion so every access token
      // already issued — not just future refreshes — stops working
      // immediately, instead of remaining valid until its 15-minute
      // expiry. This costs one indexed primary-key lookup per
      // authenticated request, which is negligible for a single-admin CMS.
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: payload.sub },
        select: { tokenVersion: true },
      });
      if (!admin || admin.tokenVersion !== payload.tokenVersion) {
        throw new Error('Token version revoked');
      }
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Valid administrator session required');
    }
  }
}
