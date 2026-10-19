import type { EmailMessage } from './types.js';

/**
 * The three emails the sign-in flow sends.
 *
 * Nothing user-supplied goes into any of them - no name, no address in the
 * body - so there is nothing to escape and nothing to inject. The variables are
 * a code made of digits, a number of minutes and two URLs built from
 * configuration.
 */
export type SignInEmail =
  /** A code, to the address of an account being signed in to or created. */
  | { kind: 'code'; code: string; ttlMinutes: number }
  /** Someone asked to sign in with an address that has no account. */
  | { kind: 'no-account'; signUpUrl: string }
  /** Someone asked to sign up with an address that already has an account. */
  | { kind: 'has-account'; signInUrl: string };

type Rendered = Pick<EmailMessage, 'subject' | 'text' | 'html'>;

const IGNORE_NOTE = "If you didn't ask for this, you can ignore this email. Nothing will change.";

interface PageParts {
  heading: string;
  paragraphs: string[];
  /** The code, set large. */
  code?: string;
  link?: string;
  footnote?: string;
}

/** One shell for all three, so they look like the same sender. */
function page({ heading, paragraphs, code, link, footnote }: PageParts): string {
  const paragraph = (text: string) => `<p style="margin:0 0 16px">${text}</p>`;

  const codeBlock = code
    ? '<p style="margin:0 0 16px;font-size:32px;letter-spacing:8px;font-weight:700;' +
      `font-family:ui-monospace,Menlo,Consolas,monospace">${code}</p>`
    : '';
  const linkBlock = link ? paragraph(`<a href="${link}" style="color:#4f46e5">${link}</a>`) : '';
  const footnoteBlock = footnote
    ? `<p style="margin:16px 0 0;color:#71717a;font-size:13px">${footnote}</p>`
    : '';

  return (
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5">' +
    '<div style="max-width:480px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px;' +
    'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;' +
    'line-height:1.5;color:#18181b">' +
    `<h1 style="margin:0 0 16px;font-size:18px">${heading}</h1>` +
    `${paragraphs.map(paragraph).join('')}${codeBlock}${linkBlock}${footnoteBlock}` +
    '</div></body></html>'
  );
}

export function renderSignInEmail(email: SignInEmail): Rendered {
  switch (email.kind) {
    case 'code':
      return {
        // The code is not in the subject: a subject shows on a lock screen and
        // in a notification, where anybody near the phone can read it.
        subject: 'Your IntellMeet sign-in code',
        text: [
          'Your IntellMeet sign-in code is:',
          '',
          email.code,
          '',
          `It works for ${email.ttlMinutes} minutes, and only once. Never share it with anyone.`,
          '',
          IGNORE_NOTE,
        ].join('\n'),
        html: page({
          heading: 'Your sign-in code',
          paragraphs: [
            `Enter this code in IntellMeet. It works for ${email.ttlMinutes} minutes, and only once.`,
          ],
          code: email.code,
          footnote: `Never share this code with anyone. ${IGNORE_NOTE}`,
        }),
      };

    case 'no-account':
      return {
        subject: 'There is no IntellMeet account for this email',
        text: [
          'Someone asked to sign in to IntellMeet with this email address, but there is no account for it yet.',
          '',
          `To create one, go to: ${email.signUpUrl}`,
          '',
          IGNORE_NOTE,
        ].join('\n'),
        html: page({
          heading: 'No account for this email',
          paragraphs: [
            'Someone asked to sign in to IntellMeet with this email address, but there is no account for it yet. To create one:',
          ],
          link: email.signUpUrl,
          footnote: IGNORE_NOTE,
        }),
      };

    case 'has-account':
      return {
        subject: 'You already have an IntellMeet account',
        text: [
          'Someone asked to create an IntellMeet account with this email address, but you already have one.',
          '',
          `To sign in, go to: ${email.signInUrl}`,
          '',
          IGNORE_NOTE,
        ].join('\n'),
        html: page({
          heading: 'You already have an account',
          paragraphs: [
            'Someone asked to create an IntellMeet account with this email address, but you already have one. To sign in:',
          ],
          link: email.signInUrl,
          footnote: IGNORE_NOTE,
        }),
      };
  }
}
