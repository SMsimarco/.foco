const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS daily_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    actividad TEXT,
    jornada TEXT,
    energia INTEGER,
    enfoque INTEGER,
    animo INTEGER
  )`);
});

module.exports = db;