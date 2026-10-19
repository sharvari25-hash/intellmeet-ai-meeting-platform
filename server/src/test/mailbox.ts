import { setEmailProvider, type EmailMessage, type EmailProvider } from '../lib/email/index.js';

/**
 * An email provider that keeps what it was asked to send.
 *
 * Tests read the code out of the message the same way a person would, rather
 * than reaching into the database: the code is stored only as an HMAC, so the
 * email is the one place it exists.
 */
export class Mailbox implements EmailProvider {
  readonly name = 'test-mailbox';
  readonly sent: EmailMessage[] = [];

  /** When set, `send` rejects with it, as a provider outage would. */
  failWith: Error | null = null;

  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }

  /** Every message sent to an address, oldest first. */
  to(address: string): EmailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }

  /** The six-digit code in the newest message to an address. */
  codeFor(address: string): string {
    const message = this.to(address).at(-1);
    const code = message ? /\b(\d{6})\b/.exec(message.text)?.[1] : undefined;
    if (!code) throw new Error(`No email with a code was sent to ${address}`);
    return code;
  }
}

/** Routes sign-in emails to a fresh mailbox for the current test. */
export function installMailbox(): Mailbox {
  const mailbox = new Mailbox();
  setEmailProvider(mailbox);
  return mailbox;
}

/** Puts the configured provider back. Call from `afterEach`. */
export function removeMailbox(): void {
  setEmailProvider(null);
}
