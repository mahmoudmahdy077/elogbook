import { createServiceRoleClient } from './admin';

export type SessionRevocationScope = 'global' | 'others';

export type SessionRevocationResult =
  | {
      ok: true;
      scope: SessionRevocationScope;
      refreshTokenRevocationRequested: true;
      accessTokenRevoked: false;
    }
  | { ok: false; reason: 'missing_access_token' | 'revocation_failed' };

export type UserBanResult =
  | { ok: true }
  | { ok: false; reason: 'missing_user_id' | 'ban_update_failed' };

export async function setUserBanned(
  userId: string,
  banned: boolean,
): Promise<UserBanResult> {
  if (!userId.trim()) return { ok: false, reason: 'missing_user_id' };

  try {
    const client = createServiceRoleClient();
    const { error } = await client.auth.admin.updateUserById(userId, {
      ban_duration: banned ? '876000h' : 'none',
    });
    if (error) return { ok: false, reason: 'ban_update_failed' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'ban_update_failed' };
  }
}

export async function revokeUserSessions(
  accessToken: string,
  scope: SessionRevocationScope = 'global',
): Promise<SessionRevocationResult> {
  if (!accessToken.trim()) return { ok: false, reason: 'missing_access_token' };

  try {
    const client = createServiceRoleClient();
    const { error } = await client.auth.admin.signOut(accessToken, scope);
    if (error) return { ok: false, reason: 'revocation_failed' };

    return {
      ok: true,
      scope,
      refreshTokenRevocationRequested: true,
      accessTokenRevoked: false,
    };
  } catch {
    return { ok: false, reason: 'revocation_failed' };
  }
}
