import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const port = process.env.PORT || 8080;
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());

async function createTables() {
    const tableCreationQueries = `
        CREATE TABLE IF NOT EXISTS Users (
            user_id SERIAL PRIMARY KEY,
            email VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            user_name VARCHAR(100) NOT NULL,
            date_of_birth DATE NOT NULL,
            grade_level VARCHAR(20) NOT NULL,
            school_college VARCHAR(100),
            is_admin BOOLEAN DEFAULT FALSE
        );
        
        CREATE TABLE IF NOT EXISTS Skills (
            skill_id SERIAL PRIMARY KEY,
            skill_name VARCHAR(50) UNIQUE NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS User_Skills_Offered (
            user_skill_id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            skill_id INT NOT NULL REFERENCES Skills(skill_id) ON DELETE CASCADE,
            UNIQUE (user_id, skill_id)
        );
        
        CREATE TABLE IF NOT EXISTS User_Skills_Sought (
            user_skill_id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            skill_id INT NOT NULL REFERENCES Skills(skill_id) ON DELETE CASCADE,
            UNIQUE (user_id, skill_id)
        );
        
        CREATE TABLE IF NOT EXISTS Sessions (
            session_id SERIAL PRIMARY KEY,
            provider_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            requester_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            skill_taught_id INT NOT NULL REFERENCES Skills(skill_id) ON DELETE CASCADE,
            session_date_time TIMESTAMP WITH TIME ZONE NOT NULL,
            location_type VARCHAR(20) NOT NULL,
            status VARCHAR(20) DEFAULT 'Requested',
            CONSTRAINT check_self_session CHECK (provider_id <> requester_id) 
        );
        
        CREATE TABLE IF NOT EXISTS Ratings (
            rating_id SERIAL PRIMARY KEY,
            session_id INT UNIQUE NOT NULL REFERENCES Sessions(session_id) ON DELETE CASCADE,
            rater_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            ratee_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            like_status BOOLEAN NOT NULL,
            feedback_text TEXT,
            CONSTRAINT check_rating_users CHECK (rater_id <> ratee_id)
        );
        
        CREATE TABLE IF NOT EXISTS Reports (
            report_id SERIAL PRIMARY KEY,
            reporter_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            reported_user_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            report_reason VARCHAR(255) NOT NULL,
            report_status VARCHAR(20) DEFAULT 'New',
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS Messages (
            message_id SERIAL PRIMARY KEY,
            sender_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            receiver_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            message_text TEXT NOT NULL,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT FALSE
        );
        
        CREATE TABLE IF NOT EXISTS Admin_Logs (
            log_id SERIAL PRIMARY KEY,
            admin_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            action_type VARCHAR(50) NOT NULL,
            target_table VARCHAR(50),
            target_id INT,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        await pool.query(tableCreationQueries);
        console.log('PostgreSQL: All tables created successfully (or already exist).');
        return true;
    } catch (error) {
        console.error('CRITICAL: Failed to create one or more database tables:', error.message);
        return false;
    }
}

app.get('/', async (req, res) => {
    let dbVersion = 'Not connected to database';
    let dbStatus = 'Failed';
    let tablesStatus = 'Failed';

    const tablesReady = await createTables(); 

    if (tablesReady) {
        tablesStatus = 'Ready';
        try {
            const result = await pool.query('SELECT version()');
            dbVersion = result.rows[0].version;
            dbStatus = 'Success';
        } catch (error) {
            console.error('CRITICAL: Database Version Query Failed:', error.message);
            dbVersion = `Version Query Error: ${error.message}`;
        }
    } else {
        dbVersion = 'Failed to create tables. Check server logs.';
    }

    res.render('index', {
        dbStatus: dbStatus,
        dbVersion: dbVersion,
        tablesStatus: tablesStatus,
    });
});

app.post('/api/register', async (req, res) => {
    const { email, password, userName, dateOfBirth, gradeLevel, schoolCollege } = req.body;

    if (!email || !password || !userName || !dateOfBirth || !gradeLevel) {
        return res.status(400).json({ message: 'Missing required registration fields.' });
    }

    try {
        const checkUser = await pool.query('SELECT user_id FROM Users WHERE email = $1', [email]);
        if (checkUser.rows.length > 0) {
            return res.status(409).json({ message: 'Email address is already registered.' });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const result = await pool.query(
            `INSERT INTO Users (
                email, 
                password_hash, 
                user_name, 
                date_of_birth, 
                grade_level, 
                school_college, 
                is_admin
            ) VALUES ($1, $2, $3, $4, $5, $6, FALSE) 
             RETURNING user_id, user_name, email;`,
            [email, hashedPassword, userName, dateOfBirth, gradeLevel, schoolCollege || null]
        );

        const newUser = result.rows[0];
        res.status(201).json({ 
            message: 'User registered successfully.', 
            user: {
                id: newUser.user_id,
                name: newUser.user_name,
                email: newUser.email,
                isAdmin: false
            }
        });

    } catch (error) {
        console.error('Registration Error:', error.message);
        res.status(500).json({ message: 'Server error during registration.', error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        const result = await pool.query(
            'SELECT user_id, email, password_hash, user_name, is_admin FROM Users WHERE email = $1', 
            [email]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (passwordMatch) {
            res.status(200).json({
                message: 'Login successful.',
                user: {
                    id: user.user_id,
                    name: user.user_name,
                    email: user.email,
                    isAdmin: user.is_admin
                }
            });
        } else {
            res.status(401).json({ message: 'Invalid credentials.' });
        }

    } catch (error) {
        console.error('Login Error:', error.message);
        res.status(500).json({ message: 'Server error during login.', error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});