import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoProvider } from './brevo.provider.js';
import { renderSignInEmail } from './templates.js';
import { EmailError, type EmailMessage } from './types.js';

const message: EmailMessage = {
  to: 'ada@example.com',
  subject: 'Your IntellMeet sign-in code',
  text: 'Your code is 123456',
  html: '<p>Your code is 123456</p>',
};

const API_KEY = 'not-a-real-brevo-key-0123456789';

function brevo() {
  return new BrevoProvider({
    apiKey: API_KEY,
    from: { address: 'codes@example.com', name: 'IntellMeet' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('BrevoProvider', () => {
  it('posts the message to Brevo with the key in a header, not the body', async () => {
    const fetchMock = vi.fn(async () => Response.json({ messageId: '<1@brevo>' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await brevo().send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'api-key': API_KEY, 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: 'codes@example.com', name: 'IntellMeet' },
      to: [{ email: 'ada@example.com' }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    });
    expect(init.body).not.toContain(API_KEY);
  });

  it("reports the vendor's reason with the status, and never the key", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'invalid_parameter', message: 'Sender not valid' }), {
            status: 400,
          }),
      ),
    );

    const error = await brevo()
      .send(message)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailError);
    expect((error as EmailError).status).toBe(400);
    expect((error as EmailError).message).toContain('HTTP 400');
    expect((error as EmailError).message).toContain('Sender not valid');
    expect((error as EmailError).message).not.toContain(API_KEY);
  });

  it('reports an unreachable Brevo without a status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const error = await brevo()
      .send(message)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailError);
    expect((error as EmailError).status).toBeNull();
    expect((error as EmailError).message).toContain('could not be reached');
  });

  it('copes with an error reply that has no readable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 502 })),
    );

    await expect(brevo().send(message)).rejects.toThrow('brevo returned HTTP 502');
  });
});

describe('sign-in emails', () => {
  it('puts the code in the body of a code email, and out of its subject', () => {
    const { subject, text, html } = renderSignInEmail({
      kind: 'code',
      code: '042917',
      ttlMinutes: 10,
    });

    expect(text).toContain('042917');
    expect(html).toContain('042917');
    expect(subject).not.toContain('042917');
    expect(text).toContain('10 minutes');
    expect(text).toMatch(/never share/i);
  });

  it('gives the other two emails a link and no code', () => {
    const none = renderSignInEmail({
      kind: 'no-account',
      signUpUrl: 'https://app.example/register',
    });
    const has = renderSignInEmail({ kind: 'has-account', signInUrl: 'https://app.example/login' });

    expect(none.text).toContain('https://app.example/register');
    expect(none.html).toContain('href="https://app.example/register"');
    expect(has.text).toContain('https://app.example/login');
    expect(has.html).toContain('href="https://app.example/login"');
    for (const rendered of [none, has]) {
      expect(rendered.text).not.toMatch(/\b\d{6}\b/);
      expect(rendered.html).not.toMatch(/\b\d{6}\b/);
    }
  });

  it('tells a stranger to ignore an email they did not ask for', () => {
    for (const email of [
      { kind: 'code', code: '123456', ttlMinutes: 10 } as const,
      { kind: 'no-account', signUpUrl: 'https://app.example/register' } as const,
      { kind: 'has-account', signInUrl: 'https://app.example/login' } as const,
    ]) {
      expect(renderSignInEmail(email).text).toMatch(/didn't ask for this/i);
    }
  });
});

describe('getEmailProvider', () => {
  it('refuses the console provider in production rather than logging codes', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'console');

    const { getEmailProvider } = await import('./index.js');

    expect(() => getEmailProvider()).toThrow(/not available right now/);
  });

  it('uses the console provider outside production', async () => {
    vi.resetModules();
    vi.stubEnv('EMAIL_PROVIDER', 'console');

    const { getEmailProvider } = await import('./index.js');

    expect(getEmailProvider().name).toBe('console');
  });

  it('builds Brevo from its settings', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'brevo');
    vi.stubEnv('BREVO_API_KEY', API_KEY);
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'codes@example.com');

    const { getEmailProvider } = await import('./index.js');

    expect(getEmailProvider().name).toBe('brevo');
  });
});
