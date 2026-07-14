-- 0001_init: schema + seed categories

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT NOT NULL DEFAULT '',
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tx_date ON transactions(occurred_on);
CREATE INDEX idx_tx_category ON transactions(category_id);

-- Seed categories
INSERT INTO categories (name, type, sort_order) VALUES
  ('Breakfast', 'expense', 1),
  ('Lunch', 'expense', 2),
  ('Dinner', 'expense', 3),
  ('Night snack', 'expense', 4),
  ('Drink', 'expense', 5),
  ('Daily Necessities', 'expense', 6),
  ('Subscription', 'expense', 7),
  ('Invest', 'expense', 8),
  ('Salary', 'income', 1),
  ('Other', 'income', 2);
