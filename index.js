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

// 1. Checks if a user is logged in
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        req.user = req.session.user; 
        next();
    } else {
        if (req.originalUrl.startsWith('/api/')) {
            res.status(401).json({ message: 'Unauthorized. Please log in.' });
        } else {
            // Redirect unauthenticated browser users to the login page
            res.redirect('/'); 
        }
    }
}

// 2. Checks if the logged-in user is an administrator
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) {
        req.user = req.session.user;
        next();
    } else {
        // Smart Check: Is this an API call or a Page load?
        if (req.originalUrl.startsWith('/api/')) {
            // If it's an API call (Axios), send JSON error
            res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
        } else {
            // If it's a browser page load (like /admin), redirect to Dashboard
            res.redirect('/'); 
        }
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
    const user = req.session.user || null; 

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
        user: user,
    });
});


// GET /register - Renders the registration form page
app.get('/register', async (req, res) => {
    // You must ensure the user is NOT logged in before allowing them to register
    if (req.session.user) {
        return res.redirect('/'); // Redirect to dashboard if already authenticated
    }

    // This is a public, unauthenticated page, so it doesn't need data fetching.
    res.render('register', { 
        pageTitle: 'SkillSwap Registration',
        user: null // Explicitly pass null since they are unauthenticated
    });
});

// GET /api/messages/thread/:otherUserId - Fetches conversation with another user
app.get('/api/messages/thread/:otherUserId', isAuthenticated, async (req, res) => {
    const currentUserId = req.user.id;
    const otherUserId = req.params.otherUserId;

    try {
        // Query to get messages where (Sender=Me AND Receiver=Other) OR (Sender=Other AND Receiver=Me)
        // Ordered by time so the chat reads correctly top-to-bottom
        const result = await pool.query(
            `SELECT 
                m.message_id,
                m.sender_id,
                m.receiver_id,
                m.message_text,
                m.timestamp,
                u.user_name AS sender_name
             FROM Messages m
             JOIN Users u ON m.sender_id = u.user_id
             WHERE (m.sender_id = $1 AND m.receiver_id = $2)
                OR (m.sender_id = $2 AND m.receiver_id = $1)
             ORDER BY m.timestamp ASC`,
            [currentUserId, otherUserId]
        );

        res.status(200).json({ messages: result.rows });

    } catch (error) {
        console.error('Error fetching messages:', error.message);
        res.status(500).json({ message: 'Server error fetching messages.' });
    }
});

