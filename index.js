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

// setup for the express app and database connection
const app = express();
const port = process.env.PORT || 8080;
const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PgSession = pgSession(session);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// configure the view engine to use ejs templates
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// configure session middleware to store logins in the database
app.use(session({
    store: new PgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'a-long-random-string-placeholder', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: 'auto' 
    }
}));

// setup standard middleware for parsing data and logging
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// middleware to check if a user is logged in
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        req.user = req.session.user; 
        next();
    } else {
        if (req.originalUrl.startsWith('/api/')) {
            res.status(401).json({ message: 'Unauthorized. Please log in.' });
        } else {
            res.redirect('/'); 
        }
    }
}

// middleware to check if a user is an administrator
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) {
        req.user = req.session.user;
        next();
    } else {
        if (req.originalUrl.startsWith('/api/')) {
            res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
        } else {
            res.redirect('/'); 
        }
    }
}

// function to create database tables if they do not exist
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
            is_admin BOOLEAN DEFAULT FALSE,
            avatar_style VARCHAR(50) DEFAULT 'bottts'
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
            status VARCHAR(20) DEFAULT 'Pending', 
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS session (
            sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
            sess json NOT NULL,
            expire timestamp(6) with time zone NOT NULL
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
        console.log('PostgreSQL: All tables created successfully.');
        return true;
    } catch (error) {
        console.error('CRITICAL: Failed to create tables:', error.message);
        return false;
    }
}


// landing page route
app.get('/', (req, res) => {
    // if user is logged in send them to dashboard
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('landing');
});

// dashboard route
app.get('/dashboard', async (req, res) => {
    let dbStatus = 'Failed';
    let dbVersion = 'Error';
    
    // setup database tables
    const tablesReady = await createTables(); 
    const user = req.session.user || null; 
    let topTeachers = [];

    if (tablesReady) {
        try {
            // check connection
            const result = await pool.query('SELECT version()');
            dbVersion = result.rows[0].version;
            dbStatus = 'Success';

            // get top rated teachers
            const topTeachersRes = await pool.query(
                `SELECT u.user_id, u.user_name, u.avatar_style, COUNT(r.rating_id) as like_count
                 FROM Users u
                 JOIN Ratings r ON u.user_id = r.ratee_id
                 WHERE r.like_status = TRUE
                 GROUP BY u.user_id, u.user_name, u.avatar_style
                 ORDER BY like_count DESC LIMIT 3`
            );
            topTeachers = topTeachersRes.rows;
        } catch (error) { 
            console.error('db error:', error.message); 
        }
    }

    // render the main app view
    res.render('index', { dbStatus, dbVersion, user, topTeachers });
});

// login route fix
app.get('/login', (req, res) => {
    res.redirect('/dashboard');
});

// loads the registration page if the user is not logged in
app.get('/register', async (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('register', { pageTitle: 'Register', user: null });
});

