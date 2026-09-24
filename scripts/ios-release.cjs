#!/usr/bin/env node

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXPECTED_CMAKE_VERSION = '3.31.8';
const FIXED_CMAKE_RELATIVE_PATH = path.join(
  '.local',
  'share',
  'assistant-app',
  'toolchains',
  'cmake-3.31.8-macos-universal',
  'CMake.app',
  'Contents',
  'bin',
  'cmake',
);

function fixedCmakePath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, FIXED_CMAKE_RELATIVE_PATH);
}

function validateFixedCmake(cmakePath, { execFileSyncImpl = execFileSync } = {}) {
  if (!fs.existsSync(cmakePath)) {
    throw new Error(
      `Fixed CMake is missing: ${cmakePath}. Restore the verified CMake 3.31.8 toolchain before releasing.`,
    );
  }

  try {
    fs.accessSync(cmakePath, fs.constants.X_OK);
  } catch {
    throw new Error(`Fixed CMake is not executable: ${cmakePath}`);
  }

  let output;
  try {
    output = String(execFileSyncImpl(cmakePath, ['--version'], { encoding: 'utf8' })).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to verify fixed CMake at ${cmakePath}: ${detail}`);
  }

  const match = /^cmake version ([^\s]+)$/m.exec(output);
  const actualVersion = match?.[1] ?? 'unknown';
  if (actualVersion !== EXPECTED_CMAKE_VERSION) {
    throw new Error(
      `Expected CMake ${EXPECTED_CMAKE_VERSION} at ${cmakePath}, found ${actualVersion}. Release will not fall back to the system CMake.`,
    );
  }

  return actualVersion;
}

function createReleasePlan({ projectRoot, cmakePath, prebuildOnly = false }) {
  const plan = [
    {
      label: 'Expo iOS Release prebuild',
      command: path.join(projectRoot, 'node_modules', '.bin', 'expo'),
      args: ['prebuild', '--platform', 'ios', '--clean'],
    },
  ];

  if (!prebuildOnly) {
    plan.push({
      label: 'iOS production device build',
      command: process.execPath,
      args: [path.join(projectRoot, 'scripts', 'ios-device-build.cjs'), 'production'],
    });
  }

  return plan;
}

function runRelease({
  projectRoot,
  cmakePath,
  prebuildOnly = false,
  validateImpl = validateFixedCmake,
  spawnSyncImpl = spawnSync,
}) {
  const version = validateImpl(cmakePath);
  const environment = {
    ...process.env,
    APP_VARIANT: 'production',
    CMAKE_BINARY: cmakePath,
  };

  console.log(`Using fixed CMake ${version}: ${cmakePath}`);
  for (const phase of createReleasePlan({ projectRoot, cmakePath, prebuildOnly })) {
    const result = spawnSyncImpl(phase.command, phase.args, {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${phase.label} exited with status ${String(result.status)}`);
    }
  }
}

function main() {
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--prebuild-only');
  if (unknownArgs.length > 0) {
    throw new Error(`Unsupported ios-release arguments: ${unknownArgs.join(', ')}`);
  }

  runRelease({
    projectRoot: path.resolve(__dirname, '..'),
    cmakePath: fixedCmakePath(),
    prebuildOnly: process.argv.includes('--prebuild-only'),
  });
}

module.exports = {
  EXPECTED_CMAKE_VERSION,
  createReleasePlan,
  fixedCmakePath,
  runRelease,
  validateFixedCmake,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
