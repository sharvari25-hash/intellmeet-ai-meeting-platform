import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { AnalyticsMember, AnalyticsOverview, AnalyticsWeek } from '@intellmeet/shared';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { MEMBER_CHART_LIMIT, completionRows, outcomesOf, type Outcome } from './chartData';
import { decimal, duration, percent, weekLabel, weekOf } from './format';

/*
 * The dashboard's charts, drawn with Recharts to one set of rules:
 *
 * - colour does one job per chart: one hue for a single series, the
 *   categorical slots in a fixed order for several, a grey for "the rest",
 *   status colours (with an icon and a label) only where colour means good
 *   or bad;
 * - thin marks (2 px lines, bars at most 24 px thick with rounded data ends),
 *   hairline grid, a surface-coloured gap between stacked segments;
 * - a legend whenever there are two series or more, and labels only where
 *   they help (the end of a bar), never on every point;
 * - one axis per chart;
 * - no animation for anyone who asked their system for less motion.
 *
 * Each chart is wrapped in a `ChartCard`, which carries the same numbers as
 * a table; the SVG here is hidden from assistive technology.
 */

const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 };
const GRID = 'var(--border)';
/** The card behind the chart: the colour of the gap between touching marks. */
const SURFACE = 'var(--card)';

// --- Shared pieces -----------------------------------------------------------------

interface TooltipLine {
  label: string;
  value: string;
  /** The series colour, shown as a short line key; omitted for extra detail rows. */
  color?: string;
}

