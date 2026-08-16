import { fetchApi } from './client';

/** GET /users/by-username — public, unauthenticated. 404s if the username doesn't exist. */
export async function checkUsernameExists(username: string): Promise<boolean> {
  try {
    await fetchApi<{ user: { username: string | null } }>(`/users/by-username?username=${encodeURIComponent(username)}`, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}
