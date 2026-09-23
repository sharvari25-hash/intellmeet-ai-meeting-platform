import { useEffect, useRef } from 'react';
import { Mic } from 'lucide-react';
import { createLevelMeter } from '@/lib/webrtc/audioLevel';

/**
 * Live microphone level.
 *
 * The bar is driven by writing to `style.transform` on every animation frame
 * rather than through React state. At 60fps a `setState` per frame would
 * re-render the whole lobby sixty times a second to move one bar, and on a
 * phone that is the difference between a smooth preview and a stuttering one.
 */
export function MicMeter({ stream, enabled }: { stream: MediaStream | null; enabled: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stream || !enabled) {
      if (barRef.current) barRef.current.style.transform = 'scaleX(0)';
      return;
    }

    const meter = createLevelMeter(stream);
    let frame = 0;

    const tick = () => {
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${meter.read().toFixed(3)})`;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      meter.stop();
    };
  }, [stream, enabled]);

  return (
    <div className="flex items-center gap-2">
      <Mic aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        // A moving bar is decoration here: the useful state (muted or not) is
        // already on the toggle button, so announcing every level change would
        // be noise.
        aria-hidden="true"
      >
        <div
          ref={barRef}
          className="h-full origin-left rounded-full bg-[var(--success)] transition-transform duration-75"
          style={{ transform: 'scaleX(0)' }}
        />
      </div>
    </div>
  );
}
