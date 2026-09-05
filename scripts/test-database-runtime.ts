import { runSingleFlight, type SingleFlightState } from '../src/engine/single-flight';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const state: SingleFlightState<{ id: number }> = { value: null, pending: null };
  let calls = 0;
  const initialize = async () => {
    calls += 1;
    await Promise.resolve();
    return { id: calls };
  };

  const [first, second] = await Promise.all([
    runSingleFlight(state, initialize),
    runSingleFlight(state, initialize),
  ]);
  check(calls === 1, '并发调用必须共享一次初始化');
  check(first === second, '并发调用必须拿到同一个实例');
  check(await runSingleFlight(state, initialize) === first, '成功后必须复用实例');

  const retryState: SingleFlightState<string> = { value: null, pending: null };
  let attempts = 0;
  const failOnce = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('first attempt failed');
    return 'ready';
  };

  let failed = false;
  try {
    await runSingleFlight(retryState, failOnce);
  } catch (error) {
    failed = error instanceof Error && error.message === 'first attempt failed';
  }
  check(failed, '第一次初始化应透传失败');
  check(retryState.pending === null, '失败后必须允许重试');
  check(await runSingleFlight(retryState, failOnce) === 'ready', '第二次初始化应成功');
  check(attempts === 2, '失败后应只重试一次');

  console.log('database runtime tests passed');
}

void main();
