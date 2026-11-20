import { SetMetadata } from '@nestjs/common';

// Standalone on purpose: importing this decorator must never pull in the guard (and through it the
// auth/users modules), or the circular import leaves it undefined when UsersController loads.
export const ALLOW_WALLET_ONLY_KEY = 'allowWalletOnly';
/** Opt a controller/route out of the verified-identity requirement (sign-in, profile, linking an email). */
export const AllowWalletOnly = () => SetMetadata(ALLOW_WALLET_ONLY_KEY, true);
