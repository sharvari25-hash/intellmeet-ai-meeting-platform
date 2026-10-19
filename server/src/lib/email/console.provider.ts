import { logger } from '../logger.js';
import type { EmailMessage, EmailProvider } from './types.js';

/**
 * Prints each message to the server log instead of sending it.
 *
 * What `EMAIL_PROVIDER=console` (the default) selects, so the sign-in flow runs
 * with no account at all: the code is in the terminal that runs `npm run dev`.
 * That is exactly why it is refused in production (email/index.ts) - a code in
 * a log is a code for anybody who can read the log.
 */
export class ConsoleProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject },
      `[email] not sent (EMAIL_PROVIDER=console)\n${message.text}`,
    );
  }
}