/** Values lead, labels follow: the reader already knows the series and wants the number. */
function TooltipCard({ title, lines }: { title: string; lines: TooltipLine[] }) {
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      <ul className="space-y-0.5">
        {lines.map((line) => (
          <li key={line.label} className="flex items-center gap-2">
            {line.color ? (
              <span
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: line.color }}
              />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="font-semibold tabular-nums">{line.value}</span>
            <span className="text-muted-foreground">{line.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LegendItem {
  label: string;
  color: string;
  shape: 'line' | 'box';
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={item.shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-sm'}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** First row of a tooltip's payload: the data point under the pointer. */
function hovered<Row>(props: TooltipContentProps): Row | undefined {
  return props.active ? (props.payload?.[0]?.payload as Row | undefined) : undefined;
}

/** Long names are cut on the axis; the table and tooltip have them whole. */
function shortName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

// --- Meetings per week (line) ------------------------------------------------------

interface WeekPoint extends AnalyticsWeek {
  label: string;
}

export function MeetingsChart({ weeks }: { weeks: AnalyticsWeek[] }) {
  const reduced = useReducedMotion();
  const data: WeekPoint[] = weeks.map((week) => ({ ...week, label: weekLabel(week.week) }));

  return (
    <ResponsiveContainer width="100%" height={232}>
      <LineChart
        data={data}
        margin={{ top: 12, right: 12, bottom: 0, left: -18 }}
        accessibilityLayer={false}
      >
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="label"
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          interval="preserveStartEnd"
          minTickGap={12}
        />
        <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
          isAnimationActive={false}
          content={(props) => {
            const week = hovered<WeekPoint>(props);
            if (!week) return null;
            return (
              <TooltipCard
                title={weekOf(week.week)}
                lines={[
                  { label: 'meetings', value: String(week.meetings), color: 'var(--chart-1)' },
                  { label: 'in meetings', value: duration(week.totalMinutes) },
                  { label: 'people per meeting', value: decimal(week.averageParticipants) },
                ]}
              />
            );
          }}
        />
        <Line
          // Straight segments: weekly counts are separate points, and a curve
          // would draw values between them that never happened.
          type="linear"
          dataKey="meetings"
          name="Meetings"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={{ r: 4, fill: 'var(--chart-1)', stroke: SURFACE, strokeWidth: 2 }}
          activeDot={{ r: 6, fill: 'var(--chart-1)', stroke: SURFACE, strokeWidth: 2 }}
          isAnimationActive={!reduced}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- Action items raised vs done, per week (stacked columns) -------------------------

interface ItemsPoint {
  week: string;
  label: string;
  done: number;
  open: number;
  created: number;
}

export function ActionItemsChart({ weeks }: { weeks: AnalyticsWeek[] }) {
  const reduced = useReducedMotion();
  const data: ItemsPoint[] = weeks.map((week) => ({
    week: week.week,
    label: weekLabel(week.week),
    done: week.actionItemsCompleted,
    open: week.actionItemsCreated - week.actionItemsCompleted,
    created: week.actionItemsCreated,
  }));

  return (
    <>
      <ResponsiveContainer width="100%" height={232}>
        <BarChart
          data={data}
          margin={{ top: 12, right: 12, bottom: 0, left: -18 }}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis allowDecimals={false} tick={TICK} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            isAnimationActive={false}
            content={(props) => {
              const week = hovered<ItemsPoint>(props);
              if (!week) return null;
              return (
                <TooltipCard
                  title={weekOf(week.week)}
                  lines={[
                    { label: 'done', value: String(week.done), color: 'var(--chart-1)' },
                    { label: 'not done yet', value: String(week.open), color: 'var(--chart-rest)' },
                    { label: 'raised', value: String(week.created) },
                  ]}
                />
              );
            }}
          />
          {/* Emphasis: what got done, in colour, on what is left, in grey. */}
          <Bar
            dataKey="done"
            stackId="items"
            fill="var(--chart-1)"
            stroke={SURFACE}
            strokeWidth={2}
            maxBarSize={24}
            isAnimationActive={!reduced}
          />
          <Bar
            dataKey="open"
            stackId="items"
            fill="var(--chart-rest)"
            stroke={SURFACE}
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={!reduced}
          />
        </BarChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'Done', color: 'var(--chart-1)', shape: 'box' },
          { label: 'Not done yet', color: 'var(--chart-rest)', shape: 'box' },
        ]}
      />
    </>
  );
}

// --- What became of the action items (donut) -----------------------------------------

export function OutcomesChart({ items }: { items: AnalyticsOverview['actionItems'] }) {
  const reduced = useReducedMotion();
  const outcomes = outcomesOf(items);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false}>
            <Pie
              data={outcomes}
              dataKey="value"
              nameKey="label"
              innerRadius="60%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              stroke={SURFACE}
              strokeWidth={2}
              isAnimationActive={!reduced}
              // Recharts makes a pie focusable by default, even with the
              // accessibility layer off. The chart is hidden from assistive
              // technology (its table says the same), and a Tab stop inside
              // hidden content is a stop with nothing to announce (axe:
              // aria-hidden-focus, Phase 10).
              rootTabIndex={-1}
            >
              {outcomes.map((outcome) => (
                <Cell key={outcome.key} fill={outcome.color} />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={(props) => {
                const outcome = hovered<Outcome>(props);
                if (!outcome) return null;
                return (
                  <TooltipCard
                    title={outcome.label}
                    lines={[
                      {
                        label: `of ${items.created}`,
                        value: `${outcome.value} (${percent(outcome.value / items.created)})`,
                        color: outcome.color,
                      },
                    ]}
                  />
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-semibold">{items.created}</p>
            <p className="text-xs text-muted-foreground">action items</p>
          </div>
        </div>
      </div>

      {/* Status colours never stand alone: an icon and a word go with each. */}
      <ul className="w-full space-y-2 text-sm sm:w-auto sm:min-w-40">
        {outcomes.map((outcome) => (
          <li key={outcome.key} className="flex items-center gap-2">
            <outcome.icon className="size-4 shrink-0" style={{ color: outcome.color }} />
            <span className="flex-1">{outcome.label}</span>
            <span className="font-semibold tabular-nums">{outcome.value}</span>
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
              {percent(items.created > 0 ? outcome.value / items.created : null)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Task completion rate per member (bars) --------------------------------------------

interface RatePoint {
  name: string;
  rate: number;
  tip: string;
  member: AnalyticsMember;
}

function chartHeight(rows: number): number {
  return rows * 36 + 32;
}

export function CompletionChart({ members }: { members: AnalyticsMember[] }) {
  const reduced = useReducedMotion();
  const data: RatePoint[] = completionRows(members)
    .slice(0, MEMBER_CHART_LIMIT)
    .map((member) => ({
      name: member.name,
      rate: member.completionRate ?? 0,
      tip: `${percent(member.completionRate)} (${member.tasksCompleted}/${member.tasksAssigned})`,
      member,
    }));

  return (
    <ResponsiveContainer width="100%" height={chartHeight(data.length)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 72, bottom: 0, left: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis
          type="number"
          domain={[0, 1]}
          ticks={[0, 0.5, 1]}
          tickFormatter={(value: number) => percent(value)}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={104}
          tick={TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortName}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          isAnimationActive={false}
          content={(props) => {
            const point = hovered<RatePoint>(props);
            if (!point) return null;
            return (
              <TooltipCard
                title={point.name}
                lines={[
                  {
                    label: 'of their tasks done',
                    value: percent(point.rate),
                    color: 'var(--chart-1)',
                  },
                  {
                    label: 'done',
                    value: `${point.member.tasksCompleted} of ${point.member.tasksAssigned}`,
                  },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="rate"
          fill="var(--chart-1)"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
          // A 0% bar has no width, and Recharts draws no label on it; a
          // sliver keeps "0% (0/1)" on screen rather than an empty row.
          minPointSize={2}
          isAnimationActive={!reduced}
        >
          <LabelList dataKey="tip" position="right" fill="var(--foreground)" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Most active members (stacked bars) -------------------------------------------------

const ACTIVITY_SERIES = [
  { key: 'meetingsAttended', label: 'Meetings attended', color: 'var(--chart-1)' },
  { key: 'actionItemsOwned', label: 'Action items owned', color: 'var(--chart-2)' },
  { key: 'tasksCompleted', label: 'Tasks completed', color: 'var(--chart-3)' },
] as const;

export function ActivityChart({ members }: { members: AnalyticsMember[] }) {
  const reduced = useReducedMotion();
  const data = members.filter((member) => member.activity > 0).slice(0, MEMBER_CHART_LIMIT);

  return (
    <>
      <ResponsiveContainer width="100%" height={chartHeight(data.length)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={shortName}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            isAnimationActive={false}
            content={(props) => {
              const member = hovered<AnalyticsMember>(props);
              if (!member) return null;
              return (
                <TooltipCard
                  title={member.name}
                  lines={ACTIVITY_SERIES.map((series) => ({
                    label: series.label.toLowerCase(),
                    value: String(member[series.key]),
                    color: series.color,
                  }))}
                />
              );
            }}
          />
          {ACTIVITY_SERIES.map((series, index) => {
            const last = index === ACTIVITY_SERIES.length - 1;
            return (
              <Bar
                key={series.key}
                dataKey={series.key}
                stackId="activity"
                fill={series.color}
                stroke={SURFACE}
                strokeWidth={2}
                radius={last ? [0, 4, 4, 0] : 0}
                maxBarSize={20}
                isAnimationActive={!reduced}
              >
                {/* The total at the end of each bar. */}
                {last && (
                  <LabelList
                    dataKey="activity"
                    position="right"
                    fill="var(--foreground)"
                    fontSize={12}
                  />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={ACTIVITY_SERIES.map((series) => ({ ...series, shape: 'box' }))} />
    </>
  );
}
