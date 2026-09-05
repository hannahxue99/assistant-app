export type SingleFlightState<T> = {
  value: T | null;
  pending: Promise<T> | null;
};

/**
 * 同一时刻只执行一次初始化。成功后缓存结果；失败后清空 pending，允许用户重试。
 */
export function runSingleFlight<T>(
  state: SingleFlightState<T>,
  initialize: () => Promise<T>,
): Promise<T> {
  if (state.value) return Promise.resolve(state.value);
  if (state.pending) return state.pending;

  const pending = initialize()
    .then((value) => {
      state.value = value;
      return value;
    })
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      if (state.pending === pending) state.pending = null;
    });
  state.pending = pending;
  return pending;
}
