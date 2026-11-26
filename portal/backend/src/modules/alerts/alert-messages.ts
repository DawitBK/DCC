import { SEVERITY_SEV, SMS_MAX_CHARACTERS, type AlertChannel } from '@dcc/contracts';

/**
 * The words of an alert, per channel. Plain text only: control characters and line breaks are removed from
 * everything a person typed (the incident title, the company name) before it is placed in a message, and what goes into
 * the Teams card is escaped for its markdown. No personal data is in any of it beyond the incident title, its severity,
 * the company and a link.
 */

export interface AlertFacts {
  severity: 'critical' | 'high';
  title: string;
  companyName: string;
  /** Where the incident can be opened: a full address when DCC knows its public address, otherwise a path. */
  link: string;
}

export interface ComposedAlert {
  subject: string;
  body: string;
}

// Control characters, DEL, the C1 range and the unicode line and paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029]+', 'g');

/** Removes control characters (including line breaks) and runs of spaces. */
export const plain = (text: string): string =>
  text
    .replace(CONTROL, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

/** Neutralises what Teams would read as formatting or as a link inside a card text. */
export const escapeTeamsText = (text: string): string =>
  text.replace(/([\\`*_{}[\]()<>#|~])/g, '\\$1');

const sev = (severity: AlertFacts['severity']) => SEVERITY_SEV[severity];

/** The incident-opened alert for one channel. For Teams the body is the card, as JSON text. */
export function composeAlert(channel: AlertChannel, facts: AlertFacts): ComposedAlert {
  const title = cut(plain(facts.title), 200);
  const company = cut(plain(facts.companyName), 80);
  const level = sev(facts.severity);
  const subject = cut(`[${level}] Incident at ${company}: ${title}`, 250);

  if (channel === 'sms') {
    const tail = ` ${plain(facts.link)}`;
    const head = `DCC ${level} incident, ${company}: `;
    const room = SMS_MAX_CHARACTERS - head.length - tail.length - 1;
    // If the link alone is too long, keep the title and drop the link rather than send a cut-off address.
    const text =
      room >= 20
        ? `${head}${cut(title, room)}.${tail}`
        : cut(`${head}${title}`, SMS_MAX_CHARACTERS);
    return { subject, body: cut(text, SMS_MAX_CHARACTERS) };
  }

  if (channel === 'email') {
    const body = [
      `A ${level} incident was opened at ${company}.`,
      '',
      `Incident: ${title}`,
      `Severity: ${level} (${facts.severity})`,
      `Company: ${company}`,
      `Open it in DCC: ${plain(facts.link)}`,
      '',
      'This is an automatic alert from DCC. Do not reply to it.',
    ].join('\n');
    return { subject, body };
  }

  return { subject, body: JSON.stringify(teamsCard(facts)) };
}

/** One Adaptive Card in the message envelope that a Teams "when a webhook request is received" flow accepts. */
export function teamsCard(facts: AlertFacts) {
  const level = sev(facts.severity);
  const link = plain(facts.link);
  const body: unknown[] = [
    {
      type: 'TextBlock',
      text: escapeTeamsText(`${level} incident`),
      weight: 'Bolder',
      size: 'Medium',
      color: 'Attention',
      wrap: true,
    },
    { type: 'TextBlock', text: escapeTeamsText(cut(plain(facts.title), 200)), wrap: true },
    {
      type: 'FactSet',
      facts: [
        { title: 'Severity', value: `${level} (${facts.severity})` },
        { title: 'Company', value: escapeTeamsText(cut(plain(facts.companyName), 80)) },
      ],
    },
  ];
  const actions = /^https?:\/\//.test(link)
    ? [{ type: 'Action.OpenUrl', title: 'Open the incident', url: link }]
    : [];
  if (!actions.length)
    body.push({ type: 'TextBlock', text: escapeTeamsText(`Open: ${link}`), wrap: true });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(actions.length && { actions }),
        },
      },
    ],
  };
}

/** The test alert: same shape as a real one, clearly marked, and no incident behind it. */
export function composeTest(channel: AlertChannel, link: string): ComposedAlert {
  return composeAlert(channel, {
    severity: 'high',
    title: 'TEST ALERT: nothing has happened, this only checks that alerts arrive',
    companyName: 'DCC',
    link,
  });
}
