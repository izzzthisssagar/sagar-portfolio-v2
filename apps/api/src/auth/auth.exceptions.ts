import { HttpException, HttpStatus, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export class AccountLockedException extends HttpException {
  constructor(lockedUntil: Date) {
    super(
      {
        code: 'ACCOUNT_LOCKED',
        message: 'Too many attempts. Try again later.',
        lockedUntil: lockedUntil.toISOString(),
      },
      423,
    );
  }
}

export class SessionExpiredException extends HttpException {
  constructor(message = 'Session expired or invalid.') {
    super({ code: 'SESSION_EXPIRED', message }, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
  }
}

export class AuthNotProvisionedException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'AUTH_NOT_PROVISIONED',
      message: 'Administrator credentials and persistence must be provisioned before login.',
    });
  }
}
