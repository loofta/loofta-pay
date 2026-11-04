import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

/** A structured refusal an agent can act on: a stable code plus a plain sentence. */
export const agentError = (code: string, message: string, status: 'bad' | 'forbidden' | 'conflict' = 'bad') => {
  const body = { code, message };
  return status === 'forbidden' ? new ForbiddenException(body) : status === 'conflict' ? new ConflictException(body) : new BadRequestException(body);
};
