import type { Types } from 'mongoose';
import { ORDER_STEP, orderBetween } from '@intellmeet/shared';
import { Task } from './task.model.js';

export interface Placement {
  /** The moved task's new order. */
  order: number;
  /** Other tasks renumbered to make room; empty unless the gap ran out. */
  reordered: { id: string; order: number }[];
}

/**
 * Where a task lands in a column, from the neighbours it was dropped between.
 *
 * The client names the neighbours as it saw them; the orders come from the
 * database. So a client whose board is a second stale (somebody else moved a
 * card meanwhile) still puts the task where the person dropped it, relative
 * to the cards they could see. A neighbour that has since left the column is
 * ignored, and with neither usable the task goes to the bottom.
 *
 * Normally the answer is the midpoint between two orders and only the moved
 * task is written. When repeated drops into one slot have halved the gap too
 * far to split again, the column is renumbered in steps of `ORDER_STEP`, and
 * the tasks that moved are returned so every viewer can apply them.
 */
export async function placeTask(input: {
  boardId: Types.ObjectId;
  columnId: string;
  taskId: Types.ObjectId;
  afterId?: string | null;
  beforeId?: string | null;
}): Promise<Placement> {
  const others = { boardId: input.boardId, columnId: input.columnId, _id: { $ne: input.taskId } };
  const self = input.taskId.toString();

  const neighbour = (id: string | null | undefined) =>
    id && id !== self ? Task.findOne({ ...others, _id: id }).select('order') : null;

  const [after, before] = await Promise.all([neighbour(input.afterId), neighbour(input.beforeId)]);

  let previous: number | null;
  let next: number | null;

  if (after) {
    previous = after.order;
    next =
      before && before.order > after.order
        ? before.order
        : ((
            await Task.findOne({ ...others, order: { $gt: after.order } })
              .sort({ order: 1 })
              .select('order')
          )?.order ?? null);
  } else if (before) {
    next = before.order;
    previous =
      (
        await Task.findOne({ ...others, order: { $lt: before.order } })
          .sort({ order: -1 })
          .select('order')
      )?.order ?? null;
  } else {
    // An empty column, or neighbours that are no longer there: the bottom.
    previous = (await Task.findOne(others).sort({ order: -1 }).select('order'))?.order ?? null;
    next = null;
  }

  const order = orderBetween(previous, next);
  if (order !== null) return { order, reordered: [] };

  return renumber(others, previous);
}

/**
 * Lays the column out again in even steps, leaving a slot for the moved task
 * straight after the task at `previous`.
 */
async function renumber(
  others: { boardId: Types.ObjectId; columnId: string; _id: { $ne: Types.ObjectId } },
  previous: number | null,
): Promise<Placement> {
  const column = await Task.find(others).sort({ order: 1, _id: 1 }).select('_id order');

  // Everything at or before `previous` stays above the moved task.
  const slot = previous === null ? 0 : column.filter((task) => task.order <= previous).length;

  const laidOut = column.map((task, index) => ({
    id: task._id.toString(),
    order: ((index < slot ? index : index + 1) + 1) * ORDER_STEP,
  }));
  const changed = laidOut.filter((entry, index) => entry.order !== column[index]?.order);
  if (changed.length > 0) {
    await Task.bulkWrite(
      changed.map((entry) => ({
        updateOne: {
          filter: { _id: entry.id },
          update: { $set: { order: entry.order }, $inc: { version: 1 } },
        },
      })),
    );
  }

  return { order: (slot + 1) * ORDER_STEP, reordered: changed };
}
