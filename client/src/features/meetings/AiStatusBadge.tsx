import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import type { AiStatus } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { AI_STATUS_LABEL } from './aiStatus';

/**
 * The AI pipeline's state as a compact badge. Renders nothing for `none`, so
 * a list of meetings is not a wall of "No recording".
 */
export function AiStatusBadge({ status }: { status: AiStatus }) {
  if (status === 'none') return null;

  if (status === 'done') {
    return (
      <Badge variant="secondary">
        <Sparkles aria-hidden="true" />
        {AI_STATUS_LABEL.done}
      </Badge>
    );
  }

  if (status === 'failed') {
    return (
      <Badge variant="destructive">
        <AlertCircle aria-hidden="true" />
        {AI_STATUS_LABEL.failed}
      </Badge>
    );
  }

  return (
    <Badge variant="outline">
      <Loader2 aria-hidden="true" className="animate-spin" />
      {AI_STATUS_LABEL[status]}
    </Badge>
  );
}
