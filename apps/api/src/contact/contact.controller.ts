import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { hashIp } from '../auth/auth.service';
import { type AdminRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { ContactService } from './contact.service';
import { ListContactMessagesDto, SubmitContactDto, UpdateContactStatusDto } from './contact.dto';

function clientIp(request: Request): string | undefined {
  return request.ip;
}

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(200)
  // Stricter than the app-wide default (60/60s) — a public, unauthenticated write endpoint is
  // the one most worth protecting against scripted submission floods. Matches the login
  // endpoint's own rate (auth.controller.ts) rather than inventing a separate convention.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async submit(@Body() input: SubmitContactDto, @Req() request: Request) {
    const ip = clientIp(request);
    await this.contact.submit(input, ip ? hashIp(ip) : undefined);
    // Always the same shape regardless of what happened internally (honeypot, duplicate, or a
    // genuine new message, and regardless of notification outcome) — see ContactService.submit.
    return { data: { received: true } };
  }
}

@ApiTags('admin/messages')
@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller('admin/messages')
export class AdminContactController {
  constructor(private readonly contact: ContactService) {}

  @Get() list(@Query() query: ListContactMessagesDto) {
    return this.contact.list(query);
  }
  @Get(':id') async get(@Param('id') id: string) {
    return { data: await this.contact.get(id) };
  }
  @Patch(':id/status') async updateStatus(
    @Param('id') id: string,
    @Body() input: UpdateContactStatusDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.contact.updateStatus(id, input.status, request.user?.sub) };
  }
  @Delete(':id') async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.contact.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }
  @Post(':id/retry-notification')
  @HttpCode(200)
  async retryNotification(@Param('id') id: string, @Req() request: AdminRequest) {
    return { data: await this.contact.retryNotification(id, request.user?.sub) };
  }
}
