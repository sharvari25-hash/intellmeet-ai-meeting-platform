import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from './AuthShell';
import { EmailCodeForm } from './EmailCodeForm';
import { FormError } from './FormError';
import { useDemoLogin, useLogin } from './useAuth';

export function LoginPage() {
  const login = useLogin();
  const demo = useDemoLogin();

  // The code is the way in for an account made on this site; the password is
  // for accounts that have one (the seeded team-mates, and any made before
  // codes existed). A link, not tabs: Radix labels each tab panel with its
  // tab's text, so a "Password" tab gave the page two things labelled
  // "Password" - and made the field hard to find by label for everything that
  // looks (tests, assistive technology's form lists, Playwright).
  const [method, setMethod] = useState<'code' | 'password'>('code');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    // The exact schema the server validates against, imported from `shared`.
    // The client cannot drift from the API contract because there is only one
    // copy of it.
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const busy = login.isPending || demo.isPending;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your IntellMeet workspace."
      footer={
        <>
          No account?&nbsp;
          <Link
            to="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      {method === 'code' ? (
        <EmailCodeForm purpose="login" />
      ) : (
        <>
          <FormError error={login.error} />

          <form
            noValidate
            onSubmit={handleSubmit((values) => login.mutate(values))}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {login.isPending && <Spinner label="Signing in" />}
              Sign in
            </Button>
          </form>
        </>
      )}

      <Button
        type="button"
        variant="link"
        size="sm"
        className="mt-2 w-full"
        onClick={() => setMethod(method === 'code' ? 'password' : 'code')}
      >
        {method === 'code' ? 'Use a password instead' : 'Email me a code instead'}
      </Button>

      <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        or
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>

      <Button variant="outline" className="w-full" disabled={busy} onClick={() => demo.mutate()}>
        {demo.isPending && <Spinner label="Opening the demo" />}
        Try the live demo
      </Button>
      <FormError error={demo.error} />
    </AuthShell>
  );
}
