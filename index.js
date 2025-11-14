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
            grade_level VARCHAR(20),
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
            meeting_url VARCHAR(255),  -- <--- NEW COLUMN
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

    // --- MODIFIED VALIDATION CHECK ---
    // gradeLevel has been removed from the required list.
    if (!email || !password || !userName || !dateOfBirth) { 
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
            // gradeLevel is included in the parameter array and will be NULL if not provided.
            [email, hashedPassword, userName, dateOfBirth, gradeLevel || null, schoolCollege || null]
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

// POST /api/user/skills/offer - Manages a user's offered skills
app.post('/api/user/skills/offer', async (req, res) => {
    // NOTE: This route requires authentication middleware to ensure the user_id is valid.
    // For now, we assume req.body contains the user_id and an array of skillIds.
    
    const { userId, skillIds } = req.body;
    
    if (!userId || !Array.isArray(skillIds)) {
        return res.status(400).json({ message: 'Missing user ID or skill array.' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Start Transaction
        
        // 1. DELETE existing offered skills for this user
        await client.query('DELETE FROM User_Skills_Offered WHERE user_id = $1', [userId]);
        
        // 2. INSERT the new list of offered skills
        if (skillIds.length > 0) {
            const insertQueries = skillIds.map(skillId => {
                return client.query(
                    'INSERT INTO User_Skills_Offered (user_id, skill_id) VALUES ($1, $2)',
                    [userId, skillId]
                );
            });
            await Promise.all(insertQueries);
        }
        
        await client.query('COMMIT'); // Commit Transaction
        
        res.status(200).json({ 
            message: 'Offered skills updated successfully.', 
            skillsCount: skillIds.length
        });
        
    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        console.error('Error updating offered skills:', error.message);
        res.status(500).json({ message: 'Server error while updating skills.' });
        
    } finally {
        client.release();
    }
});

// PUT /api/skills/:id - Updates an existing skill name (Admin-only access required)
app.put('/api/skills/:id', async (req, res) => {
    // NOTE: Requires admin middleware check.
    const { id } = req.params;
    const { skillName } = req.body;

    if (!skillName) {
        return res.status(400).json({ message: 'New skill name is required.' });
    }

    try {
        const result = await pool.query(
            'UPDATE Skills SET skill_name = $1 WHERE skill_id = $2 RETURNING skill_id, skill_name',
            [skillName, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Skill not found.' });
        }

        res.status(200).json({ 
            message: 'Skill updated successfully.', 
            skill: result.rows[0] 
        });

    } catch (error) {
        console.error('Error updating skill:', error.message);
        res.status(500).json({ message: 'Server error while updating skill.' });
    }
});

// DELETE /api/skills/:id - Deletes a skill (Admin-only access required)
app.delete('/api/skills/:id', async (req, res) => {
    // NOTE: Requires admin middleware check.
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM Skills WHERE skill_id = $1 RETURNING skill_id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Skill not found.' });
        }

        res.status(200).json({ 
            message: 'Skill deleted successfully.',
            deletedId: result.rows[0].skill_id
        });

    } catch (error) {
        console.error('Error deleting skill:', error.message);
        res.status(500).json({ message: 'Server error while deleting skill.' });
    }
});

// POST /api/user/skills/seek - Manages a user's skills they seek (want to learn)
app.post('/api/user/skills/seek', async (req, res) => {
    // NOTE: This route requires authentication middleware to ensure the user_id is valid.
    // For now, we assume req.body contains the user_id and an array of skillIds.
    
    const { userId, skillIds } = req.body;
    
    if (!userId || !Array.isArray(skillIds)) {
        return res.status(400).json({ message: 'Missing user ID or skill array.' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Start Transaction
        
        // 1. DELETE existing sought skills for this user from the junction table
        await client.query('DELETE FROM User_Skills_Sought WHERE user_id = $1', [userId]);
        
        // 2. INSERT the new list of sought skills
        if (skillIds.length > 0) {
            const insertQueries = skillIds.map(skillId => {
                return client.query(
                    'INSERT INTO User_Skills_Sought (user_id, skill_id) VALUES ($1, $2)',
                    [userId, skillId]
                );
            });
            await Promise.all(insertQueries);
        }
        
        await client.query('COMMIT'); // Commit Transaction
        
        res.status(200).json({ 
            message: 'Sought skills updated successfully.', 
            skillsCount: skillIds.length
        });
        
    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        console.error('Error updating sought skills:', error.message);
        res.status(500).json({ message: 'Server error while updating skills.' });
        
    } finally {
        client.release();
    }
});

// POST /api/sessions/request - Creates a new session request
app.post('/api/sessions/request', async (req, res) => {
    // NOTE: This route REQUIRES authentication middleware to ensure user_ids are valid.
    
    const { 
        requesterId, 
        providerId, 
        skillTaughtId, 
        sessionDateTime, 
        locationType,
        meetingUrl // <--- Now accepts the optional meetingUrl
    } = req.body;

    // 1. Input Validation
    if (!requesterId || !providerId || !skillTaughtId || !sessionDateTime || !locationType) {
        return res.status(400).json({ message: 'Missing required session details.' });
    }
    
    // Check against the database constraint for self-session (safety check)
    if (requesterId === providerId) {
        return res.status(400).json({ message: 'Cannot request a session with yourself.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO Sessions (
                provider_id, 
                requester_id, 
                skill_taught_id, 
                session_date_time, 
                location_type, 
                status,
                meeting_url  -- <--- INSERT the URL (will be null on request)
            ) VALUES ($1, $2, $3, $4, $5, 'Requested', $6) 
             RETURNING session_id, status, session_date_time;`,
            [providerId, requesterId, skillTaughtId, sessionDateTime, locationType, meetingUrl || null]
        );

        const newSession = result.rows[0];

        res.status(201).json({ 
            message: 'Session request submitted successfully. Awaiting provider confirmation.', 
            session: newSession
        });

    } catch (error) {
        console.error('Session Request Error:', error.message);
        res.status(500).json({ message: 'Server error while submitting session request.' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});