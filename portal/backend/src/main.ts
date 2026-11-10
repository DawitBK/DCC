import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, type AppConfig } from './config/env';
import { JsonLogger } from './platform/observability/logger';

// Development convenience: read the repo-root .env. Real environment variables always win, and in
// production the platform injects the environment, so a missing file is normal.
const envFile = resolve(__dirname, '..', '..', '..', '.env');
if (!process.env.DCC_ENV_FILE && existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger((process.env.LOG_LEVEL as 'info') ?? 'info'),
  });
  configureApp(app);
  const cfg = app.get<AppConfig>(APP_CONFIG);
  // Loopback in development; the reverse proxy is the only thing allowed to reach the API in production.
  await app.listen(cfg.DCC_API_PORT, '127.0.0.1');
}

main().catch((error: Error) => {
  // Configuration errors are readable by design: they say exactly what to fix.
  console.error(error.message);
  process.exit(1);
});
