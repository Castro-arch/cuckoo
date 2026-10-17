import { describe, expect, it } from 'vitest';
import { withoutOAuthTokens } from './create-auth.js';

describe('withoutOAuthTokens', () => {
  it('drops every provider token and keeps the identity fields', () => {
    const stripped = withoutOAuthTokens({
      providerId: 'google',
      accountId: 'google-sub-123',
      userId: 'u1',
      accessToken: 'ya29.secret',
      refreshToken: '1//secret',
      idToken: 'eyJ.secret',
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      scope: 'openid email profile',
    });

    expect(stripped).toEqual({
      providerId: 'google',
      accountId: 'google-sub-123',
      userId: 'u1',
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
    });
  });

  it('also nulls tokens on partial updates, such as a token refresh after Google sign-in', () => {
    expect(withoutOAuthTokens({ accessToken: 'ya29.new', idToken: 'eyJ.new' })).toMatchObject({
      accessToken: null,
      idToken: null,
    });
  });
});
