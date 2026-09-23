import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HealthCard } from '@/features/health/components/HealthCard';
import { ApiError } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore, type Theme } from '@/stores/themeStore';
import { updateMe } from './users.api';

/**
 * Just the name.
 *
 * `updateMeSchema` allows a name, an avatar URL, or both, and refuses an empty
 * object - which makes it awkward as a form resolver, because a form always
 * submits every field it renders. Narrowing to the one field this form owns
 * keeps the validation honest; the server still applies the full schema.
 */
const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
});
type ProfileInput = z.infer<typeof profileSchema>;

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ProfileCard() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user?.name ?? '' },
  });

  const save = useMutation({
    mutationFn: (values: ProfileInput) => updateMe(values),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success('Profile updated');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save your profile'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>The name your team-mates see in meetings and chat.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'display-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p id="display-name-error" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            {/* Changing an email means re-verifying it, which is a flow of its
                own rather than a field on this form. */}
            <Input id="email" readOnly disabled value={user?.email ?? ''} />
            <p className="text-xs text-muted-foreground">Email changes are not supported yet.</p>
          </div>

          <Button type="submit" disabled={save.isPending || !isDirty}>
            {save.isPending && <Spinner label="Saving your profile" />}
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          System follows your operating system, including its day/night schedule.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A radio group rather than buttons: the three options are mutually
            exclusive, and this is the role that tells a screen reader so. */}
        <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
          {THEMES.map((option) => (
            <Button
              key={option.value}
              role="radio"
              aria-checked={theme === option.value}
              variant={theme === option.value ? 'default' : 'outline'}
              onClick={() => setTheme(option.value)}
            >
              <option.icon aria-hidden="true" />
              {option.label}
              {theme === option.value && <Check aria-hidden="true" />}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, how the app looks, and whether the backend is healthy.
        </p>
      </header>

      <ProfileCard />
      <AppearanceCard />

      <section aria-labelledby="system-status">
        <h2 id="system-status" className="mb-3 text-lg font-semibold tracking-tight">
          System status
        </h2>
        <HealthCard />
      </section>
    </div>
  );
}
