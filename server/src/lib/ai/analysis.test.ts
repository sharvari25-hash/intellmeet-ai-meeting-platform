import { describe, expect, it, vi } from 'vitest';
import {
  analyzeWithLlm,
  buildSystemPrompt,
  extractJson,
  formatTranscript,
  MAX_TRANSCRIPT_CHARS,
  parseAnalysis,
} from './analysis.js';
import { AnalysisFormatError, type AnalysisInput, type CompleteFn } from './types.js';

const INPUT: AnalysisInput = {
  title: 'Sprint planning',
  participantNames: ['Ada Lovelace', 'Grace Hopper'],
  meetingDate: new Date('2026-09-14T09:30:00Z'),
  segments: [
    { start: 0, end: 4, text: 'We agreed to ship on Friday.', speaker: 'Ada Lovelace' },
    { start: 65, end: 70, text: "I'll write the notes.", speaker: 'Grace Hopper' },
  ],
};

const VALID = {
  summary: 'The team agreed to ship on Friday.',
  keyDecisions: ['Ship on Friday'],
  actionItems: [{ text: 'Write the notes', assigneeName: 'Grace Hopper', dueDate: null }],
};

/** A chat model that answers with each scripted reply in turn. */
function scripted(...replies: string[]): CompleteFn & ReturnType<typeof vi.fn> {
  const complete = vi.fn();
  for (const reply of replies) complete.mockResolvedValueOnce(reply);
  return complete as unknown as CompleteFn & ReturnType<typeof vi.fn>;
}

describe('prompt', () => {
  it('states the meeting date, so "Friday" can become a real date', () => {
    const prompt = buildSystemPrompt(INPUT);

    expect(prompt).toContain('Monday 2026-09-14');
    expect(prompt).toContain('YYYY-MM-DD');
  });

  it('lists the participants the owner must be chosen from', () => {
    expect(buildSystemPrompt(INPUT)).toContain('Ada Lovelace, Grace Hopper');
  });

  it('renders the transcript with timestamps and speakers', () => {
    expect(formatTranscript(INPUT.segments)).toBe(
      "[00:00] Ada Lovelace: We agreed to ship on Friday.\n[01:05] Grace Hopper: I'll write the notes.",
    );
  });

  it('keeps the start and end of an overlong transcript', () => {
    const long = Array.from({ length: 4000 }, (_, index) => ({
      start: index,
      end: index + 1,
      text: `sentence number ${index} of a very long meeting`,
      speaker: null,
    }));

    const rendered = formatTranscript(long);

    expect(rendered.length).toBeLessThan(MAX_TRANSCRIPT_CHARS + 100);
    expect(rendered).toContain('sentence number 0 ');
    expect(rendered).toContain('sentence number 3999 ');
    expect(rendered).toContain('middle of the meeting omitted');
  });
});

describe('parseAnalysis', () => {
  it('accepts a bare JSON object', () => {
    expect(parseAnalysis(JSON.stringify(VALID))).toEqual({ ok: true, value: VALID });
  });

  it('unwraps a markdown fence and surrounding chatter', () => {
    const reply = `Here is the analysis:\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``;

    expect(parseAnalysis(reply).ok).toBe(true);
  });

  it('treats an empty owner or date as null rather than failing', () => {
    const reply = JSON.stringify({
      ...VALID,
      actionItems: [{ text: 'Write the notes', assigneeName: '', dueDate: ' ' }],
    });

    const outcome = parseAnalysis(reply);
    expect(outcome.ok && outcome.value.actionItems[0]).toEqual({
      text: 'Write the notes',
      assigneeName: null,
      dueDate: null,
    });
  });

  it('rejects a weekday where a date belongs, and says where', () => {
    const reply = JSON.stringify({
      ...VALID,
      actionItems: [{ text: 'Write the notes', assigneeName: null, dueDate: 'Friday' }],
    });

    const outcome = parseAnalysis(reply);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.problem).toContain('actionItems.0.dueDate');
  });

  it('rejects a reply with a field missing', () => {
    const outcome = parseAnalysis(JSON.stringify({ summary: 'x', actionItems: [] }));
    expect(!outcome.ok && outcome.problem).toContain('keyDecisions');
  });

  it('reports text that is not JSON at all', () => {
    expect(() => extractJson('I could not find any decisions.')).toThrow(SyntaxError);
    expect(parseAnalysis('{"summary": "unterminated').ok).toBe(false);
  });
});

describe('analyzeWithLlm', () => {
  it('returns the first reply when it is valid, in one call', async () => {
    const complete = scripted(JSON.stringify(VALID));

    await expect(analyzeWithLlm(complete, INPUT)).resolves.toEqual(VALID);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('repairs an invalid reply once, showing the model its mistake', async () => {
    const broken = JSON.stringify({
      ...VALID,
      actionItems: [{ text: 'Notes', assigneeName: null, dueDate: 'Friday' }],
    });
    const complete = scripted(broken, JSON.stringify(VALID));

    await expect(analyzeWithLlm(complete, INPUT)).resolves.toEqual(VALID);
    expect(complete).toHaveBeenCalledTimes(2);

    // The repair turn replays the conversation: the original request, the
    // model's own bad reply, and a precise description of what was wrong.
    const repair = complete.mock.calls[1]?.[0] as Parameters<CompleteFn>[0];
    expect(repair.messages).toHaveLength(3);
    expect(repair.messages[1]).toEqual({ role: 'assistant', content: broken });
    expect(repair.messages[2]?.content).toContain('dueDate');
  });

  it('gives up after one repair rather than looping', async () => {
    const complete = scripted('not json', 'still not json', JSON.stringify(VALID));

    await expect(analyzeWithLlm(complete, INPUT)).rejects.toBeInstanceOf(AnalysisFormatError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('lets a transport failure through untouched, for the queue to retry', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('socket hang up'));

    await expect(analyzeWithLlm(complete, INPUT)).rejects.toThrow('socket hang up');
  });
});
