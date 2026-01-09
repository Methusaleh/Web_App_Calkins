# SkillSwap: Student Talent Exchange Platform

> **View the Live Site:** [Click Here to Open App](https://web-app-calkins-469564564131.us-central1.run.app/)

## What is this?
SkillSwap is a web application designed to help students teach each other. It allows users to create a profile, list the skills they can teach (like math or guitar), and find other students who can teach them the things they want to learn. It connects students for either online or in-person learning sessions.

## Features
We built this application to handle the entire process of organizing a tutoring session:

* Accounts: You can create a secure account, log in, and customize your profile with your grade, school, and a unique avatar.
* Skills: You can check off skills you want to teach and skills you want to learn. You can even specify if you only teach online or in person.
* Search: You can search for other students by their name or by the skill you need help with.
* Scheduling: Students can request a session for a specific time and topic. Teachers can accept or deny these requests.
* Online Meetings: If a session is online, the teacher can provide a Google Meet link directly through the app.
* Messaging: Users can chat with each other to coordinate details before meeting.
* Ratings: After a session is done, students can rate the teacher to help build a trusted community.
* Admin Panel: Administrators have a special dashboard to manage users, review security reports, and approve new skills suggested by students.

## How it works (The Tech Stack)
We built this project using standard web technologies:

* Node.js & Express: This runs our server and handles all the logic (the backend).
* PostgreSQL: This is our database where we store users, sessions, and messages. We use Neon to host it online.
* EJS: This is how we build our web pages. It lets us put data (like a user's name) directly into the HTML.
* CSS: We wrote our own styles to make the site look clean and modern.
* Axios: This helps our web pages talk to our server without reloading the page every time you click a button.

## Installation & Setup (For New Users) 

Since this project uses a live database, you need to set up your local environment before running the app. **Note: The `node_modules` folder has been excluded to keep the submission file size small.**

### 1. Prerequisites
* **Node.js**: Installed on your machine.
* **PostgreSQL**: Installed and running on your machine.

### 2. Database Setup
1.  Open your terminal or **pgAdmin**.
2.  Create a new, empty database named `skillswap`.
    * *Command Line:* `createdb skillswap`
    * *pgAdmin:* Right Click Databases > Create > Database...

### 3. Environment Config (.env)
1.  Create a file in the root folder named `.env`.
2.  Paste the following variables inside, replacing the values with your local Postgres credentials:

```env
# Database Connection
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/skillswap

# Session Security Key (Can be any random string)
SESSION_SECRET=super_secret_bpa_key_2026

# Admin Password (Used for generating the hash in hash_admin.js)
ADMIN_PASSWORD=your_actual_secure_password

# Port (Optional, defaults to 8080)
PORT=8080
```

### 4. Install Dependencies
Open a terminal in the project folder and run:
```bash
npm install
```

### 5. Seed the Database (Important!)
To instantly populate the app with 20+ fake users, skills, and session history for testing, run:
```bash
node seed.js
```

### 6. Start the Server
Run this command to start the application:
```bash
node index.js
```

Then, open your web browser and go to `http://localhost:8080`.

---

## Default Login Credentials
If you ran the seed script, you can log in with:
* **Email:** `admin@example.com`
* **Password:** `password123`

## Credits
**Business Professionals of America (BPA) - Web Application Team (2026)**
* **School:** Francis Tuttle Institute of Technology (Reno Chapter)
* **Team Members:**
    * Aaron Kipf
    * Austin Coco
    * Michael Crawford
    * Zach All

## System Architecture
![System Architecture Diagram](./docs/SAD.png)

## Database Schema
![Database ERD](./docs/ERD.png)