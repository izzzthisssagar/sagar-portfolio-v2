import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type AdminRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { SetPortraitDto } from './profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}
  @Get('portrait') async portrait() {
    return { data: await this.profile.getPublicPortrait() };
  }
}

@ApiTags('admin/profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller('admin/profile')
export class AdminProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get() async get() {
    return { data: await this.profile.getAdmin() };
  }
  @Post('portrait') async setPortrait(@Body() input: SetPortraitDto, @Req() request: AdminRequest) {
    return { data: await this.profile.setPortrait(input.mediaId, request.user?.sub) };
  }
  @Delete('portrait') async clearPortrait(@Req() request: AdminRequest) {
    return { data: await this.profile.clearPortrait(request.user?.sub) };
  }
}
