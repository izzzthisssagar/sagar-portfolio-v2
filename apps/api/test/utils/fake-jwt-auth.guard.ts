import type { CanActivate, ExecutionContext } from '@nestjs/common';

export class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest().user = { sub: 'test-admin', role: 'admin' };
    return true;
  }
}
