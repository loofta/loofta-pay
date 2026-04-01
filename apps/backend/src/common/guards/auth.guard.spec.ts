import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

const VALID_USER_ID = 'did:privy:user_abc123';
const VALID_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.valid.token';

function makePrivyService(overrides: Partial<PrivyVerificationService> = {}): jest.Mocked<PrivyVerificationService> {
  return {
    isConfigured: true,
    verifyAccessToken: jest.fn().mockResolvedValue(VALID_USER_ID),
    verifyUserId: jest.fn().mockResolvedValue(true),
    getPrivyUser: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<PrivyVerificationService>;
}

/** Build a minimal NestJS ExecutionContext that wraps a plain request object */
function makeContext(headers: Record<string, string | undefined>): ExecutionContext {
  const req: Record<string, any> = { headers, user: undefined };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

// ────────────────────────────────────────────────────────────────
// AuthGuard
// ────────────────────────────────────────────────────────────────

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let privy: jest.Mocked<PrivyVerificationService>;

  beforeEach(async () => {
    privy = makePrivyService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: PrivyVerificationService, useValue: privy },
      ],
    }).compile();

    guard = module.get(AuthGuard);
  });

  // Bearer JWT path
  describe('Authorization: Bearer', () => {
    it('sets req.user and returns true for a valid JWT', async () => {
      privy.verifyAccessToken.mockResolvedValue(VALID_USER_ID);
      const ctx = makeContext({ authorization: `Bearer ${VALID_TOKEN}` });

      const result = await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();

      expect(result).toBe(true);
      expect(req.user).toEqual({ id: VALID_USER_ID });
      expect(privy.verifyAccessToken).toHaveBeenCalledWith(VALID_TOKEN);
      expect(privy.verifyUserId).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for an invalid or expired JWT', async () => {
      privy.verifyAccessToken.mockResolvedValue(null);
      const ctx = makeContext({ authorization: `Bearer bad.token` });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws with message "Invalid or expired token"', async () => {
      privy.verifyAccessToken.mockResolvedValue(null);
      const ctx = makeContext({ authorization: `Bearer bad.token` });

      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or expired token');
    });
  });

  // Legacy header path
  describe('x-privy-user-id (legacy)', () => {
    it('sets req.user when the user ID is verified by Privy API', async () => {
      privy.verifyUserId.mockResolvedValue(true);
      const ctx = makeContext({ 'x-privy-user-id': VALID_USER_ID });

      const result = await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();

      expect(result).toBe(true);
      expect(req.user).toEqual({ id: VALID_USER_ID });
      expect(privy.verifyUserId).toHaveBeenCalledWith(VALID_USER_ID);
    });

    it('throws UnauthorizedException when Privy API rejects the user ID', async () => {
      privy.verifyUserId.mockResolvedValue(false);
      const ctx = makeContext({ 'x-privy-user-id': 'did:privy:fake_id' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid user ID');
    });

    it('prefers Bearer token over x-privy-user-id when both are sent', async () => {
      privy.verifyAccessToken.mockResolvedValue(VALID_USER_ID);
      const ctx = makeContext({
        authorization: `Bearer ${VALID_TOKEN}`,
        'x-privy-user-id': 'did:privy:other_user',
      });

      const result = await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();

      expect(result).toBe(true);
      expect(req.user).toEqual({ id: VALID_USER_ID });
      expect(privy.verifyAccessToken).toHaveBeenCalled();
      expect(privy.verifyUserId).not.toHaveBeenCalled();
    });
  });

  // No credentials
  describe('no credentials', () => {
    it('throws UnauthorizedException when no auth header is present', async () => {
      const ctx = makeContext({});

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Authentication required');
    });

    it('does not call Privy API when no credentials are sent', async () => {
      const ctx = makeContext({});
      try { await guard.canActivate(ctx); } catch { /* expected */ }

      expect(privy.verifyAccessToken).not.toHaveBeenCalled();
      expect(privy.verifyUserId).not.toHaveBeenCalled();
    });
  });
});

// ────────────────────────────────────────────────────────────────
// OptionalAuthGuard
// ────────────────────────────────────────────────────────────────

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard;
  let privy: jest.Mocked<PrivyVerificationService>;

  beforeEach(async () => {
    privy = makePrivyService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptionalAuthGuard,
        { provide: PrivyVerificationService, useValue: privy },
      ],
    }).compile();

    guard = module.get(OptionalAuthGuard);
  });

  it('sets req.user for a valid Bearer token and still returns true', async () => {
    privy.verifyAccessToken.mockResolvedValue(VALID_USER_ID);
    const ctx = makeContext({ authorization: `Bearer ${VALID_TOKEN}` });

    const result = await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();

    expect(result).toBe(true);
    expect(req.user).toEqual({ id: VALID_USER_ID });
  });

  it('returns true without throwing for an invalid JWT (user left as undefined)', async () => {
    privy.verifyAccessToken.mockResolvedValue(null);
    const ctx = makeContext({ authorization: `Bearer bad.token` });

    const result = await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();

    expect(result).toBe(true);
    expect(req.user).toBeUndefined();
  });

  it('sets req.user for a valid x-privy-user-id header', async () => {
    privy.verifyUserId.mockResolvedValue(true);
    const ctx = makeContext({ 'x-privy-user-id': VALID_USER_ID });

    await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();

    expect(req.user).toEqual({ id: VALID_USER_ID });
  });

  it('leaves req.user undefined when Privy rejects the legacy user ID', async () => {
    privy.verifyUserId.mockResolvedValue(false);
    const ctx = makeContext({ 'x-privy-user-id': 'did:privy:fake' });

    const result = await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();

    expect(result).toBe(true);
    expect(req.user).toBeUndefined();
  });

  it('returns true with undefined user when no credentials are sent', async () => {
    const ctx = makeContext({});

    const result = await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();

    expect(result).toBe(true);
    expect(req.user).toBeUndefined();
    expect(privy.verifyAccessToken).not.toHaveBeenCalled();
    expect(privy.verifyUserId).not.toHaveBeenCalled();
  });
});
