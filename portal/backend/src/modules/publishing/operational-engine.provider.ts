import type { Provider } from '@nestjs/common';
import { FakeEngine, type OperationalEngine } from '@dcc/engine-client';
import { APP_CONFIG, type AppConfig } from '../../config/env';

export const OPERATIONAL_ENGINE = Symbol('OPERATIONAL_ENGINE');

/**
 * Which engine GovernedEngine actually calls. `ENGINE_PROVIDER` is Dawit's config
 * (portal/backend/src/config/env.ts); this only reads it, never redefines it.
 *
 * `postiz` is refused here on purpose: the adapter has never been run against a live Postiz
 * (W-03, ASM-08) - wiring it in before that proof would let DCC silently publish through an
 * unverified integration. Flip this once W-03 is done; until then, `fake` is the only live option.
 */
export const operationalEngineProvider: Provider = {
  provide: OPERATIONAL_ENGINE,
  inject: [APP_CONFIG],
  useFactory: (cfg: AppConfig): OperationalEngine => {
    if (cfg.ENGINE_PROVIDER === 'postiz') {
      throw new Error(
        'ENGINE_PROVIDER=postiz is not wired up yet: the adapter is unverified against a live Postiz (W-03, ASM-08). Use ENGINE_PROVIDER=fake until Woluman closes that out.',
      );
    }
    return new FakeEngine([]);
  },
};
