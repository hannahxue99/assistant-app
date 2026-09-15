import type { ConfigContext, ExpoConfig } from 'expo/config';
import baseAppJson from '../app.json';
import resolveAppConfig, { resolveAppVariant } from '../app.config';

type Variant = 'development' | 'production' | undefined;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  check(actual === expected, `${message}: expected ${String(expected)}, received ${String(actual)}`);
}

function resolve(variant: Variant) {
  if (variant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = variant;
  }

  const context: ConfigContext = {
    config: baseAppJson.expo as unknown as ExpoConfig,
    projectRoot: process.cwd(),
    staticConfigPath: `${process.cwd()}/app.json`,
    packageJsonPath: `${process.cwd()}/package.json`,
  };

  return resolveAppConfig(context);
}

const development = resolve('development');
equal(development.name, '私人助手 Dev', 'Dev name');
equal(development.scheme, 'assistantapp-dev', 'Dev scheme');
equal(development.icon, './assets/images/icon-dev.png', 'Dev icon');
equal(development.ios?.bundleIdentifier, 'com.huanxue.assistantapp.dev', 'Dev iOS Bundle ID');
equal(development.android?.package, 'com.anonymous.assistantapp.dev', 'Dev Android package');
equal(development.ios?.appleTeamId, 'UMP8R97X9B', 'Dev Apple Team');

const production = resolve('production');
equal(production.name, '私人助手', 'Release name');
equal(production.scheme, 'assistantapp', 'Release scheme');
equal(production.icon, './assets/images/icon.png', 'Release icon');
equal(production.ios?.bundleIdentifier, 'com.huanxue.assistantapp', 'Release iOS Bundle ID');
equal(production.android?.package, 'com.anonymous.assistantapp', 'Release Android package');
equal(production.ios?.appleTeamId, 'UMP8R97X9B', 'Release Apple Team');

const defaultVariant = resolve(undefined);
equal(defaultVariant.name, production.name, 'Default name');
equal(defaultVariant.scheme, production.scheme, 'Default scheme');
equal(defaultVariant.ios?.bundleIdentifier, production.ios?.bundleIdentifier, 'Default iOS Bundle ID');
equal(defaultVariant.android?.package, production.android?.package, 'Default Android package');

let invalidVariantError: unknown;
try {
  resolveAppVariant('preview');
} catch (error) {
  invalidVariantError = error;
}
check(
  invalidVariantError instanceof Error && /Unsupported APP_VARIANT: preview/.test(invalidVariantError.message),
  'Unknown variants must fail configuration',
);

delete process.env.APP_VARIANT;

console.log('App variant tests passed');
