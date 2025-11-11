import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';
import morgan from 'morgan';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 8080;
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());

app.get('/', (req, res) => {
  res.send('BPA Express Server is running');
});









app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});