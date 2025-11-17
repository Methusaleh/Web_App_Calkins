import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
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
const PgSession = pgSession(session);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    store: new PgSession({
        pool: pool,                  
        tableName: 'session'         
    }),
    secret: process.env.SESSION_SECRET || 'a-long-random-string', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 30 * 24 * 60 * 60 * 1000, // this is 30 days in milliseconds hahahaha
        secure: 'auto' 
    }
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

//checks if user is logged in
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        //user logged in
        req.user = req.session.user; 
        next();
    } else {
        //user not logged in
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
    }
}

//check for admin rights
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) {
        //user is an admin
        req.user = req.session.user;
        next();
    } else {
        //user is not an admin
        res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
    }
}

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
            is_virtual_only BOOLEAN DEFAULT FALSE,
            is_inperson_only BOOLEAN DEFAULT FALSE,
            UNIQUE (user_id, skill_id)
        );
        
        CREATE TABLE IF NOT EXISTS User_Skills_Sought (
            user_skill_id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
            skill_id INT NOT NULL REFERENCES Skills(skill_id) ON DELETE CASCADE,
            is_virtual_only BOOLEAN DEFAULT FALSE,
            is_inperson_only BOOLEAN DEFAULT FALSE,
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
            meeting_url VARCHAR(255),
            cancellation_reason TEXT,
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

        CREATE TABLE IF NOT EXISTS Skill_Suggestions (
            suggestion_id SERIAL PRIMARY KEY,
            suggested_skill_name VARCHAR(100) UNIQUE NOT NULL,
            suggesting_user_id INT REFERENCES Users(user_id) ON DELETE SET NULL,
            status VARCHAR(20) DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected'
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS session (
            sid varchar NOT NULL COLLATE "default",
            sess json NOT NULL,
            expire timestamp(6) with time zone NOT NULL
        );

        ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
        
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
            //creates session and stores user info in session
            req.session.user = {
                id: user.user_id,
                name: user.user_name,
                email: user.email,
                isAdmin: user.is_admin
            };
            
            res.status(200).json({
                message: 'Login successful and session created.',
                user: req.session.user 
            });
        } else {
            res.status(401).json({ message: 'Invalid credentials.' });
        }

    } catch (error) {
        console.error('Login Error:', error.message);
        res.status(500).json({ message: 'Server error during login.', error: error.message });
    }
});

//user submits a new skill name for review
app.post('/api/skills/suggest', isAuthenticated, async (req, res) => {
    
    const { skillName, userId } = req.body; 

    if (!skillName || !userId) {
        return res.status(400).json({ message: 'Skill name and User ID are required.' });
    }

    try {
        //need to check if this skill already exists in BOTH Skills and Skill_Suggestions tables
        const exists = await pool.query(
            'SELECT 1 FROM Skills WHERE skill_name ILIKE $1 UNION ALL SELECT 1 FROM Skill_Suggestions WHERE suggested_skill_name ILIKE $1',
            [skillName]
        );
        
        if (exists.rows.length > 0) {
            return res.status(409).json({ message: 'This skill is already listed or pending review.' });
        }
        
        //insert the suggestion into the table
        const result = await pool.query(
            'INSERT INTO Skill_Suggestions (suggested_skill_name, suggesting_user_id) VALUES ($1, $2) RETURNING suggestion_id',
            [skillName, userId]
        );
        
        res.status(201).json({ 
            message: 'Skill suggestion submitted for review.', 
            suggestionId: result.rows[0].suggestion_id
        });

    } catch (error) {
        console.error('Skill Suggestion Error:', error.message);
        res.status(500).json({ message: 'Server error while submitting suggestion.' });
    }
});

