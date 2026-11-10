import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Minimal Prometheus exposition (no dependency): request counts and latency by method, route pattern
 * and status class, plus process memory and uptime. Labels use the ROUTE PATTERN, never the raw URL,
 * so cardinality stays bounded. Business and queue metrics are added by the modules that own them.
 */
@Injectable()
export class MetricsService {
  private readonly counts = new Map<string, number>();
  private readonly buckets = new Map<string, number[]>();
  private readonly sums = new Map<string, number>();

  observe(method: string, route: string, status: number, seconds: number): void {
    const key = `method="${method}",route="${route}",status="${Math.floor(status / 100)}xx"`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.sums.set(key, (this.sums.get(key) ?? 0) + seconds);
    const arr = this.buckets.get(key) ?? new Array<number>(BUCKETS.length + 1).fill(0);
    BUCKETS.forEach((le, i) => {
      if (seconds <= le) arr[i]! += 1;
    });
    arr[BUCKETS.length]! += 1;
    this.buckets.set(key, arr);
  }

  middleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route as { path?: string } | undefined)?.path;
      this.observe(
        req.method,
        route ? `${req.baseUrl}${route}` : 'unmatched',
        res.statusCode,
        seconds,
      );
    });
    next();
  };

  render(): string {
    const out: string[] = [
      '# HELP dcc_http_requests_total HTTP requests handled.',
      '# TYPE dcc_http_requests_total counter',
    ];
    for (const [k, v] of this.counts) out.push(`dcc_http_requests_total{${k}} ${v}`);
    out.push(
      '# HELP dcc_http_request_duration_seconds HTTP request latency.',
      '# TYPE dcc_http_request_duration_seconds histogram',
    );
    for (const [k, arr] of this.buckets) {
      BUCKETS.forEach((le, i) =>
        out.push(`dcc_http_request_duration_seconds_bucket{${k},le="${le}"} ${arr[i]}`),
      );
      out.push(`dcc_http_request_duration_seconds_bucket{${k},le="+Inf"} ${arr[BUCKETS.length]}`);
      out.push(`dcc_http_request_duration_seconds_sum{${k}} ${this.sums.get(k)}`);
      out.push(`dcc_http_request_duration_seconds_count{${k}} ${this.counts.get(k)}`);
    }
    const mem = process.memoryUsage();
    out.push(
      '# TYPE dcc_process_resident_memory_bytes gauge',
      `dcc_process_resident_memory_bytes ${mem.rss}`,
      '# TYPE dcc_process_uptime_seconds gauge',
      `dcc_process_uptime_seconds ${Math.round(process.uptime())}`,
    );
    return `${out.join('\n')}\n`;
  }
}
