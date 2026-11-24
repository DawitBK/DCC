import { z } from 'zod';

/**
 * Runs in the browser before any application code, so before `@dcc/contracts` builds its schemas.
 *
 * zod normally checks whether the page may compile code by calling `new Function('')`. Under the
 * enforced Content-Security-Policy (no 'unsafe-eval', see `proxy.ts`) that call is refused, which is safe,
 * but the browser reports every refusal as a `securitypolicyviolation`: one `script-src` "eval" violation
 * on every signed-in page. `jitless` makes zod skip the probe and use its plain interpreter, which is
 * what it falls back to anyway. Validation behaves the same; only the speed of very large inputs differs.
 *
 * It has to be set before the first schema is created (zod reads it when a schema is built), which is why it
 * lives in `instrumentation-client` and not in a component.
 */
z.config({ jitless: true });
