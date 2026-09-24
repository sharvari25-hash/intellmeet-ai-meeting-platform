import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, KanbanSquare, Plus } from 'lucide-react';
import { canManageBoards, type MyTask, type Task } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { Skeleton } from '@/components/ui/skeleton';
import { listTeams, teamKeys } from '@/features/teams/teams.api';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import { BoardView } from './BoardView';
import { MyTasksView } from './MyTasksView';
import { NameDialog } from './NameDialog';
import { TaskDialog } from './TaskDialog';
import { createBoard, getBoard, listBoards, taskKeys } from './tasks.api';
import { useBoardSync } from './useBoardSync';

type View = 'board' | 'mine';

/**
 * The task page: a team's board, or My Tasks across every board.
 *
 * Everything is in the URL - `?team=`, `?board=`, `?view=mine`, `?task=` - so
 * a notification can link straight to one task on its board, Back closes a
 * task, and a reload lands in the same place. With no board named, the page
 * shows the default board of the chosen team (or of the first team).
 */
export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'mine' ? 'mine' : 'board';
  const boardParam = params.get('board');
  const taskParam = params.get('task');

  function update(changes: Record<string, string | null>, replace = true) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace },
    );
  }

  const teams = useQuery({ queryKey: teamKeys.all, queryFn: listTeams });

  // The board on screen: the one named, or the chosen team's default one.
  const named = useQuery({
    queryKey: taskKeys.board(boardParam ?? ''),
    queryFn: () => getBoard(boardParam ?? ''),
    enabled: Boolean(boardParam),
    retry: false,
  });
  const teamId = named.data?.board.teamId ?? params.get('team') ?? teams.data?.[0]?.id;
  const boards = useQuery({
    queryKey: taskKeys.boards(teamId ?? ''),
    queryFn: () => listBoards(teamId ?? ''),
    enabled: Boolean(teamId),
  });
  const boardId = boardParam ?? boards.data?.find((board) => board.isDefault)?.id ?? null;
  const detail = useQuery({
    queryKey: taskKeys.board(boardId ?? ''),
    queryFn: () => getBoard(boardId ?? ''),
    enabled: Boolean(boardId),
    retry: false,
  });

  // Live while it is the board on screen.
  useBoardSync(view === 'board' ? boardId : null);

  const openTask = (task: Task | MyTask) => update({ board: task.boardId, task: task.id }, false);

  const canManage = detail.data ? canManageBoards(detail.data.board.myRole) : false;
  const failure = detail.error ?? named.error;
  const failed = failure !== null;
  const notFound = failure instanceof ApiError && failure.status === 404;
  const loading =
    !failed &&
    (teams.isPending ||
      (Boolean(teamId) && boards.isPending) ||
      (Boolean(boardId) && detail.isPending));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <KanbanSquare aria-hidden="true" className="size-6 text-primary" />
            Tasks
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === 'board'
              ? 'Drag cards between columns; everyone on the board sees it happen.'
              : 'Everything assigned to you, on every board.'}
          </p>
        </div>

        <div role="group" aria-label="Show" className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ['board', 'Board'],
              ['mine', 'My tasks'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => update({ view: value === 'mine' ? 'mine' : null })}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                view === value && 'bg-background text-foreground shadow-sm',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {view === 'mine' ? (
        <MyTasksView onOpen={openTask} />
      ) : teams.data && teams.data.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Boards belong to teams.{' '}
          <Link
            to="/app/teams"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create or join a team
          </Link>{' '}
          to get one.
        </p>
      ) : (
        <>
          <BoardPickers
            teams={teams.data ?? []}
            teamId={teamId}
            boards={boards.data ?? []}
            boardId={boardId}
            canManage={canManage}
            onTeam={(id) => update({ team: id, board: null, task: null })}
            onBoard={(id) => update({ board: id, task: null })}
          />

          {loading && (
            <div aria-live="polite" className="flex gap-3 overflow-hidden">
              <span className="sr-only">Loading the board</span>
              {[0, 1, 2, 3].map((column) => (
                <Skeleton key={column} className="h-72 w-72 shrink-0" />
              ))}
            </div>
          )}

          {failed && (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <AlertTriangle aria-hidden="true" className="mx-auto size-6 text-destructive" />
              <p className="mt-2 font-medium">
                {notFound ? 'That board is not available' : 'Could not load the board'}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => update({ board: null, task: null })}
              >
                Show my team’s board
              </Button>
            </div>
          )}

          {detail.data && <BoardView detail={detail.data} onOpenTask={openTask} />}
        </>
      )}

      {taskParam && boardParam && (
        <TaskDialog
          key={taskParam}
          taskId={taskParam}
          boardId={boardParam}
          onClose={() => update({ task: null })}
        />
      )}
    </div>
  );
}

/** Which team and board, for people with more than one; and "New board" for an admin. */
function BoardPickers({
  teams,
  teamId,
  boards,
  boardId,
  canManage,
  onTeam,
  onBoard,
}: {
  teams: { id: string; name: string }[];
  teamId: string | undefined;
  boards: { id: string; name: string }[];
  boardId: string | null;
  canManage: boolean;
  onTeam: (teamId: string) => void;
  onBoard: (boardId: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (name: string) => createBoard(teamId ?? '', name),
    onSuccess: (board) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.boards(board.teamId) });
      setCreating(false);
      onBoard(board.id);
    },
  });

  if (teams.length <= 1 && boards.length <= 1 && !canManage) return null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      {teams.length > 1 && (
        <div className="w-full sm:w-56">
          <Label htmlFor="tasks-team" className="sr-only">
            Team
          </Label>
          <NativeSelect
            id="tasks-team"
            value={teamId ?? ''}
            onChange={(event) => onTeam(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {boards.length > 1 && (
        <div className="w-full sm:w-56">
          <Label htmlFor="tasks-board" className="sr-only">
            Board
          </Label>
          <NativeSelect
            id="tasks-board"
            value={boardId ?? ''}
            onChange={(event) => onBoard(event.target.value)}
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {canManage && (
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          New board
        </Button>
      )}

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New board"
        description="It starts with To Do, In Progress, Review and Done. Tasks from meetings keep going to the team’s main board."
        label="Board name"
        submitLabel="Create board"
        maxLength={60}
        pending={create.isPending}
        onSubmit={(name) => create.mutate(name)}
      />
    </div>
  );
}