// POST /api/messages/send - Sends a direct message
app.post('/api/messages/send', isAuthenticated, async (req, res) => {
    const { receiverId, messageText } = req.body;
    const senderId = req.user.id;

    if (!receiverId || !messageText) {
        return res.status(400).json({ message: 'Receiver ID and message text are required.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO Messages (sender_id, receiver_id, message_text)
             VALUES ($1, $2, $3)
             RETURNING message_id, timestamp`,
            [senderId, receiverId, messageText]
        );

        res.status(201).json({ 
            message: 'Message sent successfully.', 
            sentMessage: result.rows[0] 
        });

    } catch (error) {
        console.error('Error sending message:', error.message);
        res.status(500).json({ message: 'Server error sending message.' });
    }
});

// GET /messages/:id - Renders the chat page with a specific user
app.get('/messages/:id', isAuthenticated, async (req, res) => {
    const otherUserId = req.params.id;
    try {
        // Fetch the other user's name just for the page title/header
        const userRes = await pool.query('SELECT user_name FROM Users WHERE user_id = $1', [otherUserId]);
        if (userRes.rows.length === 0) return res.status(404).send('User not found');

        res.render('chat', {
            pageTitle: `Chat with ${userRes.rows[0].user_name}`,
            user: req.user,
            otherUser: { id: otherUserId, name: userRes.rows[0].user_name }
        });
    } catch (err) { res.status(500).send('Server Error'); }
});

// GET /profile/edit - Renders the user's profile editing page
app.get('/profile/edit', isAuthenticated, async (req, res) => {
    try {
        // 1. Fetch the Master Skill List (Required for all profile edits)
        const skillsResult = await pool.query('SELECT skill_id, skill_name FROM Skills ORDER BY skill_name ASC');
        
        // 2. Fetch the current user's profile and current skills (Offered/Sought)
        // You'll need a couple of new GET routes for this, but for now, we'll just fetch the master list.

        res.render('profile_edit', {
            pageTitle: `Edit Profile: ${req.user.name}`,
            user: req.user, // The authenticated user's session data
            masterSkills: skillsResult.rows
        });
    } catch (error) {
        console.error('Error loading profile edit page:', error.message);
        res.status(500).send('Application Error: Could not load profile data.');
    }
});

// GET /profile/view/:id - Renders a public profile page for any user
app.get('/profile/view/:id', isAuthenticated, async (req, res) => {
    const targetUserId = req.params.id;

    try {
        // We run multiple queries in parallel for efficiency
        const [userRes, offeredRes, soughtRes, ratingRes] = await Promise.all([
            // 1. Basic User Info
            pool.query(
                'SELECT user_id, user_name, grade_level, school_college, email FROM Users WHERE user_id = $1', 
                [targetUserId]
            ),
            // 2. Skills Offered (with location flags)
            pool.query(
                `SELECT s.skill_name, uso.is_virtual_only, uso.is_inperson_only 
                 FROM User_Skills_Offered uso
                 JOIN Skills s ON uso.skill_id = s.skill_id
                 WHERE uso.user_id = $1`, 
                [targetUserId]
            ),
            // 3. Skills Sought
            pool.query(
                `SELECT s.skill_name 
                 FROM User_Skills_Sought uss
                 JOIN Skills s ON uss.skill_id = s.skill_id
                 WHERE uss.user_id = $1`, 
                [targetUserId]
            ),
            // 4. Ratings Summary
            pool.query(
                `SELECT 
                    COUNT(rating_id) AS total, 
                    SUM(CASE WHEN like_status = TRUE THEN 1 ELSE 0 END) AS likes 
                 FROM Ratings WHERE ratee_id = $1`, 
                [targetUserId]
            )
        ]);

        if (userRes.rows.length === 0) {
            return res.status(404).send("User not found.");
        }

        const targetUser = userRes.rows[0];
        const ratings = ratingRes.rows[0];
        
        // Calculate a simple percentage (avoid divide by zero)
        const likePercentage = ratings.total > 0 
            ? Math.round((ratings.likes / ratings.total) * 100) 
            : 0;

        res.render('profile_view', {
            pageTitle: `${targetUser.user_name}'s Profile`,
            user: req.user,       // The person LOOKING at the profile (for nav bar)
            profile: targetUser,  // The person BEING looked at
            skillsOffered: offeredRes.rows,
            skillsSought: soughtRes.rows,
            ratingStats: {
                count: ratings.total,
                likes: ratings.likes,
                percent: likePercentage
            }
        });

    } catch (error) {
        console.error('Error loading profile view:', error.message);
        res.status(500).send('Error loading profile.');
    }
});

// GET /api/user/profile/:id - Fetches full profile details for editing
app.get('/api/user/profile/:id', isAuthenticated, async (req, res) => {
    // SECURITY NOTE: In a final check, you must add logic here: 
    // if (req.user.id !== parseInt(req.params.id)) return res.status(403)...

    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT user_id, email, user_name, date_of_birth, grade_level, school_college 
             FROM Users 
             WHERE user_id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.status(200).json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching profile.' });
    }
});