// handles user registration by saving new account details to the database
app.post('/api/register', async (req, res) => {
    const { email, password, userName, dateOfBirth, gradeLevel, schoolCollege, avatarStyle } = req.body;
    if (!email || !password || !userName || !dateOfBirth) return res.status(400).json({ message: 'Missing fields.' });

    try {
        const checkUser = await pool.query('SELECT user_id FROM Users WHERE email = $1', [email]);
        if (checkUser.rows.length > 0) return res.status(409).json({ message: 'Email already registered.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO Users (email, password_hash, user_name, date_of_birth, grade_level, school_college, is_admin, avatar_style) 
             VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7) RETURNING user_id, user_name, email`,
            [email, hashedPassword, userName, dateOfBirth, gradeLevel || null, schoolCollege || null, avatarStyle || 'bottts']
        );
        res.status(201).json({ message: 'Registered successfully.', user: result.rows[0] });
    } catch (error) { res.status(500).json({ message: 'Server error.', error: error.message }); }
});

// handles user login by verifying password and creating a session
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required.' });

    try {
        const result = await pool.query(
            'SELECT user_id, email, password_hash, user_name, is_admin, avatar_style FROM Users WHERE email = $1', 
            [email]
        );
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        req.session.user = {
            id: user.user_id,
            name: user.user_name,
            email: user.email,
            isAdmin: user.is_admin,
            avatarStyle: user.avatar_style || 'bottts'
        };
        res.status(200).json({ message: 'Login successful.', user: req.session.user });
    } catch (error) { res.status(500).json({ message: 'Login error.', error: error.message }); }
});

// logs the user out by destroying the current session
app.post('/api/logout', (req, res) => {
    if (req.session) req.session.destroy(err => {
        if (err) return res.status(500).json({ message: 'Logout failed.' });
        res.status(200).json({ message: 'Logout successful.' });
    });
    else res.status(200).json({ message: 'No session.' });
});


// renders the profile editing page and loads the master list of skills
app.get('/profile/edit', isAuthenticated, async (req, res) => {
    try {
        const skillsResult = await pool.query('SELECT skill_id, skill_name FROM Skills ORDER BY skill_name ASC');
        res.render('profile_edit', { pageTitle: 'Edit Profile', user: req.user, masterSkills: skillsResult.rows });
    } catch (error) { res.status(500).send('Error loading profile.'); }
});

// renders the public view of a user profile with skills and ratings
app.get('/profile/view/:id', isAuthenticated, async (req, res) => {
    const targetId = req.params.id;
    try {
        const [userRes, offeredRes, soughtRes, ratingRes] = await Promise.all([
            pool.query('SELECT user_id, user_name, grade_level, school_college, email, avatar_style FROM Users WHERE user_id = $1', [targetId]),
            pool.query('SELECT s.skill_name, uso.is_virtual_only, uso.is_inperson_only FROM User_Skills_Offered uso JOIN Skills s ON uso.skill_id = s.skill_id WHERE uso.user_id = $1', [targetId]),
            pool.query('SELECT s.skill_name FROM User_Skills_Sought uss JOIN Skills s ON uss.skill_id = s.skill_id WHERE uss.user_id = $1', [targetId]),
            pool.query('SELECT COUNT(rating_id) AS total, SUM(CASE WHEN like_status = TRUE THEN 1 ELSE 0 END) AS likes FROM Ratings WHERE ratee_id = $1', [targetId])
        ]);

        if (userRes.rows.length === 0) return res.status(404).send("User not found.");
        
        const ratings = ratingRes.rows[0];
        const percent = ratings.total > 0 ? Math.round((ratings.likes / ratings.total) * 100) : 0;

        res.render('profile_view', {
            pageTitle: `${userRes.rows[0].user_name}'s Profile`,
            user: req.user,
            profile: userRes.rows[0],
            skillsOffered: offeredRes.rows,
            skillsSought: soughtRes.rows,
            ratingStats: { count: ratings.total, likes: ratings.likes, percent }
        });
    } catch (error) { res.status(500).send('Error loading profile.'); }
});

// updates the basic profile info like name and grade level
app.put('/api/user/profile/:id', isAuthenticated, async (req, res) => {
    if (req.user.id !== parseInt(req.params.id)) return res.status(403).json({ message: 'Access denied.' });
    const { userName, gradeLevel, avatarStyle } = req.body;

    try {
        const result = await pool.query(
            'UPDATE Users SET user_name = $1, grade_level = $2, avatar_style = $3 WHERE user_id = $4 RETURNING user_name, avatar_style',
            [userName, gradeLevel || null, avatarStyle || 'bottts', req.params.id]
        );
        req.session.user.name = result.rows[0].user_name;
        req.session.user.avatarStyle = result.rows[0].avatar_style;
        req.session.save();
        res.status(200).json({ message: 'Profile updated.' });
    } catch (error) { res.status(500).json({ message: 'Update failed.' }); }
});

// fetches the current list of skills a user offers and seeks
app.get('/api/user/skills/:id', isAuthenticated, async (req, res) => {
    try {
        const offered = await pool.query('SELECT skill_id, is_virtual_only, is_inperson_only FROM User_Skills_Offered WHERE user_id = $1', [req.params.id]);
        const sought = await pool.query('SELECT skill_id, is_virtual_only, is_inperson_only FROM User_Skills_Sought WHERE user_id = $1', [req.params.id]);
        res.status(200).json({ offered: offered.rows, sought: sought.rows });
    } catch (error) { res.status(500).json({ message: 'Error fetching skills.' }); }
});

