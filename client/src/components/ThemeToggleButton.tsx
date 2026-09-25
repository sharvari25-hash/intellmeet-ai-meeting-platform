import type { ComponentProps } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Theme } from '@/stores/themeStore';

/**
 * The button that opens the theme menu: a sun, or a moon in dark mode.
 *
 * A module of its own, apart from the menu (`ThemeToggle`), so the landing
 * page can show exactly this button without importing the dropdown behind it.
 */
export function ThemeToggleButton({
  theme,
  ...props
}: { theme: Theme } & ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="icon" aria-label={`Theme: ${theme}. Change theme`} {...props}>
      <Sun aria-hidden="true" className="size-4 dark:hidden" />
      <Moon aria-hidden="true" className="hidden size-4 dark:block" />
    </Button>
  );
}
