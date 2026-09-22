#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_LIMITS = Object.freeze({
  changedFiles: 12,
  candidateDocs: 6,
});

const GENERIC_SEARCH_TERMS = new Set([
  'app', 'assistant', 'current', 'design', 'docs', 'implementation', 'index',
  'plan', 'plans', 'script', 'scripts', 'src', 'test', 'tests',
]);

function defaultRunner(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout ?? 5_000,
    maxBuffer: 2 * 1024 * 1024,
    env: options.env ?? process.env,
  });

  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? result.error?.message ?? '').trim(),
  };
}

function firstLine(value) {
  return String(value ?? '').split(/\r?\n/, 1)[0].slice(0, 180);
}

function splitLines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function chooseGitBinary() {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git';
}

function normalizeSearchTerms(values, excludeGeneric = false) {
  const terms = new Set();
  const add = (value) => {
    for (const token of String(value ?? '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u)) {
      if (token.length >= 3 && (!excludeGeneric || !GENERIC_SEARCH_TERMS.has(token))) terms.add(token);
    }
  };

  for (const value of values) add(value);
  return [...terms];
}

function changedFileTerms(changedFiles) {
  const values = [];
  for (const file of changedFiles) {
    values.push(file);
    values.push(path.basename(file, path.extname(file)));
    values.push(...file.split('/'));
  }
  return normalizeSearchTerms(values, true);
}

function selectCandidateDocs(paths, query, changedFiles, limit) {
  const queryTerms = normalizeSearchTerms([query]);
  const changeTerms = changedFileTerms(changedFiles);
  return paths
    .filter((file) => file.endsWith('.md') && !file.startsWith('docs/archive/'))
    .map((file) => {
      const normalized = file.toLowerCase();
      const queryScore = queryTerms.reduce(
        (total, term) => total + (normalized.includes(term) ? 10 : 0),
        0,
      );
      const changeScore = changeTerms.reduce(
        (total, term) => total + (normalized.includes(term) ? 1 : 0),
        0,
      );
      const score = queryTerms.length > 0 ? queryScore : changeScore;
      return { file, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))
    .slice(0, limit)
    .map(({ file }) => file);
}

function summarizeChecks(checks) {
  const summary = { pass: 0, fail: 0, pending: 0 };
  for (const check of Array.isArray(checks) ? checks : []) {
    const value = String(check.conclusion ?? check.state ?? check.status ?? '').toUpperCase();
    if (['SUCCESS', 'PASS', 'COMPLETED'].includes(value)) summary.pass += 1;
    else if (['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(value)) summary.fail += 1;
    else summary.pending += 1;
  }
  return summary;
}

function getPullRequest({ cwd, prNumber, runner }) {
  const availability = runner('gh', ['--version'], { cwd, timeout: 2_000 });
  if (!availability.ok) return { available: false, reason: 'gh unavailable' };

  const args = ['pr', 'view'];
  if (prNumber !== undefined) args.push(String(prNumber));
  args.push('--json', 'number,title,state,url,headRefName,baseRefName,statusCheckRollup');
  const result = runner('gh', args, { cwd, timeout: 8_000 });
  if (!result.ok) {
    return { available: false, reason: firstLine(result.stderr) || 'PR lookup failed' };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      available: true,
      number: parsed.number,
      title: parsed.title,
      state: parsed.state,
      url: parsed.url,
      head: parsed.headRefName,
      base: parsed.baseRefName,
      checks: summarizeChecks(parsed.statusCheckRollup),
    };
  } catch (error) {
    return { available: false, reason: `invalid gh response: ${error.message}` };
  }
}

function buildSnapshot(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runner = options.runner ?? defaultRunner;
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const git = options.gitBinary ?? chooseGitBinary();
  const runGit = (args) => runner(git, args, { cwd, timeout: 5_000 });

  const branchResult = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branchResult.ok) throw new Error(`Not a usable Git repository: ${firstLine(branchResult.stderr)}`);

  const upstreamResult = runGit(['rev-parse', '--abbrev-ref', '@{upstream}']);
  const statusResult = runGit(['status', '--porcelain=v1']);
  const statusLines = statusResult.ok ? splitLines(statusResult.stdout) : [];

  let base;
  for (const candidate of ['origin/main', 'main']) {
    if (runGit(['rev-parse', '--verify', '--quiet', candidate]).ok) {
      base = candidate;
      break;
    }
  }

  let commitCount;
  let changedFiles = [];
  if (base) {
    const countResult = runGit(['rev-list', '--count', `${base}..HEAD`]);
    if (countResult.ok) commitCount = Number.parseInt(countResult.stdout, 10);
    const changedResult = runGit(['diff', '--name-only', `${base}...HEAD`]);
    if (changedResult.ok) changedFiles.push(...splitLines(changedResult.stdout));
  }
  const worktreeDiffResult = runGit(['diff', '--name-only']);
  if (worktreeDiffResult.ok) changedFiles.push(...splitLines(worktreeDiffResult.stdout));
  const stagedDiffResult = runGit(['diff', '--name-only', '--cached']);
  if (stagedDiffResult.ok) changedFiles.push(...splitLines(stagedDiffResult.stdout));
  const untrackedResult = runGit(['ls-files', '--others', '--exclude-standard']);
  if (untrackedResult.ok) changedFiles.push(...splitLines(untrackedResult.stdout));
  changedFiles = unique(changedFiles).sort();

  const docsResult = runGit(['ls-files', '*.md']);
  const trackedDocs = docsResult.ok ? splitLines(docsResult.stdout) : [];
  const candidateDocs = selectCandidateDocs(
    trackedDocs,
    options.query ?? '',
    changedFiles,
    limits.candidateDocs,
  );

  const pullRequest = options.includePr === false
    ? undefined
    : getPullRequest({ cwd, prNumber: options.prNumber, runner });

  return {
    cwd,
    branch: branchResult.stdout,
    upstream: upstreamResult.ok ? upstreamResult.stdout : undefined,
    base,
    commitCount: Number.isFinite(commitCount) ? commitCount : undefined,
    worktreeChanges: statusLines.length,
    changedFiles,
    candidateDocs,
    pullRequest,
    limits,
  };
}

function addBoundedList(lines, label, values, limit) {
  const shown = values.slice(0, limit);
  lines.push(`${label}: ${values.length}${values.length > shown.length ? ` (showing ${shown.length})` : ''}`);
  for (const value of shown) lines.push(`  - ${value}`);
}

function formatSnapshot(snapshot) {
  const lines = [
    'Assistant App context snapshot',
    `Branch: ${snapshot.branch}`,
    `Upstream: ${snapshot.upstream ?? 'none'}`,
    `Base: ${snapshot.base ?? 'unavailable'}`,
    `Commits ahead: ${snapshot.commitCount ?? 'unavailable'}`,
    `Worktree: ${snapshot.worktreeChanges === 0 ? 'clean' : `${snapshot.worktreeChanges} change(s)`}`,
  ];

  addBoundedList(lines, 'Changed files', snapshot.changedFiles, snapshot.limits.changedFiles);
  addBoundedList(lines, 'Candidate docs', snapshot.candidateDocs, snapshot.limits.candidateDocs);

  if (snapshot.pullRequest) {
    if (!snapshot.pullRequest.available) {
      lines.push(`PR: unavailable (${snapshot.pullRequest.reason})`);
    } else {
      const pr = snapshot.pullRequest;
      lines.push(`PR: #${pr.number} ${pr.state} ${pr.title}`);
      lines.push(`PR branches: ${pr.head} -> ${pr.base}`);
      lines.push(`Checks: ${pr.checks.pass} pass, ${pr.checks.fail} fail, ${pr.checks.pending} pending`);
      lines.push(`URL: ${pr.url}`);
    }
  }

  return lines.join('\n');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--query') {
      if (argv[index + 1] === undefined) throw new Error('--query requires a value');
      options.query = argv[index + 1];
      index += 1;
    } else if (arg === '--pr') {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--pr requires a positive number');
      options.prNumber = value;
      index += 1;
    } else if (arg === '--no-pr') {
      options.includePr = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(formatSnapshot(buildSnapshot(options)));
  } catch (error) {
    console.error(`Context snapshot failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_LIMITS,
  buildSnapshot,
  defaultRunner,
  formatSnapshot,
  parseArgs,
  selectCandidateDocs,
  summarizeChecks,
};
