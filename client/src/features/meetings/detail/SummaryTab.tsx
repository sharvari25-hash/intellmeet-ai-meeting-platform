import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Scale, Sparkles, X } from 'lucide-react';
import type { Meeting, MeetingInsight } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/features/auth/FormError';
import { useUpdateInsight } from '../useUpdateInsight';
import { EditedNote, HostOnlyNote } from './notes';

/** Summary and key decisions, read-only for everyone and editable by the host. */
export function SummaryTab({ meeting, insight }: { meeting: Meeting; insight: MeetingInsight }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <SummaryForm meeting={meeting} insight={insight} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="summary-heading" className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="summary-heading" className="flex items-center gap-2 font-semibold">
            <Sparkles aria-hidden="true" className="size-4 text-primary" />
            Summary
          </h2>
          {meeting.isHost && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit summary
            </Button>
          )}
        </div>
        {/* The host's paragraphs are kept; `whitespace-pre-line` shows them. */}
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{insight.summary}</p>
      </section>

      <section aria-labelledby="decisions-heading" className="rounded-xl border bg-card p-5">
        <h2 id="decisions-heading" className="flex items-center gap-2 font-semibold">
          <Scale aria-hidden="true" className="size-4 text-primary" />
          Key decisions
        </h2>
        {insight.keyDecisions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No decisions were recorded.</p>
        ) : (
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {insight.keyDecisions.map((decision, index) => (
              <li key={`${index}-${decision}`}>{decision}</li>
            ))}
          </ul>
        )}
      </section>

      <EditedNote insight={insight} />
      {!meeting.isHost && <HostOnlyNote hostName={meeting.hostName} />}
    </div>
  );
}

/**
 * The form's own schema, shaped for the inputs: decisions are objects because
 * a field array needs something to hang a key on. Same limits as the API's
 * `updateInsightSchema`; a blank decision row is allowed here and dropped on
 * submit, since emptying a row is how people delete one.
 */
const summaryFormSchema = z.object({
  summary: z.string().trim().min(1, 'The summary cannot be empty').max(5000),
  decisions: z.array(z.object({ text: z.string().max(500) })).max(50),
});
type SummaryFormValues = z.infer<typeof summaryFormSchema>;

function SummaryForm({
  meeting,
  insight,
  onDone,
}: {
  meeting: Meeting;
  insight: MeetingInsight;
  onDone: () => void;
}) {
  const save = useUpdateInsight(meeting.id);
  const form = useForm<SummaryFormValues>({
    resolver: zodResolver(summaryFormSchema),
    defaultValues: {
      summary: insight.summary,
      decisions: insight.keyDecisions.map((text) => ({ text })),
    },
  });
  const decisions = useFieldArray({ control: form.control, name: 'decisions' });
  const summaryError = form.formState.errors.summary?.message;

  const onSubmit = form.handleSubmit((values) => {
    save.mutate(
      {
        summary: values.summary.trim(),
        // An emptied row means "remove this decision", not "save a blank".
        keyDecisions: values.decisions.map((d) => d.text.trim()).filter(Boolean),
      },
      { onSuccess: onDone },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="edit-summary-heading"
      className="space-y-5 rounded-xl border bg-card p-5"
      noValidate
    >
      <h2 id="edit-summary-heading" className="font-semibold">
        Edit the summary
      </h2>

      <div className="space-y-2">
        <Label htmlFor="summary-text">Summary</Label>
        <Textarea
          id="summary-text"
          rows={6}
          aria-invalid={summaryError ? true : undefined}
          aria-describedby={summaryError ? 'summary-text-error' : undefined}
          {...form.register('summary')}
        />
        {summaryError && (
          <p id="summary-text-error" className="text-sm text-destructive">
            {summaryError}
          </p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Key decisions</legend>
        {decisions.fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2">
            <Label htmlFor={`decision-${index}`} className="sr-only">
              Decision {index + 1}
            </Label>
            <Input
              id={`decision-${index}`}
              maxLength={500}
              {...form.register(`decisions.${index}.text`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove decision ${index + 1}`}
              onClick={() => decisions.remove(index)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => decisions.append({ text: '' }, { shouldFocus: true })}
        >
          <Plus aria-hidden="true" />
          Add a decision
        </Button>
      </fieldset>

      <FormError error={save.error} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner label="Saving" />}
          Save changes
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
