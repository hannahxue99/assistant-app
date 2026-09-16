import { projectLegacyEntries } from './store';

/**
 * 小批量迁移旧原声，避免一次事务处理全部历史。失败可在下次启动续跑。
 */
export async function migrateLegacyEntriesToAssistantHistory(options: {
  batchSize?: number;
  maxBatches?: number;
} = {}): Promise<number> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 200, 1000));
  const maxBatches = Math.max(1, Math.min(options.maxBatches ?? 100, 1000));
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const inserted = await projectLegacyEntries(batchSize);
    total += inserted;
    if (inserted < batchSize) break;
    await Promise.resolve();
  }
  return total;
}
