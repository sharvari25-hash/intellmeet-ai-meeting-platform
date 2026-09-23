import { describe, expect, it } from 'vitest';
import { evaluateAnalysis, pairItems, sameAssignee, similarity } from './evaluate.js';

describe('similarity', () => {
  it('is 1 for the same words in any order and 0 for none shared', () => {
    expect(similarity('ship the release on Friday', 'Friday: ship release')).toBe(1);
    expect(similarity('ship the release', 'book a room')).toBe(0);
  });
});

describe('pairItems', () => {
  it('pairs each item at most once, best match first', () => {
    const { pairs, missed, extra } = pairItems(
      ['Fix the upload retry bug', 'Order pizza'],
      ['Fix the recording upload retry bug', 'Write the onboarding checklist'],
      { produced: (text) => text, reference: (text) => text },
    );

    expect(pairs.map((pair) => pair.reference)).toEqual(['Fix the recording upload retry bug']);
    expect(missed).toEqual(['Write the onboarding checklist']);
    expect(extra).toEqual(['Order pizza']);
  });
});

describe('sameAssignee', () => {
  it('accepts a first name for the full name, and null for null', () => {
    expect(sameAssignee('Grace', 'Grace Hopper')).toBe(true);
    expect(sameAssignee(null, null)).toBe(true);
    expect(sameAssignee('Ada Lovelace', 'Grace Hopper')).toBe(false);
    expect(sameAssignee(null, 'Grace Hopper')).toBe(false);
  });
});

describe('evaluateAnalysis', () => {
  it('counts an item fully correct only with the right owner and deadline', () => {
    const reference = {
      summary: 'The team planned the sprint.',
      keyDecisions: ['Freeze scope on Wednesday'],
      actionItems: [
        { text: 'Fix the upload retry bug', assigneeName: 'Grace Hopper', dueDate: '2026-09-18' },
        { text: 'Write the calendar spike', assigneeName: 'Ada Lovelace', dueDate: '2026-09-16' },
      ],
    };

    const produced = {
      summary: 'The team planned the sprint and froze scope.',
      keyDecisions: ['Scope is frozen on Wednesday'],
      actionItems: [
        { text: 'Fix upload retry bug', assigneeName: 'Grace', dueDate: '2026-09-18' },
        { text: 'Write a spike for the calendar', assigneeName: 'Ada Lovelace', dueDate: null },
      ],
    };

    const { score } = evaluateAnalysis(produced, reference);

    expect(score.decisions).toEqual({ matched: 1, produced: 1, reference: 1 });
    expect(score.actionItems.matched).toBe(2);
    expect(score.assigneeCorrect).toBe(2);
    expect(score.dueDateCorrect).toBe(1);
    expect(score.fullyCorrect).toBe(1);
  });
});
