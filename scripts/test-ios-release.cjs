const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  EXPECTED_CMAKE_VERSION,
  createReleasePlan,
  fixedCmakePath,
  runRelease,
  validateFixedCmake,
} = require('./ios-release.cjs');

assert.equal(EXPECTED_CMAKE_VERSION, '3.31.8');
assert.equal(
  fixedCmakePath('/Users/example'),
  '/Users/example/.local/share/assistant-app/toolchains/cmake-3.31.8-macos-universal/CMake.app/Contents/bin/cmake',
);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-ios-release-'));
try {
  const cmakePath = path.join(tempDirectory, 'cmake');
  fs.writeFileSync(cmakePath, '#!/bin/sh\n');
  fs.chmodSync(cmakePath, 0o755);

  assert.equal(
    validateFixedCmake(cmakePath, {
      execFileSyncImpl: () => 'cmake version 3.31.8\n\nCMake suite maintained by Kitware.\n',
    }),
    '3.31.8',
  );
  assert.throws(
    () => validateFixedCmake(path.join(tempDirectory, 'missing')),
    /Fixed CMake is missing/,
  );

  fs.chmodSync(cmakePath, 0o644);
  assert.throws(() => validateFixedCmake(cmakePath), /not executable/);
  fs.chmodSync(cmakePath, 0o755);

  assert.throws(
    () => validateFixedCmake(cmakePath, {
      execFileSyncImpl: () => 'cmake version 3.5.2\n',
    }),
    /Expected CMake 3\.31\.8.*found 3\.5\.2/,
  );

  const projectRoot = '/project';
  const plan = createReleasePlan({ projectRoot, cmakePath });
  assert.deepEqual(plan[0], {
    label: 'Expo iOS Release prebuild',
    command: '/project/node_modules/.bin/expo',
    args: ['prebuild', '--platform', 'ios', '--clean'],
  });
  assert.deepEqual(plan[1], {
    label: 'iOS production device build',
    command: process.execPath,
    args: ['/project/scripts/ios-device-build.cjs', 'production'],
  });

  const calls = [];
  runRelease({
    projectRoot,
    cmakePath,
    validateImpl: () => EXPECTED_CMAKE_VERSION,
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.env.APP_VARIANT, 'production');
  assert.equal(calls[0].options.env.CMAKE_BINARY, cmakePath);
  assert.equal(calls[1].options.env.CMAKE_BINARY, cmakePath);

  const failedCalls = [];
  assert.throws(
    () => runRelease({
      projectRoot,
      cmakePath,
      validateImpl: () => EXPECTED_CMAKE_VERSION,
      spawnSyncImpl(command) {
        failedCalls.push(command);
        return { status: 9 };
      },
    }),
    /Expo iOS Release prebuild exited with status 9/,
  );
  assert.equal(failedCalls.length, 1, 'Device build must not run after Prebuild fails');
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log('iOS Release preflight tests passed');
