import type { Provider } from '@nestjs/common';
import { SOCIAL_PLATFORMS } from '@dcc/contracts';
import { FakeEngine, PostizEngine, type OperationalEngine } from '@dcc/engine-client';
import { APP_CONFIG, type AppConfig } from '../../config/env';

export const OPERATIONAL_ENGINE = Symbol('OPERATIONAL_ENGINE');

/**
 * Which engine GovernedEngine actually calls. `ENGINE_PROVIDER` is Dawit's config
 * (portal/backend/src/config/env.ts); this only reads it, never redefines it.
 *
 * `postiz` connects to a real Postiz. The adapter is proven live for reading and for refusals
 * (`npm run verify:live -w @dcc/engine-client`), but a real post on a real network is NOT proven yet
 * (W-03, ASM-08). So it starts only with DCC_ENGINE_ALLOW_UNVERIFIED=true: a deliberate choice on a
 * developer computer or a test host, never a silent default. Remove the switch when W-03 is closed.
 */
export const operationalEngineProvider: Provider = {
  provide: OPERATIONAL_ENGINE,
  inject: [APP_CONFIG],
  useFactory: (cfg: AppConfig): OperationalEngine => {
    if (cfg.ENGINE_PROVIDER === 'postiz') {
      if (cfg.DCC_ENGINE_ALLOW_UNVERIFIED !== 'true')
        throw new Error(
          'ENGINE_PROVIDER=postiz: a real post through Postiz is not proven yet (W-03, ASM-08). Set DCC_ENGINE_ALLOW_UNVERIFIED=true to connect anyway (development and test hosts), or use ENGINE_PROVIDER=fake.',
        );
      return new PostizEngine({ baseUrl: cfg.POSTIZ_BASE_URL!, apiKey: cfg.POSTIZ_API_KEY! });
    }
    // The fake engine carries one practice channel per network, so the whole path (register an account,
    // link it, approve, publish) can be walked on a developer's computer and in a demonstration.
    // The names say what they are. Nothing is sent anywhere.
    return new FakeEngine(
      SOCIAL_PLATFORMS.flatMap((platform) =>
        [1, 2].map((n) => ({
          engineChannelId: `fake-${platform}-${n}`,
          name: `Practice ${platform} channel ${n} (fake engine)`,
          platform,
          providerIdentifier: platform,
          disabled: false,
        })),
      ),
    );
  },
};