// updates the skills a user offers by clearing the old list and inserting new ones
app.post('/api/user/skills/offer', isAuthenticated, async (req, res) => {
    const { userId, skills } = req.body; 
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM User_Skills_Offered WHERE user_id = $1', [userId]);
        if (skills.length > 0) {
            const queries = skills.map(s => client.query(
                'INSERT INTO User_Skills_Offered (user_id, skill_id, is_virtual_only, is_inperson_only) VALUES ($1, $2, $3, $4)',
                [userId, s.skillId, s.isVirtualOnly || false, s.isInPersonOnly || false]
            ));
            await Promise.all(queries);
        }
        await client.query('COMMIT');
        res.status(200).json({ message: 'Offered skills updated.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: 'Update failed.' });
    } finally { client.release(); }
});

// updates the skills a user wants to learn by clearing old ones and inserting new ones
app.post('/api/user/skills/seek', isAuthenticated, async (req, res) => {
    const { userId, skills } = req.body; 
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM User_Skills_Sought WHERE user_id = $1', [userId]);
        if (skills.length > 0) {
            const queries = skills.map(s => client.query(
                'INSERT INTO User_Skills_Sought (user_id, skill_id, is_virtual_only, is_inperson_only) VALUES ($1, $2, $3, $4)',
                [userId, s.skillId, s.isVirtualOnly || false, s.isInPersonOnly || false]
            ));
            await Promise.all(queries);
        }
        await client.query('COMMIT');
        res.status(200).json({ message: 'Sought skills updated.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: 'Update failed.' });
    } finally { client.release(); }
});

// allows a user to suggest a new skill to be added to the master list
app.post('/api/skills/suggest', isAuthenticated, async (req, res) => {
    const { skillName, userId } = req.body; 
    try {
        const exists = await pool.query('SELECT 1 FROM Skills WHERE skill_name ILIKE $1 UNION ALL SELECT 1 FROM Skill_Suggestions WHERE suggested_skill_name ILIKE $1', [skillName]);
        if (exists.rows.length > 0) return res.status(409).json({ message: 'Skill already exists or is pending.' });
        
        await pool.query('INSERT INTO Skill_Suggestions (suggested_skill_name, suggesting_user_id) VALUES ($1, $2)', [skillName, userId]);
        res.status(201).json({ message: 'Skill suggested successfully.' });
    } catch (error) { res.status(500).json({ message: 'Suggestion failed.' }); }
});


// =================================================================
// 3. SESSIONS & MESSAGES
// =================================================================

// loads the session request form
app.get('/session/request', isAuthenticated, async (req, res) => {
    try {
        const skillsResult = await pool.query('SELECT skill_id, skill_name FROM Skills ORDER BY skill_name ASC');
        res.render('session_request', { pageTitle: 'Request Session', user: req.user, skills: skillsResult.rows });
    } catch (error) { res.status(500).send('Error loading form.'); }
});

// renders the main dashboard for managing sessions
app.get('/my_sessions', isAuthenticated, (req, res) => {
    res.render('my_sessions', { pageTitle: 'My Sessions', user: req.user });
});

// renders the rating form for a completed session
app.get('/session/rate/:id', isAuthenticated, async (req, res) => {
    try {
        const res1 = await pool.query('SELECT s.*, u.user_name as provider_name FROM Sessions s JOIN Users u ON s.provider_id = u.user_id WHERE s.session_id = $1', [req.params.id]);
        if (res1.rows.length === 0) return res.status(404).send('Session not found');
        const session = res1.rows[0];
        if (session.requester_id !== req.user.id || session.status !== 'Completed') return res.status(403).send('Invalid session for rating.');
        res.render('rating_form', { pageTitle: 'Rate Session', user: req.user, session });
    } catch (err) { res.status(500).send('Error'); }
});

// finds users who teach a specific skill to populate the dropdown
app.get('/api/skills/:id/providers', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.user_id, u.user_name FROM Users u JOIN User_Skills_Offered uso ON u.user_id = uso.user_id WHERE uso.skill_id = $1 AND u.is_admin = FALSE AND u.user_id != $2 ORDER BY u.user_name`,
            [req.params.id, req.user.id]
        );
        res.status(200).json({ providers: result.rows });
    } catch (error) { res.status(500).json({ message: 'Error fetching providers.' }); }
});

// creates a new session request
app.post('/api/sessions/request', isAuthenticated, async (req, res) => {
    const { requesterId, providerId, skillTaughtId, sessionDateTime, locationType, meetingUrl } = req.body;
    if (!requesterId || !providerId || !sessionDateTime) return res.status(400).json({ message: 'Missing fields.' });
    if (requesterId === providerId) return res.status(400).json({ message: 'Cannot request self.' });

    try {
        await pool.query(
            `INSERT INTO Sessions (provider_id, requester_id, skill_taught_id, session_date_time, location_type, status, meeting_url) 
             VALUES ($1, $2, $3, $4, $5, 'Requested', $6)`,
            [providerId, requesterId, skillTaughtId, sessionDateTime, locationType, meetingUrl || null]
        );
        res.status(201).json({ message: 'Request sent.' });
    } catch (error) { res.status(500).json({ message: 'Request failed.' }); }
});

// fetches the full history of sessions for a user
app.get('/api/sessions/user/:id', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.*, p.user_name AS provider_name, r.user_name AS requester_name, sk.skill_name AS skill_name,
            (CASE WHEN rt.rating_id IS NOT NULL THEN TRUE ELSE FALSE END) AS is_rated
            FROM Sessions s
            JOIN Users p ON s.provider_id = p.user_id 
            JOIN Users r ON s.requester_id = r.user_id 
            JOIN Skills sk ON s.skill_taught_id = sk.skill_id
            LEFT JOIN Ratings rt ON s.session_id = rt.session_id
            WHERE s.provider_id = $1 OR s.requester_id = $1 ORDER BY s.session_date_time DESC`,
            [req.params.id]
        );
        res.status(200).json({ sessions: result.rows });
    } catch (error) { res.status(500).json({ message: 'Error fetching history.' }); }
});

