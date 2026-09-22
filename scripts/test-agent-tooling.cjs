const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildSnapshot,
  formatSnapshot,
  parseArgs,
  selectCandidateDocs,
} = require('./agent-context.cjs');
const { runQuietCommand } = require('./ci-summary.cjs');

function gitStatus(cwd = path.join(__dirname, '..')) {
  return spawnSync('git', ['status', '--porcelain=v1'], {
    cwd,
    encoding: 'utf8',
  }).stdout;
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
}

async function main() {
  assert.deepEqual(parseArgs(['--query', 'backup v3', '--pr', '27']), {
    query: 'backup v3',
    prNumber: 27,
  });
  assert.throws(() => parseArgs(['--pr', 'nope']), /positive number/);

  const selected = selectCandidateDocs(
    [
      'docs/archive/old-backup.md',
      'docs/knowledge/importable-markdown-backups.md',
      'docs/plans/backup-v3-design.md',
      'docs/plans/unrelated.md',
    ],
    'backup',
    [],
    2,
  );
  assert.deepEqual(selected, [
    'docs/knowledge/importable-markdown-backups.md',
    'docs/plans/backup-v3-design.md',
  ]);

  const before = gitStatus();
  const snapshot = buildSnapshot({
    cwd: path.join(__dirname, '..'),
    query: 'agent context',
    includePr: false,
  });
  const rendered = formatSnapshot(snapshot);
  const after = gitStatus();
  assert.equal(after, before, 'Context snapshot must not modify the worktree');
  assert.ok(rendered.includes('Assistant App context snapshot'));
  assert.ok(!rendered.includes('docs/archive/'));
  assert.ok(rendered.split('\n').length <= 40, 'Context snapshot output must stay bounded');

  const unavailablePr = buildSnapshot({
    cwd: path.join(__dirname, '..'),
    runner(command, args, options) {
      if (command === 'gh') return { ok: false, status: 127, stdout: '', stderr: 'missing' };
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        timeout: options.timeout,
      });
      return {
        ok: result.status === 0,
        status: result.status,
        stdout: String(result.stdout ?? '').trim(),
        stderr: String(result.stderr ?? '').trim(),
      };
    },
  });
  assert.equal(unavailablePr.pullRequest.available, false);
  assert.match(formatSnapshot(unavailablePr), /PR: unavailable/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-agent-tooling-'));
  try {
    const repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(repoDir);
    runGit(repoDir, ['init']);
    runGit(repoDir, ['config', 'user.name', 'Agent Tooling Test']);
    runGit(repoDir, ['config', 'user.email', 'agent-tooling@example.invalid']);
    fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), 'base\n');
    runGit(repoDir, ['add', 'AGENTS.md']);
    runGit(repoDir, ['commit', '-m', 'base']);
    runGit(repoDir, ['branch', '-M', 'main']);
    fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), 'changed\n');

    const tempStatusBefore = gitStatus(repoDir);
    const worktreeSnapshot = buildSnapshot({
      cwd: repoDir,
      includePr: false,
      gitBinary: 'git',
    });
    assert.ok(worktreeSnapshot.changedFiles.includes('AGENTS.md'),
      'Snapshot must include tracked worktree edits');
    assert.equal(gitStatus(repoDir), tempStatusBefore,
      'Snapshot must leave tracked worktree edits untouched');

    const logDir = path.join(tempDir, 'logs');
    const successOutput = [];
    const success = await runQuietCommand({
      cwd: path.join(__dirname, '..'),
      command: process.execPath,
      args: ['-e', 'console.log("fixture passed")'],
      logDir,
      testGroups: 35,
      output: (line) => successOutput.push(line),
    });
    assert.equal(success.exitCode, 0);
    assert.ok(successOutput.length <= 3, 'Successful CI summary must remain concise');
    assert.match(successOutput.join('\n'), /35 test groups/);
    assert.match(fs.readFileSync(success.logPath, 'utf8'), /fixture passed/);

    const failureOutput = [];
    const failure = await runQuietCommand({
      cwd: path.join(__dirname, '..'),
      command: process.execPath,
      args: ['-e', 'console.error("fixture failed clearly"); process.exit(7)'],
      logDir,
      output: (line) => failureOutput.push(line),
    });
    assert.equal(failure.exitCode, 7, 'CI summary must preserve child exit codes');
    assert.match(failureOutput.join('\n'), /fixture failed clearly/);
    assert.match(fs.readFileSync(failure.logPath, 'utf8'), /fixture failed clearly/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Agent context and CI summary tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
