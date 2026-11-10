import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { APP_CONFIG, type AppConfig } from './config/env';
import { AllExceptionsFilter, originCheckMiddleware } from './platform/http/http-support';
import { MetricsService } from './platform/observability/metrics.service';
import { requestContextMiddleware } from './platform/observability/request-context';

/** Shared by main.ts and the end-to-end tests so tests exercise the same middleware stack as production. */
export function configureApp(app: INestApplication): void {
  const cfg = app.get<AppConfig>(APP_CONFIG);
  const http = app.getHttpAdapter().getInstance() as Express;

  http.disable('x-powered-by');
  // Hops of reverse proxy in front of the API (the Next.js rewrite, then Apache in production).
  http.set('trust proxy', cfg.DCC_TRUST_PROXY_HOPS);

  app.use(requestContextMiddleware);
  app.use(app.get(MetricsService).middleware);
  app.use(
    helmet({
      // The API returns JSON only; the strictest policy is correct. The web app sets its own CSP.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: cfg.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
    }),
  );
  app.use(cookieParser());
  app.use(originCheckMiddleware(cfg.DCC_WEB_ORIGIN));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api');
  // CORS stays OFF: the browser talks to the API through the web app's same-origin /api proxy.
  app.enableShutdownHooks();

  if (!cfg.isProduction || cfg.DCC_ENABLE_API_DOCS) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('DCC API')
        .setVersion('0.1.0')
        .addCookieAuth(cfg.isProduction ? '__Host-dcc_sid' : 'dcc_sid')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
}
