/** Queue triggers run inside the same SQLite transaction as every entry write. */
export const calendarSchema = `
CREATE TABLE IF NOT EXISTS calendar_config (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
 calendar_id TEXT, owner_token TEXT NOT NULL, error TEXT
);
INSERT OR IGNORE INTO calendar_config(id,owner_token) VALUES(1,lower(hex(randomblob(16))));
CREATE TABLE IF NOT EXISTS calendar_jobs(entry_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 1, retry_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS calendar_links(
 entry_id TEXT PRIMARY KEY, event_id TEXT, attempt_due INTEGER, last_due INTEGER
);
CREATE TRIGGER IF NOT EXISTS calendar_insert AFTER INSERT ON entries BEGIN
 INSERT INTO calendar_jobs(entry_id) VALUES(NEW.id)
 ON CONFLICT(entry_id) DO UPDATE SET generation=generation+1,retry_at=0;
END;
CREATE TRIGGER IF NOT EXISTS calendar_update AFTER UPDATE ON entries BEGIN
 INSERT INTO calendar_jobs(entry_id) VALUES(NEW.id)
 ON CONFLICT(entry_id) DO UPDATE SET generation=generation+1,retry_at=0;
END;
CREATE TRIGGER IF NOT EXISTS calendar_delete AFTER DELETE ON entries BEGIN
 INSERT INTO calendar_jobs(entry_id) VALUES(OLD.id)
 ON CONFLICT(entry_id) DO UPDATE SET generation=generation+1,retry_at=0;
END;
`;
