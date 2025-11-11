import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import morgan from 'morgan';
import pg from 'pg';

const app = express();
const port = process.env.PORT || 8080;
const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});











app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});