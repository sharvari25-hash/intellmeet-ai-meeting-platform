import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useThemeStore } from '@/stores/themeStore';

/**
 * App-wide toast host.
 *
 * shadcn's version of this file reads the theme from `next-themes`; this app
 * is not a Next.js app, so it reads the same preference from the theme store
 * instead and drops the dependency.
 */
function Toaster(props: ToasterProps) {
  const theme = useThemeStore((state) => state.theme);

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      // Toasts announce transient results (saved, copied, failed). A polite
      // live region means a screen reader hears them without losing its place.
      richColors
      closeButton
      {...props}
    />
  );
}

export { Toaster };
