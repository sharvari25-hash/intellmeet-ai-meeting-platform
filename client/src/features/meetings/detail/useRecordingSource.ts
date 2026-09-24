import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Meeting } from '@intellmeet/shared';
import { aiKeys, fetchRecordingAudio } from '../ai.api';

export type RecordingSource =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; src: string };

/**
 * Something an `<audio>` element can play for this meeting's recording.
 *
 * A Cloudinary recording is a public HTTPS URL and plays (and seeks, with
 * Range requests) directly. A recording kept on our own API needs the bearer
 * token, which an `<audio src>` cannot send, so it is fetched once and played
 * from an object URL - revoked when the page no longer needs it, or the blob
 * would stay in memory until the tab closed.
 *
 * `enabled` defers the download until a tab that plays audio is opened.
 */
export function useRecordingSource(meeting: Meeting, enabled: boolean): RecordingSource {
  const url = meeting.recording?.url ?? null;
  const direct = url?.startsWith('https://') ? url : null;
  const needsFetch = Boolean(url) && !direct;

  const blob = useQuery({
    queryKey: aiKeys.recording(meeting.id),
    queryFn: () => fetchRecordingAudio(meeting.id),
    enabled: enabled && needsFetch,
    // The file never changes under the same meeting: a new recording gets a
    // new meeting DTO, which gets a new URL.
    staleTime: Infinity,
    retry: false,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob.data) return;
    const created = URL.createObjectURL(blob.data);
    setObjectUrl(created);
    return () => {
      URL.revokeObjectURL(created);
      setObjectUrl(null);
    };
  }, [blob.data]);

  if (!url) return { status: 'none' };
  if (direct) return { status: 'ready', src: direct };
  if (blob.isError) return { status: 'error', error: blob.error };
  if (objectUrl) return { status: 'ready', src: objectUrl };
  return { status: 'loading' };
}
