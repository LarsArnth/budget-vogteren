
-- Database schema for Budget-Vogteren (Spiir Replacement)

-- Overordnet kategorisering
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    main_category TEXT NOT NULL,
    sub_category TEXT NOT NULL,
    UNIQUE(main_category, sub_category)
);

-- Alle bank-poster
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, -- Spiir ID eller hash af data
    date TEXT NOT NULL,
    description TEXT,
    original_description TEXT,
    amount REAL NOT NULL,
    category_id INTEGER,
    account_name TEXT,
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

-- "Hjernen" (beskrivelse -> kategori)
CREATE TABLE IF NOT EXISTS mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT UNIQUE NOT NULL,
    category_id INTEGER NOT NULL,
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

-- MobilePay special-mapping (navn -> kategori)
CREATE TABLE IF NOT EXISTS mobilepay_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category_id INTEGER NOT NULL,
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

-- Budgetter per måned
CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    FOREIGN KEY(category_id) REFERENCES categories(id),
    UNIQUE(category_id, year, month)
);
