CREATE TABLE IF NOT EXISTS contacts(
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, designation TEXT DEFAULT '', phone TEXT NOT NULL,
 phone_norm TEXT NOT NULL, email TEXT DEFAULT '', department TEXT DEFAULT 'CSE', photo_url TEXT DEFAULT '',
 deleted BOOLEAN DEFAULT FALSE, updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_c_phone ON contacts(phone_norm);
CREATE INDEX IF NOT EXISTS ix_c_name ON contacts(lower(name));
CREATE INDEX IF NOT EXISTS ix_c_upd ON contacts(updated_at);
CREATE TABLE IF NOT EXISTS admin(id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(id SERIAL PRIMARY KEY, action TEXT NOT NULL, contact_id INT, detail JSONB, at TIMESTAMPTZ DEFAULT now());
