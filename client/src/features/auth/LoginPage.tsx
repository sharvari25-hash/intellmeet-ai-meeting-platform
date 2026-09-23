import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from './AuthShell';
import { FormError } from './FormError';
import { useDemoLogin, useLogin } from './useAuth';

export function LoginPage() {
  const login = useLogin();
  const demo = useDemoLogin();

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
