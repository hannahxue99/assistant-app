import { withDatabaseConnection, withExclusiveDatabaseTransaction } from '../db';
import { addMemorySourceWithDatabase, createMemoryWithDatabase, deterministicMemoryId } from './memory-store';

const MIGRATION_KEY = 'profile-to-long-term-memory-v1';

export async function migrateProfileToLongTermMemories(): Promise<number> {
  const complete = await withDatabaseConnection(database => database.getFirstAsync(
    'SELECT migration_key FROM assistant_migrations WHERE migration_key=?', MIGRATION_KEY,
  ));
  if (complete) return 0;

  return withExclusiveDatabaseTransaction(async (database) => {
    const already = await database.getFirstAsync(
      'SELECT migration_key FROM assistant_migrations WHERE migration_key=?', MIGRATION_KEY,
    );
    if (already) return 0;
    const profile = await database.getFirstAsync<any>('SELECT goals, avoid FROM profile WHERE id=1');
    const parse = (value: string | null | undefined) => {
      try {
        const result = JSON.parse(value || '[]');
        return Array.isArray(result) ? result.map(String).map(item => item.trim()).filter(Boolean) : [];
      } catch {
        return [];
      }
    };
    const items = [
      ...parse(profile?.avoid).map(content => ({ category: 'preference' as const, status: 'active' as const, content })),
      ...parse(profile?.goals).map(content => ({ category: 'long_term_goal' as const, status: 'candidate' as const, content })),
    ];
    let inserted = 0;
    for (const [index, item] of items.entries()) {
      const id = deterministicMemoryId(MIGRATION_KEY, `${item.category}:${item.content}`);
      const existing = await database.getFirstAsync('SELECT id FROM assistant_memories WHERE id=?', id);
      if (existing) continue;
      const memory = await createMemoryWithDatabase(database, {
        id,
        category: item.category,
        content: item.content,
        status: item.status,
        sensitivity: 'ordinary',
        admissionBasis: 'profile_migration',
        createdAt: Date.now() + index,
      });
      await addMemorySourceWithDatabase(database, {
        id: `${memory.id}-profile-source`,
        memoryId: memory.id,
        sourceMessageId: null,
        evidence: item.content,
        createdAt: memory.createdAt,
      });
      inserted += 1;
    }
    await database.runAsync(
      'INSERT INTO assistant_migrations (migration_key, completed_at) VALUES (?, ?)',
      MIGRATION_KEY, Date.now(),
    );
    return inserted;
  });
}
