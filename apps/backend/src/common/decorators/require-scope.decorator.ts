import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SCOPE_KEY = 'require_scope';

/** Route must be behind IntegratorGuard — checked there against request.integrator.scopes. */
export const RequireScope = (scope: string): MethodDecorator => SetMetadata(REQUIRE_SCOPE_KEY, scope);
