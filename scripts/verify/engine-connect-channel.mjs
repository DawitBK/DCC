/**
 * Connects a PRACTICE channel through the publishing engine's own web screen, as the engine administrator would:
 * sign in to Postiz, press "Add Channel", choose "Practice network", type a handle, press "Connect".
 * Development only: the practice channel type exists only in the image built from the fork branch
 * `feat/dawit/practice-network`, started with POSTIZ_PRACTICE_NETWORK=true and the `practice` compose profile
 * (docs/engine/PRACTICE-NETWORK.md).
 *
 *   PLAYWRIGHT_FROM=<folder with node_modules/playwright-core> \
 *     ENGINE_ADMIN_EMAIL=... ENGINE_ADMIN_PASSWORD=... [ENGINE_URL=http://localhost:4007] [HANDLE=kerchanshe-practice] \
 *     node scripts/verify/engine-connect-channel.mjs
 *
 * The password is read from the environment and never printed. The channel it makes is found by `npm run verify:live
 * -w @dcc/engine-client` and `scripts/verify/practice-network-e2e.mjs` (its id: `select id from "Integration"` in the
 * engine database, or the list the live check prints). Exit code 1 when the engine did not accept the channel.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const need = (name) => {
  if (!process.env[name]) {
    console.error(`Set ${name} (see the header of this file).`);
    process.exit(2);
  }
  return process.env[name];
};
const { chromium } = createRequire(resolve(need('PLAYWRIGHT_FROM'), 'package.json'))(
  'playwright-core',
);
const ENGINE = (process.env.ENGINE_URL || 'http://localhost:4007').replace(/\/$/, '');
const HANDLE = process.env.HANDLE || 'kerchanshe-practice';

const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 1000 } })
).newPage();
let accepted = null;
page.on('response', (response) => {
  if (response.request().method() === 'POST' && /social-connect\/practice/.test(response.url()))
    accepted = response.status();
});
try {
  await page.goto(`${ENGINE}/auth/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(need('ENGINE_ADMIN_EMAIL'));
  await page.locator('input[name="password"]').fill(need('ENGINE_ADMIN_PASSWORD'));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/launches', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.getByText('Add Channel').first().click();
  await page.waitForTimeout(2000);
  if ((await page.getByText(/practice/i).count()) === 0)
    throw new Error(
      'The Add Channel dialog has no "Practice network": the engine is not running the fork image with POSTIZ_PRACTICE_NETWORK=true.',
    );
  await page
    .getByText(/practice/i)
    .first()
    .click();
  await page.locator('input[name="handle"]').fill(HANDLE);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForTimeout(7000);
  const listed = (await page.locator('body').innerText())
    .toLowerCase()
    .includes(HANDLE.toLowerCase());
  console.log(
    `the engine answered ${accepted} to the connect request; the channel "${HANDLE}" is in the engine's channel list: ${listed}`,
  );
  process.exitCode = accepted === 201 && listed ? 0 : 1;
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