// PUT /api/user/profile/:id - Updates basic profile info
app.put('/api/user/profile/:id', isAuthenticated, async (req, res) => {
    // Security Check: Ensure the user is updating their OWN profile
    if (req.user.id !== parseInt(req.params.id)) {
        return res.status(403).json({ message: 'Access denied. You can only update your own profile.' });
    }

    const { userName, gradeLevel } = req.body;

    // Basic Validation
    if (!userName) {
        return res.status(400).json({ message: 'Full Name is required.' });
    }

    try {
        const result = await pool.query(
            `UPDATE Users 
             SET user_name = $1, 
                 grade_level = $2
             WHERE user_id = $3
             RETURNING user_id, user_name, email, grade_level;`,
            [userName, gradeLevel || null, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Update the session data so the UI reflects changes immediately without re-login
        req.session.user.name = result.rows[0].user_name;
        req.session.save(); // Ensure session is saved before response

        res.status(200).json({ 
            message: 'Profile updated successfully.', 
            user: result.rows[0] 
        });

    } catch (error) {
        console.error('Profile Update Error:', error.message);
        res.status(500).json({ message: 'Server error while updating profile.' });
    }
});

// GET /api/user/skills/:id - Fetches currently offered and sought skills for a user
app.get('/api/user/skills/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
        const offeredResult = await pool.query(
            'SELECT skill_id, is_virtual_only, is_inperson_only FROM User_Skills_Offered WHERE user_id = $1',
            [id]
        );
        const soughtResult = await pool.query(
            'SELECT skill_id, is_virtual_only, is_inperson_only FROM User_Skills_Sought WHERE user_id = $1',
            [id]
        );
        res.status(200).json({ 
            offered: offeredResult.rows, 
            sought: soughtResult.rows 
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user skills.' });
    }
});

// POST /api/reports - Submit a new security report against a user
app.post('/api/reports', isAuthenticated, async (req, res) => {
    const { reportedUserId, reason } = req.body;
    const reporterId = req.user.id;

    if (!reportedUserId || !reason) {
        return res.status(400).json({ message: 'Reported user ID and reason are required.' });
    }

    try {
        // Insert the report into the database
        const result = await pool.query(
            `INSERT INTO Reports (reporter_id, reported_user_id, report_reason, report_status)
             VALUES ($1, $2, $3, 'New')
             RETURNING report_id`,
            [reporterId, reportedUserId, reason]
        );

        res.status(201).json({ message: 'Report submitted successfully. An admin will review it shortly.' });

    } catch (error) {
        console.error('Report Submission Error:', error.message);
        res.status(500).json({ message: 'Server error while submitting report.' });
    }
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

        // Log the administrative action (Audit Trail)
        await pool.query(
            `INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id)
            VALUES ($1, $2, 'Skills', $3);`,
            [req.user.id, 'Update Skill' /* or 'Delete Skill' */, id] 
        );

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

        // Log the administrative action (Audit Trail)
        await pool.query(
            `INSERT INTO Admin_Logs (admin_id, action_type, target_table, target_id)
            VALUES ($1, $2, 'Skills', $3);`,
            [req.user.id, 'Update Skill' /* or 'Delete Skill' */, id] 
        );

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

// GET /api/skills/:id/providers - Fetches non-admin users who offer a specific skill
app.get('/api/skills/:id/providers', isAuthenticated, async (req, res) => {
    const skillId = req.params.id;
    try {
        const result = await pool.query(
            `SELECT u.user_id, u.user_name 
             FROM Users u
             JOIN User_Skills_Offered uso ON u.user_id = uso.user_id
             WHERE uso.skill_id = $1 
               AND u.is_admin = FALSE  -- Filter out admins
               AND u.user_id != $2     -- Filter out the requesting user (self)
             ORDER BY u.user_name ASC`,
            [skillId, req.user.id]
        );
        res.status(200).json({ providers: result.rows });
    } catch (error) {
        console.error('Error fetching providers:', error.message);
        res.status(500).json({ message: 'Error fetching providers.' });
    }
});

// GET /session/request - Renders the session request form
app.get('/session/request', isAuthenticated, async (req, res) => {
    try {
        // 1. Fetch all potential providers (excluding the current user)
        // Note: In a real app, you'd filter this by who actually offers skills.
        const usersResult = await pool.query(
            'SELECT user_id, user_name FROM Users WHERE user_id != $1 ORDER BY user_name ASC', 
            [req.user.id]
        );

        // 2. Fetch all skills
        const skillsResult = await pool.query(
            'SELECT skill_id, skill_name FROM Skills ORDER BY skill_name ASC'
        );

        res.render('session_request', {
            pageTitle: 'Request a Session',
            user: req.user,
            skills: skillsResult.rows
        });
    } catch (error) {
        console.error('Error loading session request page:', error.message);
        res.status(500).send('Error loading form.');
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

// GET /my_sessions - Renders the session management page
app.get('/my_sessions', isAuthenticated, (req, res) => {
    res.render('my_sessions', { 
        pageTitle: 'My Sessions', 
        user: req.user 
    });
});

// GET /session/rate/:id - Renders the rating form
app.get('/session/rate/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;

    try {
        // Fetch session details to verify user is the requester and status is completed
        const result = await pool.query(
            `SELECT s.session_id, s.requester_id, s.provider_id, s.status, u.user_name AS provider_name
             FROM Sessions s
             JOIN Users u ON s.provider_id = u.user_id
             WHERE s.session_id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send('Session not found.');
        }

        const session = result.rows[0];

        // Security Checks
        if (session.requester_id !== req.user.id) {
            return res.status(403).send('Access Denied: You can only rate sessions you requested.');
        }
        if (session.status !== 'Completed') {
            return res.status(403).send('This session is not yet marked as completed.');
        }

        res.render('rating_form', {
            pageTitle: 'Rate Your Session',
            user: req.user,
            session: session
        });

    } catch (error) {
        console.error('Error loading rating form:', error.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/sessions/user/:id - Fetches all sessions (UPDATED with is_rated check)
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
                s.provider_id,
                s.requester_id,
                p.user_name AS provider_name,
                r.user_name AS requester_name,
                sk.skill_name AS skill_name,
                -- CHECK IF RATED: Returns true if a rating exists for this session
                (CASE WHEN rt.rating_id IS NOT NULL THEN TRUE ELSE FALSE END) AS is_rated
            FROM Sessions s
            JOIN Users p ON s.provider_id = p.user_id 
            JOIN Users r ON s.requester_id = r.user_id 
            JOIN Skills sk ON s.skill_taught_id = sk.skill_id
            -- LEFT JOIN ensures we get the session even if no rating exists yet
            LEFT JOIN Ratings rt ON s.session_id = rt.session_id
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

// GET /admin - Renders the Admin Dashboard
app.get('/admin', isAdmin, (req, res) => {
    res.render('admin_dashboard', { 
        pageTitle: 'Admin Control Panel', 
        user: req.user 
    });
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

// POST /api/sessions/deny - Denies a pending request or cancels a confirmed session
app.post('/api/sessions/deny', isAuthenticated, async (req, res) => {
    // NOTE: This route REQUIRES authentication middleware
    
    const { sessionId, reason } = req.body;
    const userId = req.user.id; // Get the ID of the person clicking the button
    
    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required for denial/cancellation.' });
    }

    try {
        // 1. First, retrieve the current session status AND participants
        const currentSession = await pool.query(
            'SELECT status, provider_id, requester_id FROM Sessions WHERE session_id = $1',
            [sessionId]
        );

        if (currentSession.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        const session = currentSession.rows[0];
        const currentStatus = session.status;
        let newStatus;

        // 2. Determine new status based on State AND Who is acting
        if (currentStatus === 'Requested') {
            if (userId === session.requester_id) {
                // If the STUDENT cancels their own request -> 'Cancelled'
                newStatus = 'Cancelled';
            } else {
                // If the TEACHER denies the request -> 'Denied'
                newStatus = 'Denied';
            }
        } else if (currentStatus === 'Confirmed') {
            newStatus = 'Cancelled'; // Either party is canceling an agreed session
        } else {
            return res.status(400).json({ message: `Cannot change status from ${currentStatus}.` });
        }

        // 3. Update the Sessions table
        const result = await pool.query(
            `UPDATE Sessions
             SET status = $1,
                 cancellation_reason = $2
             WHERE session_id = $3
             RETURNING session_id, status;`,
            [newStatus, reason || 'No reason provided', sessionId]
        );

        // 4. Success Response
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