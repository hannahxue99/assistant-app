#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_TAIL_CHARS = 120_000;
const FAILURE_LINES = 60;

function appendTail(current, chunk) {
  const combined = current + chunk;
  return combined.length > MAX_TAIL_CHARS ? combined.slice(-MAX_TAIL_CHARS) : combined;
}

function countTestGroups(cwd) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return (String(packageJson.scripts?.test ?? '').match(/npm run test:[\w-]+/g) ?? []).length;
  } catch {
    return undefined;
  }
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function diagnosticTail(value) {
  const lines = String(value)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return lines.slice(-FAILURE_LINES).join('\n');
}

function createLogPath(logDir, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(logDir, `assistant-app-ci-${stamp}-${process.pid}.log`);
}

function runQuietCommand(options = {}) {
  const cwd = path.resolve(options.cwd ?? path.join(__dirname, '..'));
  const command = options.command ?? 'npm';
  const args = options.args ?? ['run', 'ci'];
  const output = options.output ?? ((line) => console.log(line));
  const logDir = options.logDir ?? path.join(os.tmpdir(), 'assistant-app-ci-logs');
  const startedAt = Date.now();
  const testGroups = options.testGroups ?? countTestGroups(cwd);

  fs.mkdirSync(logDir, { recursive: true });
  const logPath = options.logPath ?? createLogPath(logDir, options.now);
  const logStream = fs.createWriteStream(logPath, { flags: 'wx' });

  return new Promise((resolve) => {
    let tail = '';
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    const forwardInterrupt = () => forward('SIGINT');
    const forwardTerminate = () => forward('SIGTERM');
    process.on('SIGINT', forwardInterrupt);
    process.on('SIGTERM', forwardTerminate);

    const record = (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      tail = appendTail(tail, text);
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);

    const finish = (code, signal, spawnError) => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', forwardInterrupt);
      process.off('SIGTERM', forwardTerminate);
      if (spawnError) record(Buffer.from(`${spawnError.stack ?? spawnError.message}\n`));

      logStream.end(() => {
        const duration = formatDuration(Date.now() - startedAt);
        const exitCode = Number.isInteger(code) ? code : 1;
        if (exitCode === 0 && !signal && !spawnError) {
          output('CI passed');
          output(`Typecheck and ${testGroups ?? 'all'} test groups completed in ${duration}`);
          output(`Full log: ${logPath}`);
        } else {
          output(`CI failed (${signal ? `signal ${signal}` : `exit ${exitCode}`}) after ${duration}`);
          const diagnostic = diagnosticTail(tail);
          if (diagnostic) output(`Diagnostic tail:\n${diagnostic}`);
          output(`Full log: ${logPath}`);
        }
        resolve({ exitCode, logPath, signal, duration });
      });
    };

    child.once('error', (error) => finish(1, undefined, error));
    child.once('close', (code, signal) => finish(code, signal));
  });
}

if (require.main === module) {
  runQuietCommand()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`CI summary failed: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  appendTail,
  countTestGroups,
  createLogPath,
  diagnosticTail,
  runQuietCommand,
};
