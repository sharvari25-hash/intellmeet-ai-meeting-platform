import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  KanbanSquare,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Video,
} from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { FormError } from '@/features/auth/FormError';
import { useDemoLogin } from '@/features/auth/useAuth';

/**
 * How the product is actually used, in four steps.
 *
 * Deliberately short. This page is the first thing a reviewer sees, and a wall
 * of marketing copy is the fastest way to lose them before they ever press the
 * demo button.
 */
const STEPS = [
  {
    title: 'Start a meeting',
    body: 'Create a room in one click and share the link, or join with a 7-character code.',
  },
  {
    title: 'Meet as usual',
    body: 'Video, screen share, live chat and a participant list - all in the browser.',
  },
  {
    title: 'Get the write-up',
    body: 'AI turns the recording into a transcript, a summary and the decisions you made.',
  },
  {
    title: 'Track the follow-ups',
    body: 'Action items land on your team board with the right person already assigned.',
  },
];

const FEATURES = [
  {
    icon: Video,
    title: 'Peer-to-peer video',
    body: 'WebRTC mesh with screen sharing. Media flows between browsers, not through our servers.',
  },
  {
    icon: MessageSquareText,
    title: 'Real-time everything',
    body: 'Chat, presence, typing indicators and notifications over a single socket.',
  },
  {
    icon: ListChecks,
    title: 'Automatic minutes',
    body: 'Transcript, summary and key decisions, generated the moment a meeting ends.',
  },
  {
    icon: KanbanSquare,
    title: 'Action items that stick',
    body: 'Every task from every meeting on one board, synced live across the team.',
  },
];

const SAMPLE_ACTIONS = [
  { who: 'Ada', what: 'Enable the onboarding flag for 10% of traffic' },
  { who: 'Grace', what: 'Draft the billing migration plan' },
  { who: 'Alan', what: 'Re-run the pricing model with Q3 numbers' },
];

function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-sm text-primary-foreground"
      >
        IM
      </span>
      IntellMeet
    </span>
  );
}

/**
 * A static preview of what the product produces.
 *
 * Built from live DOM rather than a screenshot: it stays sharp on any display,
 * restyles itself with the theme, and adds nothing to the download. Hidden
 * from assistive technology because it is decoration - the copy beside it
 * already says what the product does.
 */
function SummaryPreview() {
  return (
    <div
      aria-hidden="true"
      className="w-full rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5"
    >
      <div className="flex items-center gap-2 border-b pb-3">
        <span className="size-2 rounded-full bg-destructive/70" />
        <span className="size-2 rounded-full bg-[var(--success)]/70" />
        <span className="size-2 rounded-full bg-muted-foreground/40" />
        <span className="ml-2 truncate text-xs text-muted-foreground">
          Product sync - 24 min - 5 participants
        </span>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="size-3.5" />
        AI summary
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        The team agreed to ship the onboarding rewrite behind a flag this week, and to hold the
        pricing change until the billing migration lands.
      </p>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Action items
      </p>
      <ul className="mt-2 space-y-2">
        {SAMPLE_ACTIONS.map((action) => (
          <li key={action.what} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
            <span className="min-w-0">
              <span className="font-medium">{action.who}</span>
              <span className="text-muted-foreground"> - {action.what}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingPage() {
  const demo = useDemoLogin();

  return (
    <div className="flex min-h-dvh flex-col">
      {/* First tabbable element on the page, so a keyboard user can jump the
          header instead of tabbing through it on arrival. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Wordmark />
          <nav aria-label="Account" className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/register">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* --- Hero ------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
                Meetings that write themselves up
              </p>

              {/* The type scale starts small enough that the longest word still
                  fits a 360px viewport without breaking mid-word. */}
              <h1 className="mt-5 text-balance text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                Run the meeting. Let IntellMeet handle the minutes.
              </h1>

              <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Browser-based video meetings for teams, with live chat and screen sharing. When the
                call ends you get a transcript, a summary, the decisions, and the action items -
                already assigned.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  disabled={demo.isPending}
                  onClick={() => demo.mutate()}
                >
                  {demo.isPending && <Spinner label="Opening the demo workspace" />}
                  Try Live Demo
                  <ArrowRight aria-hidden="true" />
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                  <Link to="/register">Create a free account</Link>
                </Button>
              </div>

              <div className="mt-3">
                <FormError error={demo.error} />
              </div>

              <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                No sign-up needed. The demo drops you straight into a shared workspace with a team
                and sample meetings already in it.
              </p>
            </div>

            <SummaryPreview />
          </div>
        </section>

        {/* --- How it works ----------------------------------------------- */}
        <section aria-labelledby="how-it-works" className="border-y bg-card/40 py-14 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Four steps, start to finish. Nothing to install.
            </p>

            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-xl border bg-background p-5">
                  <span
                    aria-hidden="true"
                    className="grid size-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-3 font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --- Features ---------------------------------------------------- */}
        <section aria-labelledby="features" className="py-14 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 id="features" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              What is inside
            </h2>

            <ul className="mt-8 grid gap-6 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex gap-4 rounded-xl border bg-card p-5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
                  >
                    <feature.icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {feature.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* --- Closing call to action -------------------------------------- */}
        <section aria-labelledby="cta" className="border-t bg-card/40 py-14 sm:py-16">
          <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
            <h2 id="cta" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              See it for yourself
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              The demo workspace is live, seeded and shared. Open it in two browser windows to watch
              the real-time side work.
            </p>
            <Button
              size="lg"
              className="mt-7 w-full sm:w-auto"
              disabled={demo.isPending}
              onClick={() => demo.mutate()}
            >
              {demo.isPending && <Spinner label="Opening the demo workspace" />}
              Try Live Demo
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <Wordmark />
          <p className="sm:ml-auto">AI-powered meetings for teams.</p>
        </div>
      </footer>
    </div>
  );
}