// allows a provider to confirm a session request
app.post('/api/sessions/confirm', isAuthenticated, async (req, res) => {
    const { sessionId, meetingUrl } = req.body;
    try {
        const result = await pool.query(
            `UPDATE Sessions SET status = 'Confirmed', meeting_url = $1 WHERE session_id = $2 AND provider_id = $3 AND status = 'Requested' RETURNING session_id`,
            [meetingUrl || null, sessionId, req.user.id]
        );
        if (result.rows.length === 0) return res.status(403).json({ message: 'Permission denied.' });
        res.status(200).json({ message: 'Session confirmed.' });
    } catch (error) { res.status(500).json({ message: 'Error confirming.' }); }
});

// allows a user to deny or cancel a session
app.post('/api/sessions/deny', isAuthenticated, async (req, res) => {
    const { sessionId, reason } = req.body;
    try {
        const sessionRes = await pool.query('SELECT status, requester_id FROM Sessions WHERE session_id = $1', [sessionId]);
        if (sessionRes.rows.length === 0) return res.status(404).json({ message: 'Not found.' });
        
        const newStatus = (req.user.id === sessionRes.rows[0].requester_id) ? 'Cancelled' : 'Denied';
        await pool.query('UPDATE Sessions SET status = $1, cancellation_reason = $2 WHERE session_id = $3', [newStatus, reason || 'User action', sessionId]);
        res.status(200).json({ message: `Session ${newStatus}.` });
    } catch (error) { res.status(500).json({ message: 'Error denying.' }); }
});

// marks a confirmed session as complete
app.post('/api/sessions/complete', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query("UPDATE Sessions SET status = 'Completed' WHERE session_id = $1 AND status = 'Confirmed' RETURNING session_id", [req.body.sessionId]);
        if (result.rows.length === 0) return res.status(400).json({ message: 'Error completing.' });
        res.status(200).json({ message: 'Session completed.' });
    } catch (e) { res.status(500).json({ message: 'Server error.' }); }
});

// submits a rating for a completed session
app.post('/api/sessions/rate', isAuthenticated, async (req, res) => {
    const { sessionId, raterId, rateeId, likeStatus, feedbackText } = req.body;
    if (parseInt(raterId) === parseInt(rateeId)) return res.status(400).json({ message: 'Self-rating not allowed.' });
    try {
        await pool.query(
            'INSERT INTO Ratings (session_id, rater_id, ratee_id, like_status, feedback_text) VALUES ($1, $2, $3, $4, $5)',
            [sessionId, raterId, rateeId, likeStatus, feedbackText || null]
        );
        res.status(201).json({ message: 'Rating submitted.' });
    } catch (e) { 
        if (e.code === '23505') return res.status(409).json({ message: 'Already rated.' });
        res.status(500).json({ message: 'Error rating.' }); 
    }
});

