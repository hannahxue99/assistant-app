const assert = require('node:assert/strict');

const {
  createBuildPlan,
  selectPhysicalIosDevice,
} = require('./ios-device-build.cjs');

const devices = [
  {
    simulator: true,
    available: true,
    platform: 'com.apple.platform.iphonesimulator',
    identifier: 'SIMULATOR-ID',
    name: 'iPhone 17',
  },
  {
    simulator: false,
    available: true,
    platform: 'com.apple.platform.iphoneos',
    identifier: 'PHONE-UDID',
    name: 'huan-iphone17',
  },
];

assert.equal(selectPhysicalIosDevice(devices).identifier, 'PHONE-UDID');
assert.equal(selectPhysicalIosDevice(devices, 'huan-iphone17').identifier, 'PHONE-UDID');
assert.equal(selectPhysicalIosDevice(devices, 'PHONE-UDID').name, 'huan-iphone17');
assert.throws(
  () => selectPhysicalIosDevice([...devices, { ...devices[1], identifier: 'SECOND-UDID', name: 'second-phone' }]),
  /Multiple physical iOS devices/,
);
assert.throws(() => selectPhysicalIosDevice(devices, 'missing'), /No matching physical iOS device/);

const development = createBuildPlan({
  projectRoot: '/project',
  variant: 'development',
  deviceIdentifier: 'PHONE-UDID',
  workspaceName: 'Dev',
});
assert.equal(development.configuration, 'Debug');
assert.equal(development.bundleIdentifier, 'com.huanxue.assistantapp.dev');
assert.equal(development.builtAppPath, '/project/.expo/ios-derived-data/development/Build/Products/Debug-iphoneos/Dev.app');
assert.ok(development.xcodebuildArgs.includes('-allowProvisioningUpdates'));
assert.ok(development.xcodebuildArgs.includes('-allowProvisioningDeviceRegistration'));
assert.ok(development.xcodebuildArgs.includes('id=PHONE-UDID'));

const production = createBuildPlan({
  projectRoot: '/project',
  variant: 'production',
  deviceIdentifier: 'PHONE-UDID',
  workspaceName: 'app',
});
assert.equal(production.configuration, 'Release');
assert.equal(production.bundleIdentifier, 'com.huanxue.assistantapp');
assert.equal(production.builtAppPath, '/project/.expo/ios-derived-data/production/Build/Products/Release-iphoneos/app.app');

console.log('iOS device build tests passed');
