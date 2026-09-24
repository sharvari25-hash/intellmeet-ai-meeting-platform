import { vi } from 'vitest';
import type {
  BoardDetail,
  CreateTaskInput,
  MoveTaskInput,
  MyTask,
  Task,
  TaskComment,
  Team,
  TeamRole,
  UpdateTaskInput,
} from '@intellmeet/shared';
import { authPayload } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';

/**
 * A team board and a fake API that serves it, for the task page's tests.
 * Test-only; never imported by the app.
 */

export const SELF_ID = authPayload().user.id;
export const GRACE_ID = '507f1f77bcf86cd799439014';
export const PERSONA_ID = '507f1f77bcf86cd799439015';
export const TEAM_ID = '507f1f77bcf86cd799439012';
export const BOARD_ID = '6500000000000000000000b1';
export const COLUMNS = {
  todo: '6500000000000000000000c1',
  doing: '6500000000000000000000c2',
  review: '6500000000000000000000c3',
  done: '6500000000000000000000c4',
};

let sequence = 0;
const nextId = () => `65000000000000000000${String(++sequence).padStart(4, '0')}`;

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: nextId(),
    boardId: BOARD_ID,
    teamId: TEAM_ID,
    columnId: COLUMNS.todo,
    title: 'Write the release notes',
    description: '',
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    priority: 'medium',
    order: 1024,
    source: null,
    createdBy: SELF_ID,
    createdByName: 'Ada Lovelace',
    seeded: false,
    commentCount: 0,
    version: 1,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

export function team(role: TeamRole): Team {
  return {
    id: TEAM_ID,
    name: 'IntellMeet Demo Team',
    slug: 'intellmeet-demo',
    ownerId: PERSONA_ID,
    members: [
      member(SELF_ID, 'Ada Lovelace', role),
      member(GRACE_ID, 'Grace Hopper', 'member'),
      member(PERSONA_ID, 'Demo User', 'admin'),
    ],
    myRole: role,
    createdAt: '2026-09-01T10:00:00.000Z',
  };
}

function member(userId: string, name: string, role: TeamRole) {
  return { userId, name, email: `${userId}@example.com`, avatarUrl: null, role, joinedAt: '' };
}

export function board(tasks: Task[], role: TeamRole = 'member'): BoardDetail {
  return {
    board: {
      id: BOARD_ID,
      teamId: TEAM_ID,
      teamName: 'IntellMeet Demo Team',
      name: 'Product board',
      isDefault: true,
      seeded: true,
      myRole: role,
      createdAt: '2026-09-01T10:00:00.000Z',
      columns: [
        { id: COLUMNS.todo, title: 'To Do', isDone: false },
        { id: COLUMNS.doing, title: 'In Progress', isDone: false },
        { id: COLUMNS.review, title: 'Review', isDone: false },
        { id: COLUMNS.done, title: 'Done', isDone: true },
      ],
    },
    tasks,
  };
}

/**
 * Signs in as Ada and serves the board through a stubbed `fetch`, applying
 * writes the way the server would so the page re-renders with the result.
 */
export function serveBoard(options: { tasks: Task[]; role?: TeamRole; mine?: MyTask[] }) {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: 't',
  });

  const role = options.role ?? 'member';
  let current = board(options.tasks, role);
  const comments: TaskComment[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

    if (path === '/teams') return Response.json({ teams: [team(role)] });
    if (path === `/teams/${TEAM_ID}`) return Response.json({ team: team(role) });
    if (path.startsWith('/boards?')) {
      return Response.json({
        boards: [{ id: BOARD_ID, teamId: TEAM_ID, name: 'Product board', isDefault: true }],
      });
    }
    if (path === `/boards/${BOARD_ID}`) return Response.json(current);
    if (path === '/tasks/mine') return Response.json({ tasks: options.mine ?? [] });

    if (path === `/boards/${BOARD_ID}/tasks` && method === 'POST') {
      const input = body as CreateTaskInput;
      const created = task({
        title: input.title,
        columnId: input.columnId ?? COLUMNS.todo,
        order: 9999,
      });
      current = { ...current, tasks: [...current.tasks, created] };
      return Response.json({ task: created }, { status: 201 });
    }

    const taskMatch = /^\/tasks\/([0-9a-f]{24})(\/move|\/comments)?$/.exec(path);
    if (taskMatch) {
      const [, id, action] = taskMatch;
      const existing = current.tasks.find((entry) => entry.id === id);
      if (!existing) return Response.json({}, { status: 404 });

      if (action === '/comments') {
        if (method === 'GET') return Response.json({ comments });
        const comment: TaskComment = {
          id: nextId(),
          taskId: existing.id,
          authorId: SELF_ID,
          authorName: 'Ada Lovelace',
          authorAvatarUrl: null,
          text: (body as { text: string }).text,
          createdAt: '2026-09-24T10:00:00.000Z',
        };
        comments.push(comment);
        return Response.json({ comment, commentCount: comments.length }, { status: 201 });
      }

      if (action === '/move') {
        const input = body as MoveTaskInput;
        const moved = {
          ...existing,
          columnId: input.columnId,
          order: 5000,
          version: existing.version + 1,
        };
        current = { ...current, tasks: current.tasks.map((t) => (t.id === id ? moved : t)) };
        return Response.json({ boardId: BOARD_ID, task: moved, reordered: [] });
      }

      if (method === 'PATCH') {
        const input = body as UpdateTaskInput;
        const updated = { ...existing, ...input, version: existing.version + 1 } as Task;
        current = { ...current, tasks: current.tasks.map((t) => (t.id === id ? updated : t)) };
        return Response.json({ task: updated });
      }

      if (method === 'DELETE') {
        current = { ...current, tasks: current.tasks.filter((t) => t.id !== id) };
        return new Response(null, { status: 204 });
      }
    }

    return Response.json(
      { error: { code: 'NOT_FOUND', message: `No fake for ${method} ${path}` } },
      { status: 404 },
    );
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The body of the last request to `path` with `method`, parsed. */
export function lastBody<T>(
  fetchMock: ReturnType<typeof serveBoard>,
  method: string,
  path: string,
): T {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([url, init]) => String(url).endsWith(path) && (init?.method ?? 'GET') === method);
  if (!call) throw new Error(`No ${method} ${path} was made`);
  return JSON.parse(String(call[1]?.body)) as T;
}
