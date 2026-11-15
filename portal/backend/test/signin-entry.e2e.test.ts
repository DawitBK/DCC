import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OidcService } from '../src/platform/auth/oidc.service';
import { listenForTests, resetTestDatabase } from './helpers';

/**
 * The sign-in entry point (GET /api/auth/login) with the identity provider replaced by a stand-in, so
 * the two things DCC itself decides can be checked without a running SSO:
 *   - what the person sees when the SSO does not answer (found in the mirror rehearsal of 2026-11-14:
 *     it was a bare 500);
 *   - that ?reauth=1 really asks for a re-authentication and nothing else does.
 */
describe('sign-in entry point', () => {
  let app: INestApplication;
  let base: string;
  const calls: { returnTo: unknown; reauth: boolean }[] = [];
  let idpAnswers = true;

  beforeAll(async () => {
    await resetTestDatabase();
    const standIn: Pick<OidcService, 'beginLogin'> = {
      beginLogin: async (returnTo, options = {}) => {
        if (!idpAnswers) throw new TypeError('fetch failed');
        calls.push({ returnTo, reauth: options.reauth === true });
        return 'http://localhost:7301/auth?client_id=dcc';
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OidcService)
      .useValue(standIn)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const login = (query = '') => fetch(`${base}/api/auth/login${query}`, { redirect: 'manual' });

  it('sends the browser to the identity provider', async () => {
    const res = await login('?returnTo=/approvals');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:7301/auth?client_id=dcc');
    expect(calls.at(-1)).toEqual({ returnTo: '/approvals', reauth: false });
  });

  it('asks for a re-authentication only for ?reauth=1', async () => {
    await login('?reauth=1&returnTo=/governance');
    expect(calls.at(-1)).toEqual({ returnTo: '/governance', reauth: true });
    for (const other of ['?reauth=0', '?reauth=true', '?reauth=', '']) {
      await login(other);
      expect(calls.at(-1)!.reauth, other).toBe(false);
    }
  });

  it('when the identity provider does not answer, the person lands back on DCC with a reason, not on a 500', async () => {
    idpAnswers = false;
    const res = await login();
    idpAnswers = true;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:7717/?error=signin_unavailable');
  });
});
