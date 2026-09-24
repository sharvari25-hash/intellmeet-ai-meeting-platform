import { describe, expect, it } from 'vitest';
import { board, COLUMNS, task } from '@/test/boardFixtures';
import {
  applyMoved,
  groupByColumn,
  moveLocally,
  neighboursOf,
  removeTask,
  upsertTask,
} from './boardCache';
import { isOverdue } from './due';

describe('groupByColumn', () => {
  it('puts each task in its column, in order', () => {
    const a = task({ title: 'A', order: 2048 });
    const b = task({ title: 'B', order: 1024 });
    const c = task({ title: 'C', columnId: COLUMNS.done });

    const groups = groupByColumn(board([a, b, c]));

    expect(groups.get(COLUMNS.todo)?.map((t) => t.title)).toEqual(['B', 'A']);
    expect(groups.get(COLUMNS.done)?.map((t) => t.title)).toEqual(['C']);
    expect(groups.get(COLUMNS.review)).toEqual([]);
  });

  it('shows a task whose column was just removed in the first column, not nowhere', () => {
    const orphan = task({ title: 'Orphan', columnId: '6500000000000000000000ff' });
    expect(
      groupByColumn(board([orphan]))
        .get(COLUMNS.todo)
        ?.map((t) => t.title),
    ).toEqual(['Orphan']);
  });
});

describe('real-time updates', () => {
  it('replace a task with a newer copy, add an unknown one, and ignore an older copy', () => {
    const card = task({ title: 'v2', version: 2 });
    const start = board([card]);

    expect(upsertTask(start, { ...card, title: 'v3', version: 3 }).tasks[0]?.title).toBe('v3');
    // The same version (our own change echoed back) is harmless.
    expect(upsertTask(start, { ...card, version: 2 }).tasks).toHaveLength(1);
    expect(upsertTask(start, { ...card, title: 'v1', version: 1 })).toBe(start);
    expect(upsertTask(start, task({ title: 'New' })).tasks).toHaveLength(2);
  });

  it('apply a move with the tasks the server renumbered', () => {
    const a = task({ title: 'A', order: 1 });
    const b = task({ title: 'B', order: 1.0000001 });
    const moved = applyMoved(board([a, b]), {
      boardId: a.boardId,
      task: { ...a, columnId: COLUMNS.doing, version: 2 },
      reordered: [{ id: b.id, order: 1024 }],
    });

    expect(moved.tasks.find((t) => t.id === a.id)?.columnId).toBe(COLUMNS.doing);
    expect(moved.tasks.find((t) => t.id === b.id)?.order).toBe(1024);
  });

  it('remove a deleted task', () => {
    const card = task();
    expect(removeTask(board([card]), card.id).tasks).toEqual([]);
  });
});

describe('a drop', () => {
  it('is described by its neighbours', () => {
    expect(neighboursOf(['a', 'b', 'c'], 'b')).toEqual({ afterId: 'a', beforeId: 'c' });
    expect(neighboursOf(['a', 'b'], 'a')).toEqual({ afterId: null, beforeId: 'b' });
    expect(neighboursOf(['a'], 'a')).toEqual({ afterId: null, beforeId: null });
  });

  it('is shown at once, between the same neighbours the server will use', () => {
    const a = task({ title: 'A', order: 1024 });
    const b = task({ title: 'B', order: 2048 });
    const c = task({ title: 'C', order: 3072 });

    const moved = moveLocally(board([a, b, c]), {
      taskId: c.id,
      columnId: COLUMNS.todo,
      afterId: a.id,
      beforeId: b.id,
    });

    expect(
      groupByColumn(moved)
        .get(COLUMNS.todo)
        ?.map((t) => t.title),
    ).toEqual(['A', 'C', 'B']);
    // The version is the server's to set.
    expect(moved.tasks.find((t) => t.id === c.id)?.version).toBe(c.version);
  });
});

describe('isOverdue', () => {
  it('is past the due date and not done', () => {
    expect(isOverdue('2026-09-23', false, '2026-09-24')).toBe(true);
    expect(isOverdue('2026-09-24', false, '2026-09-24')).toBe(false);
    expect(isOverdue('2026-09-23', true, '2026-09-24')).toBe(false);
    expect(isOverdue(null, false, '2026-09-24')).toBe(false);
  });
});
