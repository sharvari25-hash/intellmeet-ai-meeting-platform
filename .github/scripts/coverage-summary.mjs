// Prints the coverage of each workspace as a Markdown table, for the CI job
// summary:  node .github/scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"
//
// Reads the `json-summary` reports Vitest writes (server/coverage and
// client/coverage). A workspace whose report is missing is listed as such
// rather than failing the step, so a failed test run still gets a summary.
import { existsSync, readFileSync } from 'node:fs';

const workspaces = ['server', 'client'];
const metrics = ['statements', 'branches', 'functions', 'lines'];

const rows = workspaces.map((workspace) => {
  const file = `${workspace}/coverage/coverage-summary.json`;
  if (!existsSync(file)) return `| ${workspace} | ${metrics.map(() => 'no report').join(' | ')} |`;

  const { total } = JSON.parse(readFileSync(file, 'utf8'));
  const cells = metrics.map((metric) => {
    const { pct, covered, total: count } = total[metric];
    return `${pct.toFixed(1)}% (${covered}/${count})`;
  });
  return `| ${workspace} | ${cells.join(' | ')} |`;
});

process.stdout.write(
  [
    '### Unit test coverage',
    '',
    `| Workspace | ${metrics.map((m) => m[0].toUpperCase() + m.slice(1)).join(' | ')} |`,
    `| --- | ${metrics.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
    'Full HTML reports: the `coverage` artifact of this run.',
    '',
  ].join('\n'),
);
