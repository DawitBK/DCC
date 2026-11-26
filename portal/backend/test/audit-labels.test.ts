import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditActions } from '../src/platform/audit/audit.service';

/**
 * The activity audit screen shows every action in plain English from one table
 * (`AUDIT_ACTIONS` in portal/frontend/src/components/audit-event.tsx). An action the table does not know is
 * still shown, but with a label made from its code name ("Inbox: ack sent"), which an auditor cannot be
 * expected to read. A real-browser pass of Round 2 (2026-11-26) found 23 actions without a label: this
 * keeps the table level with the backend.
 */
describe('audit labels in the web app', () => {
  const source = readFileSync(
    resolve(__dirname, '../../frontend/src/components/audit-event.tsx'),
    'utf8',
  );
  const labelled = new Set([...source.matchAll(/^\s+'([a-z_]+\.[a-z_]+)':/gm)].map((m) => m[1]));

  it('has a plain-English label for every action the backend can write', () => {
    const missing = Object.values(AuditActions).filter((action) => !labelled.has(action));
    expect(missing).toEqual([]);
  });

  it('knows the kind of record a reply approval request is', () => {
    expect(source).toContain("value: 'reply_approval_request'");
  });
});
