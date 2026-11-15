/**
 * Minimal types for multer, which arrives with @nestjs/platform-express (no extra dependency).
 * Only what the media upload uses.
 */
declare module 'multer' {
  import type { RequestHandler } from 'express';
  interface Options {
    dest?: string;
    limits?: { fileSize?: number; files?: number };
  }
  interface Multer {
    single(field: string): RequestHandler;
  }
  export default function multer(options?: Options): Multer;
}
