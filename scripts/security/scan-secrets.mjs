// Dependency-free secret scan over the files git tracks (or will track). Run: npm run secrets:scan
// It is a safety net, not a replacement for care: it catches the common accidents (private keys,
// cloud keys, tokens, a filled-in "password=" outside the documented dev placeholders).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .filter((f) => !/(^|\/)package-lock\.json$/.test(f));

const RULES = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    'connection string with a password',
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:([^\s@/]{4,})@/,
  ],
  [
    'hard-coded secret assignment',
    /\b(?:password|passwd|secret|api[_-]?key|token)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i,
  ],
];

// Values that are clearly placeholders, test fixtures or documentation, not credentials.
const SAFE =
  /(dev-only|ci-only|test-client|change-?me|replace-with|example|placeholder|your-|<[^>]+>|\$\{|process\.env|xxxx|0000|not-a-real|SUPER-SECRET|a-long-enough|top secret)/i;

// Files whose content is deliberately fake or about secrets themselves.
const SKIP = /(^|\/)(\.env\.example|scan-secrets\.mjs|.*\.test\.ts|helpers\.ts|setup-env\.ts)$/;

let findings = 0;
for (const file of files) {
  if (SKIP.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) {
      const m = re.exec(line);
      if (m && !SAFE.test(line)) {
        findings += 1;
        console.error(`${file}:${i + 1}  ${name}`);
      }
    }
  });
}

if (findings > 0) {
  console.error(
    `\n${findings} possible secret(s). Remove them, rotate anything that was real, or (for a documented placeholder) make the placeholder obvious.`,
  );
  process.exit(1);
}
console.log(`secret scan: ${files.length} files, no findings`);
