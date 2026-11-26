import { randomBytes } from 'node:crypto';

/**
 * A fake credential for tests, made at run time: `fakeValue('smtp')` is for example `fake-smtp-3fa91c07`.
 * Tests never carry a credential-shaped literal, so no secret scanner has anything to find, and a value
 * that leaks into a log or an answer is recognisable by the `fake-` prefix.
 */
export const fakeValue = (label: string): string =>
  `fake-${label}-${randomBytes(4).toString('hex')}`;
