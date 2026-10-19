import { EmailError, type EmailMessage, type EmailProvider } from './types.js';

const SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * A code that arrives after the person has given up is no use, and the request
 * that triggered it is waiting on this call, so the wait is short.
 */
const SEND_TIMEOUT_MS = 10_000;

export interface BrevoConfig {
  apiKey: string;
  from: { address: string; name: string };
}

/**
 * Brevo's transactional email API, over HTTPS.
 *
 * Not SMTP: Render's free web services block outbound SMTP ports (25, 465 and
 * 587), so a mail library would time out in production while working on a
 * laptop. Brevo only sends from an address it has validated (Brevo console ->
 * Senders, domains & dedicated IPs); an unvalidated sender is refused with a
 * 4xx whose reason is in the error message.
 *
 * No retry: a person is waiting on this request and can press "Resend", which
 * is a better second try than a silent one that doubles the daily allowance.
 */
export class BrevoProvider implements EmailProvider {
  readonly name = 'brevo';

  constructor(private readonly config: BrevoConfig) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;

    try {
      response = await fetch(SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.config.from.address, name: this.config.from.name },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'network error';
      throw new EmailError(this.name, `brevo could not be reached: ${reason}`, null);
    }

    if (response.ok) return;

    const text = await response.text().catch(() => '');
    const detail = text.replace(/\s+/g, ' ').slice(0, 300);
    throw new EmailError(
      this.name,
      `brevo returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
    );
  }
}
