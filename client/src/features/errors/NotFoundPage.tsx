import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-bold tracking-tight text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That link does not point anywhere in IntellMeet. It may have been moved, or the meeting it
        referred to has ended.
      </p>
      <Button asChild>
        <Link to="/">Back to the home page</Link>
      </Button>
    </main>
  );
}
