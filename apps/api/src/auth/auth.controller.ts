import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import {
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setCsrfCookie,
  setRefreshCookie,
} from './cookies';
import { CsrfGuard, SkipCsrfToken } from './csrf.guard';
import { type AdminRequest, JwtAuthGuard } from './jwt-auth.guard';
import { randomBytes } from 'node:crypto';

function clientIp(request: Request): string | undefined {
  return request.ip;
}

function issueSession(response: Response, tokens: {
  accessToken: string;
  refreshToken: string;
  admin: { id: string; email: string };
}) {
  const csrfToken = randomBytes(24).toString('base64url');
  setAccessCookie(response, tokens.accessToken);
  setRefreshCookie(response, tokens.refreshToken);
  setCsrfCookie(response, csrfToken);
  return { data: { email: tokens.admin.email } };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(CsrfGuard)
  @SkipCsrfToken()
  async login(@Body() body: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const tokens = await this.auth.login(body.email, body.password, clientIp(request));
    return issueSession(response, tokens);
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const raw = request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    const tokens = await this.auth.refresh(raw, clientIp(request));
    return issueSession(response, tokens);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async logout(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const raw = request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.auth.logout(raw, request.user?.sub, clientIp(request));
    clearAuthCookies(response);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiBearerAuth()
  async logoutAll(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logoutAll(request.user!.sub, clientIp(request));
    clearAuthCookies(response);
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async session(@Req() request: AdminRequest) {
    return { data: await this.auth.getSession(request.user!.sub) };
  }
}
