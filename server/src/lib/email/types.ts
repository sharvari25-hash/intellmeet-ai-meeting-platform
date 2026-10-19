/**
 * The seam between the sign-in flow and whatever delivers email.
 *
 * The flow only ever calls `send`, so the console provider (development and
 * tests) and Brevo (production) are interchangeable - chosen by
 * `EMAIL_PROVIDER`, not by code.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Always present: some clients show only text, and spam filters like both. */
  text: string;
  html: string;
}

/**
 * A provider that could not deliver a message.
 *
 * The message carries the HTTP status and a trimmed slice of the vendor's reply
 * - which is where it explains what was wrong, such as a sender it has not
 * validated - but never the request, so the API key cannot reach a log line.
 */
export class EmailError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}
