import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * PrivyUser decorator - Extracts user from request.user (set by PrivyAuthGuard)
 * Usage: @PrivyUser() user: { id: string }
 */
export const PrivyUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
