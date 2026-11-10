import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Tests read the repo-root .env (copy of .env.example) and ALWAYS use the scratch test database.
const envFile = resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const testDb = process.env.DCC_TEST_DB_NAME ?? 'dcc_test';
const swap = (url: string | undefined) =>
  url ? url.replace(/\/[^/?]+(\?.*)?$/, `/${testDb}$1`) : url;

process.env.NODE_ENV = 'test';
// Hermetic: a developer's own ports, IdP address or secrets in .env must never change what the tests expect.
process.env.DCC_WEB_ORIGIN = 'http://localhost:7717';
process.env.OIDC_ISSUER = 'http://localhost:7301';
process.env.OIDC_REDIRECT_URI = 'http://localhost:7717/api/auth/callback';
process.env.OIDC_POST_LOGOUT_URI = 'http://localhost:7717/';
process.env.OIDC_CLIENT_SECRET = 'test-client-secret-test-client-secret';
process.env.DCC_DEV_BOOTSTRAP_ADMIN_EMAILS = '';
process.env.METRICS_TOKEN = '';
process.env.ENGINE_PROVIDER = 'fake';
process.env.DCC_DATABASE_URL = swap(process.env.DCC_DATABASE_URL);
process.env.DCC_MIGRATE_DATABASE_URL = swap(process.env.DCC_MIGRATE_DATABASE_URL);
process.env.DCC_LOCAL_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.OIDC_CLIENT_SECRET ||= 'test-client-secret-test-client-secret';
