import { EMAIL_PROVIDERS, env, isProduction } from '../../config/env.js';
import { AppError } from '../errors.js';
import { BrevoProvider } from './brevo.provider.js';
import { ConsoleProvider } from './console.provider.js';
import type { EmailProvider } from './types.js';

export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

/**
 * Builds the provider `EMAIL_PROVIDER` asks for. The settings Brevo needs are
 * checked at startup (env.ts); they are checked again here only to narrow the
 * types.
 */
export function createEmailProvider(name: EmailProviderName = env.EMAIL_PROVIDER): EmailProvider {
  switch (name) {
    case 'brevo': {
      if (!env.BREVO_API_KEY || !env.EMAIL_FROM_ADDRESS) {
        throw new Error(
          'BREVO_API_KEY and EMAIL_FROM_ADDRESS must be set when EMAIL_PROVIDER=brevo',
        );
      }
      return new BrevoProvider({
        apiKey: env.BREVO_API_KEY,
        from: { address: env.EMAIL_FROM_ADDRESS, name: env.EMAIL_FROM_NAME },
      });
    }
    case 'console':
      return new ConsoleProvider();
  }
}

let provider: EmailProvider | null = null;

/**
 * The configured provider, built once.
 *
 * In production the console provider is refused rather than used: it would
 * write every sign-in code to the log and deliver nothing. The feature
 * reports itself unavailable, in words for the person who hit it, instead of
 * quietly looking as if it worked.
 */
export function getEmailProvider(): EmailProvider {
  if (provider) return provider;

  if (isProduction && env.EMAIL_PROVIDER === 'console') {
    throw AppError.unavailable(
      'Signing in with an email code is not available right now. Use your password or the demo.',
    );
  }

  provider = createEmailProvider();
  return provider;
}

/** Test seam: swap in a recording provider. `null` restores the configured one. */
export function setEmailProvider(next: EmailProvider | null): void {
  provider = next;
}

export * from './types.js';
