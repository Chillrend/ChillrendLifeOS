const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'app.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    status TEXT NOT NULL, -- 'pending', 'denied', 'accepted'
    message_id TEXT,
    channel_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL, -- 'YYYY-MM-DD'
    log_content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = {
  db,
  // Helper methods for transactions
  saveTransaction: (id, payload, status = 'pending') => {
    const stmt = db.prepare('INSERT OR REPLACE INTO transactions (id, payload, status) VALUES (?, ?, ?)');
    return stmt.run(id, JSON.stringify(payload), status);
  },

  updateTransactionMessage: (id, messageId, channelId) => {
    const stmt = db.prepare('UPDATE transactions SET message_id = ?, channel_id = ? WHERE id = ?');
    return stmt.run(messageId, channelId, id);
  },

  updateTransactionStatus: (id, status) => {
    const stmt = db.prepare('UPDATE transactions SET status = ? WHERE id = ?');
    return stmt.run(status, id);
  },

  getTransaction: (id) => {
    const stmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
    const row = stmt.get(id);
    if (!row) return null;
    return {
      ...row,
      payload: JSON.parse(row.payload)
    };
  },

  // Helper methods for daily logs
  saveDailyLog: (date, logContent) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO daily_logs (date, log_content) VALUES (?, ?)');
    return stmt.run(date, logContent);
  },

  getDailyLog: (date) => {
    const stmt = db.prepare('SELECT * FROM daily_logs WHERE date = ?');
    return stmt.get(date);
  },

  getAllDailyLogs: () => {
    const stmt = db.prepare('SELECT * FROM daily_logs ORDER BY date DESC');
    return stmt.all();
  }
};