// renders the inbox view
app.get('/messages', isAuthenticated, (req, res) => res.render('inbox', { pageTitle: 'My Inbox', user: req.user }));

// renders the chat view with a specific user
app.get('/messages/:id', isAuthenticated, async (req, res) => {
    try {
        const u = await pool.query('SELECT user_name FROM Users WHERE user_id = $1', [req.params.id]);
        if (u.rows.length === 0) return res.status(404).send('User not found');
        res.render('chat', { pageTitle: 'Chat', user: req.user, otherUser: { id: req.params.id, name: u.rows[0].user_name } });
    } catch (e) { res.status(500).send('Error'); }
});

// fetches the list of recent conversations
app.get('/api/messages/inbox', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (other_user_id) other_user_id, other_user_name, message_text, timestamp 
             FROM (SELECT CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS other_user_id, 
                          CASE WHEN m.sender_id = $1 THEN r.user_name ELSE s.user_name END AS other_user_name, 
                          m.message_text, m.timestamp 
                   FROM Messages m JOIN Users s ON m.sender_id = s.user_id JOIN Users r ON m.receiver_id = r.user_id 
                   WHERE m.sender_id = $1 OR m.receiver_id = $1 ORDER BY m.timestamp DESC) AS recent`, 
            [req.user.id]
        );
        res.status(200).json({ conversations: result.rows });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// fetches the message history between two users
app.get('/api/messages/thread/:otherUserId', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.*, u.user_name AS sender_name, u.avatar_style AS sender_avatar_style
             FROM Messages m JOIN Users u ON m.sender_id = u.user_id 
             WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1) 
             ORDER BY m.timestamp ASC`,
            [req.user.id, req.params.otherUserId]
        );
        res.status(200).json({ messages: result.rows });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// sends a new message to another user
