#!/usr/bin/env node

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const VARIANTS = {
  development: {
    configuration: 'Debug',
    bundleIdentifier: 'com.huanxue.assistantapp.dev',
  },
  production: {
    configuration: 'Release',
    bundleIdentifier: 'com.huanxue.assistantapp',
  },
};

function selectPhysicalIosDevice(devices, requestedDevice) {
  const availablePhones = devices.filter(
    (device) =>
      device &&
      device.simulator === false &&
      device.available === true &&
      device.platform === 'com.apple.platform.iphoneos',
  );

  if (requestedDevice) {
    const matchedDevice = availablePhones.find(
      (device) =>
        device.identifier === requestedDevice || device.name === requestedDevice,
    );
    if (!matchedDevice) {
      throw new Error(`No matching physical iOS device: ${requestedDevice}`);
    }
    return matchedDevice;
  }

  if (availablePhones.length === 0) {
    throw new Error('No available physical iOS device. Connect and unlock an iPhone.');
  }
  if (availablePhones.length > 1) {
    const choices = availablePhones
      .map((device) => `${device.name} (${device.identifier})`)
      .join(', ');
    throw new Error(`Multiple physical iOS devices are available: ${choices}`);
  }

  return availablePhones[0];
}

function createBuildPlan({
  projectRoot,
  variant,
  deviceIdentifier,
  workspaceName,
}) {
  const variantSettings = VARIANTS[variant];
  if (!variantSettings) {
    throw new Error(`Unsupported iOS build variant: ${variant}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(workspaceName)) {
    throw new Error(`Unsafe iOS workspace name: ${workspaceName}`);
  }

  const derivedDataPath = path.join(
    projectRoot,
    '.expo',
    'ios-derived-data',
    variant,
  );
  const builtAppPath = path.join(
    derivedDataPath,
    'Build',
    'Products',
    `${variantSettings.configuration}-iphoneos`,
    `${workspaceName}.app`,
  );
  const stagedAppPath = path.join(
    projectRoot,
    '.expo',
    'ios-install',
    variant,
    `${workspaceName}.app`,
  );

  return {
    ...variantSettings,
    builtAppPath,
    stagedAppPath,
    xcodebuildArgs: [
      '-workspace',
      path.join(projectRoot, 'ios', `${workspaceName}.xcworkspace`),
      '-scheme',
      workspaceName,
      '-configuration',
      variantSettings.configuration,
      '-destination',
      `id=${deviceIdentifier}`,
      '-derivedDataPath',
      derivedDataPath,
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
      'COCOAPODS_PARALLEL_CODE_SIGN=true',
      'COMPILER_INDEX_STORE_ENABLE=NO',
      'build',
    ],
  };
}

function readAvailableDevices() {
  const output = execFileSync('xcrun', ['xcdevice', 'list'], {
    encoding: 'utf8',
  });
  const jsonStart = output.indexOf('[');
  if (jsonStart < 0) {
    throw new Error('Xcode did not return an iOS device list.');
  }
  return JSON.parse(output.slice(jsonStart));
}

function findGeneratedWorkspace(projectRoot) {
  const iosDirectory = path.join(projectRoot, 'ios');
  const workspaces = fs
    .readdirSync(iosDirectory)
    .filter((name) => name.endsWith('.xcworkspace'));

  if (workspaces.length !== 1) {
    throw new Error(
      `Expected one generated iOS workspace, found: ${workspaces.join(', ') || 'none'}`,
    );
  }

  return workspaces[0].slice(0, -'.xcworkspace'.length);
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${String(result.status)}`);
  }
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const variant = process.argv[2];
  const requestedDevice = process.argv[3];
  const device = selectPhysicalIosDevice(readAvailableDevices(), requestedDevice);
  const workspaceName = findGeneratedWorkspace(projectRoot);
  const plan = createBuildPlan({
    projectRoot,
    variant,
    deviceIdentifier: device.identifier,
    workspaceName,
  });

  console.log(`Building ${variant} for ${device.name} (${device.identifier})...`);
  runOrThrow('xcodebuild', plan.xcodebuildArgs, {
    env: {
      ...process.env,
      RCT_NO_LAUNCH_PACKAGER: 'true',
    },
  });

  if (!fs.existsSync(plan.builtAppPath)) {
    throw new Error(`Built app was not found: ${plan.builtAppPath}`);
  }

  const safeInstallRoot = path.join(projectRoot, '.expo', 'ios-install');
  if (!plan.stagedAppPath.startsWith(`${safeInstallRoot}${path.sep}`)) {
    throw new Error(`Refusing to replace an unsafe install path: ${plan.stagedAppPath}`);
  }
  fs.rmSync(plan.stagedAppPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(plan.stagedAppPath), { recursive: true });
  runOrThrow('ditto', [plan.builtAppPath, plan.stagedAppPath]);

  runOrThrow('xcrun', [
    'devicectl',
    'device',
    'install',
    'app',
    '--device',
    device.identifier,
    plan.stagedAppPath,
  ]);

  console.log(
    `Installed ${plan.bundleIdentifier} on ${device.name}. Open it from the iPhone Home Screen.`,
  );
}

module.exports = {
  createBuildPlan,
  selectPhysicalIosDevice,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
