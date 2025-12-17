/* ==========================================================================
   FILE: seed.js
   Usage: node seed.js
   Description: Populates the DB with 20 users, skills, sessions, and ratings.
   ========================================================================== */

import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

// Load environment variables (to get DATABASE_URL)
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If you are using a cloud DB that requires SSL, uncomment the next line:
  // ssl: { rejectUnauthorized: false }
});

// --- CONFIGURATION ---
const USERS_TO_CREATE = 20;
const DEFAULT_PASSWORD = "password123"; // Simple password for all fake users

// --- DATA ARRAYS ---
const FIRST_NAMES = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "David",
  "Elizabeth",
  "William",
  "Barbara",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Charles",
  "Karen",
  "Daniel",
  "Lisa",
  "Matthew",
];

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
];

const SCHOOLS = [
  "Francis Tuttle Tech",
  "Piedmont High",
  "Oklahoma City Univ",
  "Tulsa Community College",
  "Norman North High",
  "Edmond Santa Fe",
];

const SKILL_LIST = [
  "Algebra",
  "Calculus",
  "Python Programming",
  "Creative Writing",
  "Public Speaking",
  "Guitar",
  "Piano",
  "Spanish",
  "French",
  "Biology",
  "Chemistry",
  "History",
  "Graphic Design",
  "Video Editing",
];

const FEEDBACK_COMMENTS = [
  "Great teacher! Very patient.",
  "Explained the concepts clearly.",
  "A bit fast, but knows their stuff.",
  "Helped me ace my test!",
  "Would definitely recommend.",
  "Super friendly and helpful.",
  "Thanks for the help!",
  "Good session, solved my problem.",
];

const AVATAR_STYLES = ["bottts", "avataaars", "micah", "identicon"];

// --- HELPER FUNCTIONS ---
function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDate(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime())
  );
}

// --- MAIN FUNCTION ---
async function seedDatabase() {
  console.log("🌱 Starting Database Seed...");

  try {
    // 1. Ensure Skills Exist
    console.log("📚 Seeding Master Skills...");
    for (const skill of SKILL_LIST) {
      await pool.query(
        `INSERT INTO Skills (skill_name) VALUES ($1) ON CONFLICT (skill_name) DO NOTHING`,
        [skill]
      );
    }

    // Get all skill IDs for later assignment
    const skillsRes = await pool.query("SELECT * FROM Skills");
    const allSkills = skillsRes.rows;

    // 2. Create Users
    console.log(`👤 Creating ${USERS_TO_CREATE} Fake Users...`);
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const createdUsers = [];

    for (let i = 0; i < USERS_TO_CREATE; i++) {
      const fname = getRandom(FIRST_NAMES);
      const lname = getRandom(LAST_NAMES);
      const email = `${fname.toLowerCase()}.${lname.toLowerCase()}${Math.floor(
        Math.random() * 1000
      )}@example.com`;

      // Randomly assign school and grade
      const school = Math.random() > 0.3 ? getRandom(SCHOOLS) : null;
      const grade = Math.random() > 0.5 ? "12th" : "College";

      const res = await pool.query(
        `INSERT INTO Users (email, password_hash, user_name, date_of_birth, grade_level, school_college, is_admin, avatar_style) 
                 VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7) 
                 ON CONFLICT (email) DO NOTHING
                 RETURNING user_id, user_name`,
        [
          email,
          hashedPassword,
          `${fname} ${lname}`,
          getRandomDate(new Date(2000, 0, 1), new Date(2008, 0, 1)),
          grade,
          school,
          getRandom(AVATAR_STYLES),
        ]
      );

      if (res.rows.length > 0) {
        createdUsers.push(res.rows[0]);
      }
    }

    if (createdUsers.length === 0) {
      console.log(
        "⚠️ No new users created (maybe emails already existed?). fetching existing ones..."
      );
      const existing = await pool.query(
        "SELECT user_id, user_name FROM Users LIMIT 20"
      );
      createdUsers.push(...existing.rows);
    }

    // 3. Assign Skills (Offer & Seek)
    console.log("🎓 Assigning Skills...");
    for (const user of createdUsers) {
      // Assign 1-3 Offered Skills
      const numOffers = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < numOffers; j++) {
        const skill = getRandom(allSkills);
        await pool.query(
          `INSERT INTO User_Skills_Offered (user_id, skill_id, is_virtual_only, is_inperson_only) 
                     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [
            user.user_id,
            skill.skill_id,
            Math.random() > 0.5,
            Math.random() > 0.5,
          ]
        );
      }

      // Assign 1-3 Sought Skills
      const numSeeks = Math.floor(Math.random() * 3) + 1;
      for (let k = 0; k < numSeeks; k++) {
        const skill = getRandom(allSkills);
        // Don't seek what you offer (mostly)
        await pool.query(
          `INSERT INTO User_Skills_Sought (user_id, skill_id, is_virtual_only, is_inperson_only) 
                     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [
            user.user_id,
            skill.skill_id,
            Math.random() > 0.5,
            Math.random() > 0.5,
          ]
        );
      }
    }

    // 4. Create History (Sessions & Ratings)
    console.log("⭐ Generating Session History & Ratings...");

    // We will create ~15 random completed sessions
    for (let i = 0; i < 15; i++) {
      const provider = getRandom(createdUsers);
      let requester = getRandom(createdUsers);

      // Ensure provider != requester
      while (requester.user_id === provider.user_id) {
        requester = getRandom(createdUsers);
      }

      const skill = getRandom(allSkills); // Ideally check if provider actually offers this, but for seed it's okay
      const sessionDate = getRandomDate(new Date(2025, 0, 1), new Date());

      // Create Session
      const sessRes = await pool.query(
        `INSERT INTO Sessions (provider_id, requester_id, skill_taught_id, session_date_time, location_type, status)
                 VALUES ($1, $2, $3, $4, 'Online', 'Completed') RETURNING session_id`,
        [provider.user_id, requester.user_id, skill.skill_id, sessionDate]
      );

      const sessionId = sessRes.rows[0].session_id;

      // Add Rating (80% chance of "Like")
      const liked = Math.random() > 0.2;
      const comment = liked
        ? getRandom(FEEDBACK_COMMENTS)
        : "Provider was late.";

      await pool.query(
        `INSERT INTO Ratings (session_id, rater_id, ratee_id, like_status, feedback_text)
                 VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, requester.user_id, provider.user_id, liked, comment]
      );
    }

    console.log("✅ Seed Complete!");
    console.log(`🎉 Added/Verified ${createdUsers.length} users.`);
    console.log(`🔑 All new users have password: '${DEFAULT_PASSWORD}'`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed Failed:", error);
    process.exit(1);
  }
}

seedDatabase();
