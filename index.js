import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const port = process.env.PORT || 8080;
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());

app.get('/', async (req, res) => {
let dbVersion = 'Not connected to database';

try {
  const result = await pool.query('SELECT version()');
  dbVersion = result.rows[0].version;
} catch (error) {
  console.error('CRITICAL: Neon Database Connection or Query Failed:', error.message);
  dbVersion = `Connection Error: ${error.message}`;
}

res.render('index', {
  dbStatus: 'Success',
  dbVersion: dbVersion,
});
});










app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});