app.post('/api/messages/send', isAuthenticated, async (req, res) => {
    try {
        await pool.query('INSERT INTO Messages (sender_id, receiver_id, message_text) VALUES ($1, $2, $3)', [req.user.id, req.body.receiverId, req.body.messageText]);
        res.status(201).json({ message: 'Sent.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});


// =================================================================
// 4. ADMIN PANEL (Protected)
// =================================================================

// renders the main admin dashboard
app.get('/admin', isAdmin, (req, res) => {
    res.render('admin_dashboard', { pageTitle: 'Admin Panel', user: req.user });
});

// fetches a list of all users for the admin panel
app.get('/api/admin/users', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT user_id, email, user_name, grade_level, is_admin FROM Users ORDER BY user_id ASC');
        res.status(200).json({ users: result.rows });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// allows an admin to promote or demote a user
app.post('/api/admin/users/:id/toggle_role', isAdmin, async (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === 1) return res.status(403).json({ message: 'Cannot change Root Admin.' });
    if (targetId === req.user.id) return res.status(400).json({ message: 'Cannot demote self.' });

    try {
        const userCheck = await pool.query('SELECT is_admin FROM Users WHERE user_id = $1', [targetId]);
        const newStatus = !userCheck.rows[0].is_admin;
        await pool.query('UPDATE Users SET is_admin = $1 WHERE user_id = $2', [newStatus, targetId]);
        await pool.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, $2, 'Users', $3)", [req.user.id, newStatus ? 'Promote' : 'Demote', targetId]);
        res.status(200).json({ message: 'Role updated.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// allows an admin to delete a user account
app.delete('/api/admin/users/:id', isAdmin, async (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === 1) return res.status(403).json({ message: 'Cannot delete Root Admin.' });

    try {
        const result = await pool.query('DELETE FROM Users WHERE user_id = $1 RETURNING user_id', [targetId]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Not found.' });
        await pool.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, 'Delete User', 'Users', $2)", [req.user.id, targetId]);
        res.status(200).json({ message: 'User deleted.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// fetches all security reports for review
app.get('/api/admin/reports', isAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.*, reporter.user_name AS reporter_name, reported.user_name AS reported_user_name 
             FROM Reports r JOIN Users reporter ON r.reporter_id = reporter.user_id JOIN Users reported ON r.reported_user_id = reported.user_id ORDER BY r.timestamp DESC`
        );
        res.status(200).json({ reports: result.rows });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// updates the status of a security report
app.post('/api/admin/report/:id/status', isAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE Reports SET report_status = $1 WHERE report_id = $2', [req.body.newStatus, req.params.id]);
        await pool.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, 'Update Report', 'Reports', $2)", [req.user.id, req.params.id]);
        res.status(200).json({ message: 'Report updated.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// allows a user to submit a security report against another user
app.post('/api/reports', isAuthenticated, async (req, res) => {
    try {
        await pool.query('INSERT INTO Reports (reporter_id, reported_user_id, report_reason, report_status) VALUES ($1, $2, $3, \'New\')', [req.user.id, req.body.reportedUserId, req.body.reason]);
        res.status(201).json({ message: 'Report sent.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

//  fetches the system audit trail
app.get('/api/admin/logs', isAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT l.action_type, l.target_table, l.timestamp, u.user_name 
             FROM Admin_Logs l
             JOIN Users u ON l.admin_id = u.user_id
             ORDER BY l.timestamp DESC LIMIT 50`
        );
        res.status(200).json({ logs: result.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error fetching logs.' });
    }
});

// fetches pending skill suggestions for admin review
app.get('/api/admin/suggestions', isAdmin, async (req, res) => {
    try {
        const res1 = await pool.query("SELECT s.*, u.user_name AS suggesting_user FROM Skill_Suggestions s LEFT JOIN Users u ON s.suggesting_user_id = u.user_id WHERE s.status = 'Pending'");
        res.status(200).json({ suggestions: res1.rows });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// approves or rejects a suggested skill
app.post('/api/admin/suggestions/action', isAdmin, async (req, res) => {
    const { suggestionId, action } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const s = await client.query('SELECT suggested_skill_name FROM Skill_Suggestions WHERE suggestion_id = $1', [suggestionId]);
        if (s.rows.length === 0) throw new Error('Not found');
        
        if (action === 'approve') await client.query('INSERT INTO Skills (skill_name) VALUES ($1)', [s.rows[0].suggested_skill_name]);
        
        await client.query('UPDATE Skill_Suggestions SET status = $1 WHERE suggestion_id = $2', [action === 'approve' ? 'Approved' : 'Rejected', suggestionId]);
        await client.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, $2, 'Skill_Suggestions', $3)", [req.user.id, action === 'approve' ? 'Approve Skill' : 'Reject Skill', suggestionId]);
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'Processed.' });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ message: 'Error.' }); } finally { client.release(); }
});

// allows an admin to manually add a new skill
app.post('/api/skills', isAdmin, async (req, res) => {
    try {
        const result = await pool.query('INSERT INTO Skills (skill_name) VALUES ($1) RETURNING skill_id', [req.body.skillName]);
        await pool.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, 'Create Skill', 'Skills', $2)", [req.user.id, result.rows[0].skill_id]);
        res.status(201).json({ message: 'Skill created.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// allows an admin to rename an existing skill
app.put('/api/skills/:id', isAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE Skills SET skill_name = $1 WHERE skill_id = $2', [req.body.skillName, req.params.id]);
        await pool.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, 'Update Skill', 'Skills', $2)", [req.user.id, req.params.id]);
        res.status(200).json({ message: 'Skill updated.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// allows an admin to delete a skill
app.delete('/api/skills/:id', isAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM Skills WHERE skill_id = $1', [req.params.id]);
        await pool.query("INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id) VALUES ($1, 'Delete Skill', 'Skills', $2)", [req.user.id, req.params.id]);
        res.status(200).json({ message: 'Skill deleted.' });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// searches for users or skills matching a query
app.get('/api/search', isAuthenticated, async (req, res) => {
    const q = req.query.q;
    if (!q || q.length < 2) return res.json({ results: [] });
    try {
        const result = await pool.query(
            `SELECT u.user_id, u.user_name, u.grade_level as sub_text, 'user' as type FROM Users u WHERE u.user_name ILIKE $1
             UNION ALL
             SELECT u.user_id, u.user_name, s.skill_name as sub_text, 'skill_match' as type FROM Users u JOIN User_Skills_Offered uso ON u.user_id = uso.user_id JOIN Skills s ON uso.skill_id = s.skill_id WHERE s.skill_name ILIKE $1 LIMIT 10`,
            [`%${q}%`]
        );
        res.json({ results: result.rows });
    } catch (e) { res.status(500).json({ message: 'Error.' }); }
});

// starts the server on the specified port
app.listen(port, '0.0.0.0', () => console.log(`Server is running on port ${port}`));
