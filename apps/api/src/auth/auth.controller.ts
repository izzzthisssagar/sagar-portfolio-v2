import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { Response } from 'express';
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(12) password!: string;
}
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('login') @HttpCode(503) login(@Body() _body: LoginDto, @Res() response: Response) {
    return response.status(503).json({
      error: {
        code: 'AUTH_NOT_PROVISIONED',
        message: 'Administrator credentials and persistence must be provisioned before login.',
        requestId: 'provisioning-required',
      },
    });
  }
  @Post('logout') @HttpCode(204) logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('portfolio_refresh', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1/auth',
    });
  }
}
