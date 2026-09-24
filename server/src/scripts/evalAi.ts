import { parseArgs } from 'node:util';
import { AI_PROVIDERS } from '../config/env.js';
import { createAIProvider, type AIProviderName } from '../lib/ai/index.js';
import { evaluateAnalysis, sameAssignee, type EvaluationScore } from '../lib/ai/evaluate.js';
import { loadMeetingFixtures } from '../modules/demo/demo.meetings.js';

/**
 * AI evaluation: runs the analysis step over the sample transcripts in
 * `server/fixtures/` and prints what the model produced beside the reference.
 *
 *   npm run eval:ai -w @intellmeet/server                     # AI_PROVIDER from .env
 *   npm run eval:ai -w @intellmeet/server -- --provider groq  # a specific provider
 *   npm run eval:ai -w @intellmeet/server -- --fixture q3-launch-retro
 *
 * It evaluates *analysis* (summary, decisions, owners, deadlines) from a known
 * transcript, which isolates the part a model can get wrong in interesting
 * ways. Speech-to-text accuracy needs real audio, which the fixtures do not
 * include; Whisper's word error rate is published and well understood.
 *
 * The automatic scores are keyword matches - a reading aid. Read the pairs.
 * Nothing is written to the database.
 */

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    fixture: { type: 'string' },
  },
});

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

const tick = (ok: boolean) => (ok ? green('✓') : red('✗'));
const pct = (part: number, whole: number) =>
  whole === 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`;

function wrap(text: string, indent: string, width = 96): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width - indent.length) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((entry) => indent + entry).join('\n');
}

async function main(): Promise<void> {
  const providerName = (values.provider ?? undefined) as AIProviderName | undefined;
  if (providerName && !AI_PROVIDERS.includes(providerName)) {
    throw new Error(`--provider must be one of: ${AI_PROVIDERS.join(', ')}`);
  }

  const provider = createAIProvider(providerName);
  const fixtures = (await loadMeetingFixtures()).filter(
    (fixture) => !values.fixture || fixture.key === values.fixture,
  );
  if (fixtures.length === 0) throw new Error(`No fixture matches "${values.fixture}"`);

  console.log(
    bold(
      `\nIntellMeet AI evaluation - provider: ${provider.name}, ${fixtures.length} meeting(s)\n`,
    ),
  );

  const totals: EvaluationScore = {
    decisions: { matched: 0, produced: 0, reference: 0 },
    actionItems: { matched: 0, produced: 0, reference: 0 },
    assigneeCorrect: 0,
    dueDateCorrect: 0,
    fullyCorrect: 0,
  };

  for (const fixture of fixtures) {
    const startedAt = performance.now();
    const produced = await provider.analyze({
      title: fixture.title,
      participantNames: fixture.participants,
      meetingDate: new Date(fixture.meetingDate),
      segments: fixture.segments,
    });
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);

    const result = evaluateAnalysis(produced, fixture.reference);
    const { score } = result;

    console.log(
      bold(`━━━ ${fixture.title} (${fixture.key}) ━━━ ${dim(`${produced.provider}, ${seconds}s`)}`),
    );

    console.log(
      bold('\n  SUMMARY') +
        dim(`  (keyword overlap with reference: ${result.summarySimilarity.toFixed(2)})`),
    );
    console.log(dim('    model:'));
    console.log(wrap(produced.summary, '      '));
    console.log(dim('    reference:'));
    console.log(wrap(fixture.reference.summary, '      '));

    console.log(bold('\n  KEY DECISIONS'));
    for (const pair of result.decisions.pairs) {
      console.log(`    ${tick(true)} ${pair.produced}`);
      console.log(dim(`        ≈ ${pair.reference}  (match ${pair.score.toFixed(2)})`));
    }
    for (const missed of result.decisions.missed) console.log(`    ${red('✗ missed:')} ${missed}`);
    for (const extra of result.decisions.extra) console.log(`    ${yellow('+ extra:')}  ${extra}`);

    console.log(bold('\n  ACTION ITEMS'));
    for (const pair of result.actionItems.pairs) {
      const ownerOk = sameAssignee(pair.produced.assigneeName, pair.reference.assigneeName);
      const dueOk = pair.produced.dueDate === pair.reference.dueDate;
      console.log(`    ${tick(ownerOk && dueOk)} ${pair.produced.text}`);
      console.log(
        `        owner ${tick(ownerOk)} ${pair.produced.assigneeName ?? '(none)'}` +
          dim(` vs ${pair.reference.assigneeName ?? '(none)'}`) +
          `   due ${tick(dueOk)} ${pair.produced.dueDate ?? '(none)'}` +
          dim(` vs ${pair.reference.dueDate ?? '(none)'}`),
      );
      console.log(dim(`        ≈ ${pair.reference.text}  (match ${pair.score.toFixed(2)})`));
    }
    for (const missed of result.actionItems.missed) {
      console.log(
        `    ${red('✗ missed:')} ${missed.text} ${dim(`(${missed.assigneeName ?? 'no owner'}, ${missed.dueDate ?? 'no date'})`)}`,
      );
    }
    for (const extra of result.actionItems.extra) {
      console.log(
        `    ${yellow('+ extra:')}  ${extra.text} ${dim(`(${extra.assigneeName ?? 'no owner'}, ${extra.dueDate ?? 'no date'})`)}`,
      );
    }

    console.log(
      `\n  ${dim('decisions')} ${score.decisions.matched}/${score.decisions.reference} found, ${score.decisions.produced - score.decisions.matched} extra` +
        `   ${dim('action items')} ${score.actionItems.matched}/${score.actionItems.reference} found, ${score.actionItems.produced - score.actionItems.matched} extra` +
        `   ${dim('fully correct')} ${score.fullyCorrect}/${score.actionItems.reference}\n`,
    );

    totals.decisions.matched += score.decisions.matched;
    totals.decisions.produced += score.decisions.produced;
    totals.decisions.reference += score.decisions.reference;
    totals.actionItems.matched += score.actionItems.matched;
    totals.actionItems.produced += score.actionItems.produced;
    totals.actionItems.reference += score.actionItems.reference;
    totals.assigneeCorrect += score.assigneeCorrect;
    totals.dueDateCorrect += score.dueDateCorrect;
    totals.fullyCorrect += score.fullyCorrect;
  }

  const t = totals;
  console.log(bold('━━━ Overall ━━━'));
  console.log(
    `  Key decisions   recall ${pct(t.decisions.matched, t.decisions.reference)}   precision ${pct(t.decisions.matched, t.decisions.produced)}`,
  );
  console.log(
    `  Action items    recall ${pct(t.actionItems.matched, t.actionItems.reference)}   precision ${pct(t.actionItems.matched, t.actionItems.produced)}`,
  );
  console.log(
    `  Of found items  owner correct ${pct(t.assigneeCorrect, t.actionItems.matched)}   deadline correct ${pct(t.dueDateCorrect, t.actionItems.matched)}`,
  );
  console.log(
    bold(
      `  Action items fully correct (found + owner + deadline): ${t.fullyCorrect}/${t.actionItems.reference} = ${pct(t.fullyCorrect, t.actionItems.reference)}`,
    ),
  );
  console.log(
    dim(
      '\n  Scores come from keyword matching and are only a guide: read the pairs above and\n' +
        '  judge each one yourself. The project target is >85% accuracy.\n',
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    red(`\nEvaluation failed: ${error instanceof Error ? error.message : String(error)}\n`),
  );
  process.exit(1);
});
