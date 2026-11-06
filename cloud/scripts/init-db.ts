import { initializeDatabase, pool } from '../src/infra/db.ts';
try { await initializeDatabase(); console.log('Independent cloud database initialized.'); }
finally { await pool.end(); }
