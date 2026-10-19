import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  loginCodeSchema,
  loginSchema,
  registerSchema,
  type LoginCodePurpose,
  type LoginCodeSent,
  type RequestLoginCodeInput,
} from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from './FormError';
import { useSecondsUntil } from './useSecondsUntil';
import { useRequestLoginCode, useVerifyLoginCode } from './useAuth';

/**
 * Signing in or signing up with a code sent by email: the address (and, for a
 * sign-up, the name), then the code.
 *
 * One component for both pages, because the second step is identical and the
 * first differs by one field. Which one it is, is the `purpose`; the server
 * does the rest (it creates the account when the code was for a sign-up).
 *
 * It never says whether an address has an account. The server answers every
 * address alike and emails the ones that need telling, so this screen can only
 * say "we emailed a code" - and does, whether or not one was sent.
 */

interface AddressValues {
  name?: string;
  email: string;
}

// The same rules the server checks, taken from the schemas it uses: a name is
// two to eighty characters wherever it is asked for.
const loginAddress = loginSchema.pick({ email: true });
const registerAddress = registerSchema.pick({ name: true, email: true });

/** What was asked for and what the server said, kept for the second step. */
interface CodeRequested {
  request: RequestLoginCodeInput;
  sent: LoginCodeSent;
}

export function EmailCodeForm({ purpose }: { purpose: LoginCodePurpose }) {
  const [requested, setRequested] = useState<CodeRequested | null>(null);
  // Kept across "Use a different email", so a typo costs one field, not all.
  const [draft, setDraft] = useState<AddressValues>({ name: '', email: '' });

  if (requested) {
    return (
      <CodeStep
        requested={requested}
        onChangeEmail={() => {
          setDraft({
            email: requested.request.email,
            name: requested.request.purpose === 'register' ? requested.request.name : '',
          });
          setRequested(null);
        }}
      />
    );
  }

  return <AddressStep purpose={purpose} defaults={draft} onSent={setRequested} />;
}

function AddressStep({
  purpose,
  defaults,
  onSent,
}: {
  purpose: LoginCodePurpose;
  defaults: AddressValues;
  onSent: (requested: CodeRequested) => void;
}) {
  const requestCode = useRequestLoginCode();
  const isSignUp = purpose === 'register';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddressValues>({
    resolver: zodResolver(isSignUp ? registerAddress : loginAddress),
    defaultValues: defaults,
    // As on the old password form: check a field once it has been left, then
    // live, rather than shouting at someone mid-word.
    mode: isSignUp ? 'onTouched' : 'onSubmit',
  });

  return (
    <>
      <FormError error={requestCode.error} />

      <form
        noValidate
        onSubmit={handleSubmit((values) => {
          const request: RequestLoginCodeInput = isSignUp
            ? { purpose, email: values.email, name: values.name ?? '' }
            : { purpose, email: values.email };
          requestCode.mutate(request, { onSuccess: (sent) => onSent({ request, sent }) });
        })}
        className="space-y-4"
      >
        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p id="name-error" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : 'email-hint'}
            {...register('email')}
          />
          {errors.email ? (
            <p id="email-error" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          ) : (
            <p id="email-hint" className="text-xs text-muted-foreground">
              We&apos;ll email you a 6-digit code. No password needed.
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={requestCode.isPending}>
          {requestCode.isPending && <Spinner label="Sending the code" />}
          Email me a code
        </Button>
      </form>
    </>
  );
}

const codeForm = z.object({ code: loginCodeSchema });

function CodeStep({
  requested,
  onChangeEmail,
}: {
  requested: CodeRequested;
  onChangeEmail: () => void;
}) {
  const { request, sent } = requested;
  const verify = useVerifyLoginCode();
  const resend = useRequestLoginCode();

  // When another code may be asked for. The server enforces it; this only keeps
  // the button from offering what would be refused.
  const [resendAt, setResendAt] = useState(() => Date.now() + sent.resendAfterSec * 1000);
  const waitSeconds = useSecondsUntil(resendAt);
  const [resent, setResent] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors },
  } = useForm<{ code: string }>({
    resolver: zodResolver(codeForm),
    defaultValues: { code: '' },
  });

  // They have just been told to look at their email; the next thing they do is
  // type into this field.
  useEffect(() => setFocus('code'), [setFocus]);

  const minutes = Math.max(1, Math.round(sent.expiresInSec / 60));
  const describedBy = errors.code ? 'code-error' : 'code-help';

  return (
    <div className="space-y-4">
      <p id="code-help" className="text-sm text-muted-foreground">
        We emailed a 6-digit code to{' '}
        <span className="break-all font-medium text-foreground">{request.email}</span>. It works for{' '}
        {minutes} minutes. If it does not arrive, check your spam folder.
      </p>

      <FormError error={verify.error ?? resend.error} />

      <form
        noValidate
        onSubmit={handleSubmit(({ code }) => verify.mutate({ email: request.email, code }))}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="text-center font-mono text-lg tracking-[0.4em]"
            aria-invalid={Boolean(errors.code)}
            aria-describedby={describedBy}
            {...register('code')}
          />
          {errors.code && (
            <p id="code-error" className="text-sm text-destructive">
              {errors.code.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={verify.isPending}>
          {verify.isPending && <Spinner label="Checking the code" />}
          Verify and continue
        </Button>
      </form>

      {/* Announced when a new code goes out; the region exists before it has
          anything to say, which is what makes a screen reader read it. */}
      <div role="status">
        {resent && <p className="text-sm text-muted-foreground">A new code is on its way.</p>}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="px-0"
          disabled={waitSeconds > 0 || resend.isPending}
          onClick={() =>
            resend.mutate(request, {
              onSuccess: (next) => {
                setResendAt(Date.now() + next.resendAfterSec * 1000);
                setResent(true);
                // The old code is gone, so a half-typed one and its error go too.
                verify.reset();
                reset();
                setFocus('code');
              },
            })
          }
        >
          {resend.isPending && <Spinner label="Sending a new code" />}
          {waitSeconds > 0 ? `Resend code in ${waitSeconds}s` : 'Resend code'}
        </Button>

        <Button type="button" variant="link" size="sm" className="px-0" onClick={onChangeEmail}>
          Use a different email
        </Button>
      </div>
    </div>
  );
}
