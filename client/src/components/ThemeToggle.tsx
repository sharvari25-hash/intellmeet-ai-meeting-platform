import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { ThemeToggleButton } from '@/components/ThemeToggleButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useThemeStore, type Theme } from '@/stores/themeStore';

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Light / dark / system switcher.
 *
 * "System" is a real third option rather than a default, because a user whose
 * OS switches to dark at sunset expects the app to follow - and a two-state
 * toggle silently overrides that the first time it is pressed.
 *
 * `defaultOpen` is for the landing page, which shows the bare button until
 * somebody presses it and only then loads this menu - already open, because
 * the press that loaded it was the press that meant "open".
 */
export function ThemeToggle({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ThemeToggleButton theme={theme} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon aria-hidden="true" />
            {label}
            {theme === value && <Check aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