//edits a user's offered skills
app.post('/api/user/skills/offer', isAuthenticated, async (req, res) => {
    
    const { userId, skills } = req.body; 
    
    if (!userId || !Array.isArray(skills)) {
        return res.status(400).json({ message: 'Missing user ID or skill array.' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Start Transaction
        
        //delete existing list
        await client.query('DELETE FROM User_Skills_Offered WHERE user_id = $1', [userId]);
        
        //insert new list of skills offered
        if (skills.length > 0) {
            const insertQueries = skills.map(skill => {
                if (!skill.skillId) return null; 

                //locationType booleans
                const isVirtual = skill.isVirtualOnly || false;
                const isInPerson = skill.isInPersonOnly || false;
                
                return client.query(
                    `INSERT INTO User_Skills_Offered 
                        (user_id, skill_id, is_virtual_only, is_inperson_only) 
                     VALUES ($1, $2, $3, $4)`,
                    [userId, skill.skillId, isVirtual, isInPerson]
                );
            }).filter(q => q !== null); //filter out any queries that are null
            
            await Promise.all(insertQueries);
        }
        
        await client.query('COMMIT'); // Commit Transaction
        
        res.status(200).json({ 
            message: 'Offered skills and location preferences updated successfully.', 
            skillsCount: skills.length
        });
        
    } catch (error) {
        await client.query('ROLLBACK'); //rollback on error
        console.error('Error updating offered skills with location data:', error.message);
        res.status(500).json({ message: 'Server error while updating skills.' });
        
    } finally {
        client.release();
    }
});

//creates a new skill (Admin-only)
app.post('/api/skills', isAdmin, async (req, res) => {
    const { skillName } = req.body;
    
    if (!skillName) {
        return res.status(400).json({ message: 'Skill name is required.' });
    }

    try {
        //check for skill existence
        const existingSkill = await pool.query('SELECT skill_id FROM Skills WHERE skill_name ILIKE $1', [skillName]);
        if (existingSkill.rows.length > 0) {
            return res.status(409).json({ message: 'This skill already exists.' });
        }
        
        //insert new skill into the Skills table
        const result = await pool.query(
            'INSERT INTO Skills (skill_name) VALUES ($1) RETURNING skill_id, skill_name', 
            [skillName]
        );
        
        //log admin action
        await pool.query(
            `INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id)
             VALUES ($1, $2, 'Skills', $3);`,
             [req.user.id, 'Create Skill', result.rows[0].skill_id]
        );
        
        res.status(201).json({ 
            message: 'Skill created successfully.', 
            skill: result.rows[0] 
        });

    } catch (error) {
        console.error('Error creating skill:', error.message);
        res.status(500).json({ message: 'Server error while creating skill.' });
    }
});

//updates an existing skill name (Admin-only)
app.put('/api/skills/:id', isAdmin, async (req, res) => {
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

//deletes a skill (Admin-only)
app.delete('/api/skills/:id', isAdmin, async (req, res) => {
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

//edits a user's sought skills
app.post('/api/user/skills/seek', isAuthenticated, async (req, res) => {
    
    const { userId, skills } = req.body;
    
    if (!userId || !Array.isArray(skills)) {
        return res.status(400).json({ message: 'Missing user ID or skill array.' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Start Transaction
        
        //delete existing  list
        await client.query('DELETE FROM User_Skills_Sought WHERE user_id = $1', [userId]);
        
        //insert new list
        if (skills.length > 0) {
            const insertQueries = skills.map(skill => {
                if (!skill.skillId) return null; 

                const isVirtual = skill.isVirtualOnly || false;
                const isInPerson = skill.isInPersonOnly || false;
                
                return client.query(
                    `INSERT INTO User_Skills_Sought 
                        (user_id, skill_id, is_virtual_only, is_inperson_only) 
                     VALUES ($1, $2, $3, $4)`,
                    [userId, skill.skillId, isVirtual, isInPerson]
                );
            }).filter(q => q !== null); //filter out queries that are null
            
            await Promise.all(insertQueries);
        }
        
        await client.query('COMMIT'); // Commit Transaction
        
        res.status(200).json({ 
            message: 'Sought skills and location preferences updated successfully.', 
            skillsCount: skills.length
        });
        
    } catch (error) {
        await client.query('ROLLBACK'); //rollback on error
        console.error('Error updating sought skills with location data:', error.message);
        res.status(500).json({ message: 'Server error while updating skills.' });
        
    } finally {
        client.release();
    }
});

//creates a new session request
app.post('/api/sessions/request', isAuthenticated, async (req, res) => {
    
    const { 
        requesterId, 
        providerId, 
        skillTaughtId, 
        sessionDateTime, 
        locationType,
        meetingUrl 
    } = req.body;

    //validation
    if (!requesterId || !providerId || !skillTaughtId || !sessionDateTime || !locationType) {
        return res.status(400).json({ message: 'Missing required session details.' });
    }
    
    // make sure requester and provider are not the same
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

//gets all sessions (as requester or provider) for a specific user
app.get('/api/sessions/user/:id', isAuthenticated, async (req, res) => {
    
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT 
                s.session_id,
                s.session_date_time,
                s.location_type,
                s.status,
                s.meeting_url,
                p.user_name AS provider_name,
                r.user_name AS requester_name,
                sk.skill_name AS skill_name
            FROM Sessions s
            JOIN Users p ON s.provider_id = p.user_id 
            JOIN Users r ON s.requester_id = r.user_id 
            JOIN Skills sk ON s.skill_taught_id = sk.skill_id
            WHERE s.provider_id = $1 OR s.requester_id = $1
            ORDER BY s.session_date_time DESC`,
            [id]
        );

        res.status(200).json({ 
            message: 'Session history retrieved successfully.', 
            sessions: result.rows 
        });

    } catch (error) {
        console.error(`Error fetching sessions for user ${id}:`, error.message);
        res.status(500).json({ message: 'Server error while retrieving session history.' });
    }
});

//confirms a session and sets the meeting URL
app.post('/api/sessions/confirm', isAuthenticated, async (req, res) => {
    
    const { sessionId, meetingUrl } = req.body;
    const authenticatedUserId = req.user.id;

    //validation
    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required for confirmation.' });
    }

    try {
        const sessionCheck = await pool.query(
            'SELECT location_type FROM Sessions WHERE session_id = $1',
            [sessionId]
        );
        
        if (sessionCheck.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }
    
        const locationType = sessionCheck.rows[0].location_type;

        if (locationType === 'Online' && !meetingUrl) {
        return res.status(400).json({ message: 'Meeting URL is required for online sessions.' });
        }
    
        if (meetingUrl && meetingUrl.length > 255) {
        return res.status(400).json({ message: 'Meeting URL is too long.' });
        }

        //update the Sessions table
        const result = await pool.query(
            `UPDATE Sessions
             SET status = 'Confirmed',
                 meeting_url = $1
             WHERE session_id = $2
                AND provider_id = $3
                AND status = 'Requested'
             RETURNING session_id, status, meeting_url;`,
            [meetingUrl || null, sessionId, authenticatedUserId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ message: 'Permission denied. Session not found, not pending, or you are not the provider.' });
        }

        res.status(200).json({ 
            message: 'Session confirmed and meeting URL set.', 
            session: result.rows[0] 
        });

    } catch (error) {
        console.error('Session Confirmation Error:', error.message);
        res.status(500).json({ message: 'Server error while confirming session.' });
    }
});

//Denies a pending request or cancels a confirmed session
app.post('/api/sessions/deny', isAuthenticated, async (req, res) => {
    
    const { sessionId, reason } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required for denial/cancellation.' });
    }

    try {
        //current session status
        const currentSession = await pool.query(
            'SELECT status, provider_id, requester_id FROM Sessions WHERE session_id = $1',
            [sessionId]
        );

        if (currentSession.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        const currentStatus = currentSession.rows[0].status;
        let newStatus;

        //change status based on current status
        if (currentStatus === 'Requested') {
            newStatus = 'Denied'; //deny
        } else if (currentStatus === 'Confirmed') {
            newStatus = 'Cancelled'; //cancel
        } else {
            //stops status from changing if it's already deny, cancel, or complete
            return res.status(400).json({ message: `Cannot change status from ${currentStatus}.` });
        }

        //update table
        const result = await pool.query(
            `UPDATE Sessions
             SET status = $1,
                 cancellation_reason = $2 -- Assuming you will add this column for audit/feedback
             WHERE session_id = $3
             RETURNING session_id, status;`,
            [newStatus, reason || 'No reason provided', sessionId]
        );

        res.status(200).json({ 
            message: `Session status updated to ${newStatus}.`, 
            session: result.rows[0] 
        });

    } catch (error) {
        console.error('Session Denial/Cancellation Error:', error.message);
        res.status(500).json({ message: 'Server error while denying/cancelling session.' });
    }
});

//marks session as complete, makes it ready for rating
app.post('/api/sessions/complete', isAuthenticated, async (req, res) => {
    
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required to mark as complete.' });
    }

    try {
        //set status to complete if currently confirmed
        const result = await pool.query(
            `UPDATE Sessions
             SET status = 'Completed'
             WHERE session_id = $1 AND status = 'Confirmed'
             RETURNING session_id, status;`,
            [sessionId]
        );

        if (result.rows.length === 0) {
            //error if wrong session ID or not confirmed
            return res.status(400).json({ message: 'Session not found or cannot be completed (must be confirmed first).' });
        }

        // This success response is what the frontend (EJS client-side JS) should listen for 
        // to then redirect the user to the rating/feedback form.
        res.status(200).json({ 
            message: 'Session successfully marked as Completed. Ready for rating and feedback.', 
            session: result.rows[0] 
        });

    } catch (error) {
        console.error('Session Completion Error:', error.message);
        res.status(500).json({ message: 'Server error while marking session as complete.' });
    }
});

//posts a rating and feedback (optional)
app.post('/api/sessions/rate', isAuthenticated, async (req, res) => {
    
    const { 
        sessionId, 
        raterId, 
        rateeId, 
        likeStatus, 
        feedbackText 
    } = req.body;
    
    //validation
    if (!sessionId || !raterId || !rateeId || likeStatus === undefined) {
        return res.status(400).json({ message: 'Missing required rating fields (Session, Rater, Ratee, Like Status).' });
    }

    //can't rate yourself
    if (raterId === rateeId) {
        return res.status(400).json({ message: 'A user cannot rate themselves.' });
    }

    try {
        //make sure session status is complete
        const sessionCheck = await pool.query(
            'SELECT status FROM Sessions WHERE session_id = $1',
            [sessionId]
        );
        
        if (sessionCheck.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        if (sessionCheck.rows[0].status !== 'Completed') {
            return res.status(403).json({ message: 'Cannot rate a session unless it is marked as Completed.' });
        }
        
        //insert for rating and feedback
        const result = await pool.query(
            `INSERT INTO Ratings (
                session_id, 
                rater_id, 
                ratee_id, 
                like_status, 
                feedback_text
            ) VALUES ($1, $2, $3, $4, $5) 
             RETURNING rating_id, like_status;`,
            [sessionId, raterId, rateeId, likeStatus, feedbackText || null]
        );

        res.status(201).json({ 
            message: 'Rating and feedback submitted successfully.', 
            rating: result.rows[0] 
        });

    } catch (error) {
        //this is so you don't rate something twice
        if (error.code === '23505') { 
            return res.status(409).json({ message: 'This session has already been rated.' });
        }
        
        console.error('Rating Submission Error:', error.message);
        res.status(500).json({ message: 'Server error while submitting rating.' });
    }
});

//gets rating data for a specific user
app.get('/api/user/ratings/:id', async (req, res) => {
    
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT 
                COUNT(r.rating_id) AS total_ratings_received,
                SUM(CASE WHEN r.like_status = TRUE THEN 1 ELSE 0 END) AS total_likes
            FROM Ratings r
            WHERE r.ratee_id = $1`,
            [id]
        );

        const ratingSummary = result.rows[0];

        // had to add this to make sure 0 is returned instead of null
        if (!ratingSummary.total_ratings_received) {
             ratingSummary.total_ratings_received = 0;
             ratingSummary.total_likes = 0;
        }

        res.status(200).json({ 
            message: 'User rating summary retrieved successfully.', 
            ratings: ratingSummary 
        });

    } catch (error) {
        console.error(`Error fetching ratings for user ${id}:`, error.message);
        res.status(500).json({ message: 'Server error while retrieving ratings.' });
    }
});

//gets all pending skill suggestions (Admin-only)
app.get('/api/admin/suggestions', isAdmin, async (req, res) => {
    
    try {
        const result = await pool.query(
            `SELECT 
                s.suggestion_id,
                s.suggested_skill_name,
                u.user_name AS suggesting_user,
                s.status,
                s.timestamp
            FROM Skill_Suggestions s
            LEFT JOIN Users u ON s.suggesting_user_id = u.user_id
            WHERE s.status = 'Pending'
            ORDER BY s.timestamp ASC;`
        );

        res.status(200).json({ 
            message: 'Pending skill suggestions retrieved successfully.', 
            suggestions: result.rows 
        });

    } catch (error) {
        console.error('Admin Fetch Suggestions Error:', error.message);
        res.status(500).json({ message: 'Server error retrieving skill suggestions.' });
    }
});

//approves or rejects a skill suggestion (Admin-only)
app.post('/api/admin/suggestions/action', isAdmin, async (req, res) => {
    
    const { suggestionId, action } = req.body;

    if (!suggestionId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ message: 'Suggestion ID and valid action (approve/reject) are required.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Start Transaction
        
        //get list of pending suggestions
        const suggestionResult = await client.query(
            'SELECT suggested_skill_name FROM Skill_Suggestions WHERE suggestion_id = $1 AND status = $2',
            [suggestionId, 'Pending']
        );

        if (suggestionResult.rows.length === 0) {
            await client.query('COMMIT');
            return res.status(404).json({ message: 'Suggestion not found or already processed.' });
        }

        const skillName = suggestionResult.rows[0].suggested_skill_name;
        let finalMessage = '';
        let targetId = null;

        if (action === 'approve') {
            //approve and move skill into Skill table
            const newSkill = await client.query(
                'INSERT INTO Skills (skill_name) VALUES ($1) RETURNING skill_id',
                [skillName]
            );
            targetId = newSkill.rows[0].skill_id;
            finalMessage = `Skill "${skillName}" approved and added to master list.`;
        } else {
            //reject suggestion
            finalMessage = `Suggestion "${skillName}" rejected.`;
        }

        //update suggestion status
        await client.query(
            'UPDATE Skill_Suggestions SET status = $1 WHERE suggestion_id = $2',
            [action === 'approve' ? 'Approved' : 'Rejected', suggestionId]
        );
        
        //log admin action
        await client.query(
            `INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id)
             VALUES ($1, $2, 'Skill_Suggestions', $3);`,
             [req.user.id, action === 'approve' ? 'Approve Skill' : 'Reject Skill', suggestionId] 
        );

        await client.query('COMMIT'); // Commit Transaction
        
        res.status(200).json({ 
            message: finalMessage,
            skillId: targetId
        });

    } catch (error) {
        await client.query('ROLLBACK'); //rollback on error
        console.error(`Error processing skill suggestion (${action}):`, error.message);
        //this is if admin adds skill while approving suggestion
        if (error.code === '23505' && action === 'approve') {
            return res.status(409).json({ message: 'Error: This skill already exists in the master list.' });
        }
        res.status(500).json({ message: 'Server error while processing skill suggestion.' });

    } finally {
        client.release();
    }
});

//gets a list of all users for Admins
app.get('/api/admin/users', isAdmin, async (req, res) => {

    try {
        const result = await pool.query(
            `SELECT 
                user_id,
                email,
                user_name,
                date_of_birth,
                grade_level,
                school_college,
                is_admin
            FROM Users
            ORDER BY user_id ASC;`
        );

        res.status(200).json({ 
            message: 'User list retrieved successfully.', 
            users: result.rows 
        });

    } catch (error) {
        console.error('Admin Fetch Users Error:', error.message);
        res.status(500).json({ message: 'Server error while retrieving user list.' });
    }
});

//gets all security reports for Admin review
app.get('/api/admin/reports', isAdmin, async (req, res) => {

    try {
        const result = await pool.query(
            `SELECT 
                r.report_id,
                r.report_reason,
                r.report_status,
                r.timestamp,
                reporter.user_name AS reporter_name,
                reported.user_name AS reported_user_name,
                reported.user_id AS reported_user_id
            FROM Reports r
            JOIN Users reporter ON r.reporter_id = reporter.user_id 
            JOIN Users reported ON r.reported_user_id = reported.user_id
            ORDER BY r.timestamp DESC;`
        );

        res.status(200).json({ 
            message: 'All security reports retrieved successfully.', 
            reports: result.rows 
        });

    } catch (error) {
        console.error('Admin Report Fetch Error:', error.message);
        res.status(500).json({ message: 'Server error while retrieving reports.' });
    }
});

//updates the status of a specific report(Admin-only)
app.post('/api/admin/report/:id/status', isAdmin, async (req, res) => {
    
    const { id } = req.params;
    const { newStatus } = req.body; //'Under Review', 'Action Taken', 'Closed'

    //validation
    if (!newStatus) {
        return res.status(400).json({ message: 'New status is required.' });
    }

    try {
        //update the Reports table
        const result = await pool.query(
            `UPDATE Reports
             SET report_status = $1
             WHERE report_id = $2
             RETURNING report_id, report_status, reported_user_id;`,
            [newStatus, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Report not found.' });
        }
        
        const updatedReport = result.rows[0];
        
        //log the admin action
        await pool.query(
            `INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id)
             VALUES ($1, $2, 'Reports', $3);`,
             [req.user.id, 'Update Report Status', updatedReport.report_id]
        );

        res.status(200).json({ 
            message: `Report ${updatedReport.report_id} status updated to ${updatedReport.report_status}.`, 
            report: updatedReport
        });

    } catch (error) {
        console.error('Admin Update Report Status Error:', error.message);
        res.status(500).json({ message: 'Server error while updating report status.' });
    }
});

//deletes a user account and cascades the deletion (Admin-only)
app.delete('/api/admin/users/:id', isAdmin, async (req, res) => {
    
    const { id } = req.params;

    try {
        //delete user
        const result = await pool.query(
            'DELETE FROM Users WHERE user_id = $1 RETURNING user_id, email, user_name',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User account not found.' });
        }
        
        const deletedUser = result.rows[0];

        //log admin action
        await pool.query(
            `INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id)
             VALUES ($1, $2, 'Users', $3);`,
             [req.user.id, 'Delete User Account', deletedUser.user_id]
        );

        res.status(200).json({ 
            message: `User ${deletedUser.user_name} (ID: ${deletedUser.user_id}) and all associated data deleted successfully.`, 
            deletedUserId: deletedUser.user_id
        });

    } catch (error) {
        console.error('Admin User Deletion Error:', error.message);
        res.status(500).json({ message: 'Server error while deleting user account.' });
    }
});

//destroys the current session
app.post('/api/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ message: 'Could not log out, please try again.' });
            }
            res.status(200).json({ message: 'Logout successful.' });
        });
    } else {
        res.status(200).json({ message: 'No active session to destroy.' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});