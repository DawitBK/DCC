import type { Provider } from '@nestjs/common';
import { SOCIAL_PLATFORMS } from '@dcc/contracts';
import {
  CompositeEngine,
  FakeEngine,
  PostizEngine,
  supportsAnalytics,
  type AnalyticsEngine,
  type OperationalEngine,
} from '@dcc/engine-client';
import { APP_CONFIG, type AppConfig } from '../../config/env';

export const OPERATIONAL_ENGINE = Symbol('OPERATIONAL_ENGINE');
/** The two read-only analytics calls and nothing else. This is the only engine token that leaves the publishing module. */
export const ANALYTICS_ENGINE = Symbol('ANALYTICS_ENGINE');

/**
 * Which engine GovernedEngine actually calls. `ENGINE_PROVIDER` is Dawit's config
 * (portal/backend/src/config/env.ts); this only reads it, never redefines it.
 *
 * `postiz` connects to a real Postiz. The adapter is proven live for reading and for refusals
 * (`npm run verify:live -w @dcc/engine-client`), but a real post on a real network is NOT proven yet
 * (W-03, ASM-08). So it starts only with DCC_ENGINE_ALLOW_UNVERIFIED=true: a deliberate choice on a
 * developer computer or a test host, never a silent default. Remove the switch when W-03 is closed.
 */
/** Sample comments and messages for the practice channels, so the inbox can be tried. Not real people. */
const PRACTICE_INBOX: [
  channel: string,
  kind: 'comment' | 'direct_message',
  author: string,
  text: string,
  hoursAgo: number,
][] = [
  ['fake-facebook-1', 'comment', 'Meseret A.', 'Is this available in Hawassa?', 2],
  [
    'fake-facebook-1',
    'direct_message',
    'Tadesse B.',
    'Hello, who do I contact about a bulk order?',
    5,
  ],
  ['fake-instagram-1', 'comment', 'Liya K.', 'Beautiful photo. Where was it taken?', 9],
  ['fake-linkedin-1', 'comment', 'Yonas T.', 'Congratulations to the whole team.', 20],
  ['fake-linkedin-1', 'direct_message', 'Hana G.', 'Are you hiring agronomists this year?', 26],
  ['fake-x-1', 'comment', 'Abel D.', 'Your website link in this post does not open.', 30],
  ['fake-tiktok-1', 'comment', 'Sara M.', 'More videos like this please.', 49],
  ['fake-youtube-1', 'comment', 'Dawit H.', 'What is the price of the new model?', 70],
  [
    'fake-facebook-2',
    'comment',
    'Kebede W.',
    'I sent a message last week and nobody answered.',
    96,
  ],
  [
    'fake-instagram-2',
    'direct_message',
    'Ruth F.',
    'Can I visit the factory with my students?',
    120,
  ],
];

function practiceEngine(): FakeEngine {
  // One pair of practice channels per network, so the whole path (register an account, link it,
  // approve, publish, answer a comment) can be walked on a developer's computer and in a
  // demonstration. The names say what they are. Nothing is sent anywhere.
  const engine = new FakeEngine(
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
  PRACTICE_INBOX.forEach(([engineChannelId, kind, authorName, text, hoursAgo], i) =>
    engine.inboxMessages.push({
      engineMessageId: `practice-message-${i + 1}`,
      engineChannelId,
      kind,
      authorName,
      text,
      receivedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
      engineOperationId: null,
      replied: false,
    }),
  );
  return engine;
}

export const operationalEngineProvider: Provider = {
  provide: OPERATIONAL_ENGINE,
  inject: [APP_CONFIG],
  useFactory: (cfg: AppConfig): OperationalEngine => {
    if (cfg.ENGINE_PROVIDER === 'postiz') {
      if (cfg.DCC_ENGINE_ALLOW_UNVERIFIED !== 'true')
        throw new Error(
          'ENGINE_PROVIDER=postiz: a real post through Postiz is not proven yet (W-03, ASM-08). Set DCC_ENGINE_ALLOW_UNVERIFIED=true to connect anyway (development and test hosts), or use ENGINE_PROVIDER=fake.',
        );
      const postiz = new PostizEngine({
        baseUrl: cfg.POSTIZ_BASE_URL!,
        apiKey: cfg.POSTIZ_API_KEY!,
        practicePlatform: cfg.DCC_ENGINE_PRACTICE_NETWORK_PLATFORM,
        inbox: cfg.DCC_ENGINE_POSTIZ_INBOX === 'true',
      });
      return cfg.DCC_ENGINE_PRACTICE_CHANNELS === 'true'
        ? new CompositeEngine(postiz, practiceEngine())
        : postiz;
    }
    return practiceEngine();
  },
};

/**
 * Hands out only the two analytics reads, in an object of their own: a module that receives it cannot
 * reach publish or any other part of the engine (every publish goes through GovernedEngine, and the raw
 * engine token stays inside the publishing module). null = this engine has no analytics.
 */
export const analyticsEngineProvider: Provider = {
  provide: ANALYTICS_ENGINE,
  inject: [OPERATIONAL_ENGINE],
  useFactory: (engine: OperationalEngine): AnalyticsEngine | null => {
    if (!supportsAnalytics(engine)) return null;
    const analytics: AnalyticsEngine = engine;
    return {
      channelAnalytics: (engineChannelId, days) =>
        analytics.channelAnalytics(engineChannelId, days),
      postAnalytics: (engineOperationId, days) => analytics.postAnalytics(engineOperationId, days),
    };
  },
};
