# SkillSwap: Student Talent Exchange Platform

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

## How to run this project

If you want to run this code on your own computer, follow these steps:

1. Get the code
Download this folder or clone the repository to your computer.

2. Install the tools
Open your terminal (command line) in this folder and run this command to download the necessary libraries:
npm install

3. Set up your secrets
Create a new file in this folder called .env. You need to put your database connection info here so the app knows where to save data. It should look like this:

DATABASE_URL=your_postgres_connection_string_here
SESSION_SECRET=your_long_random_security_key_here
PORT=8080

4. Start the server
Run this command to start the application:
npm start

Then, open your web browser and go to http://localhost:8080.

## Database Setup
You do not need to create tables manually. The application automatically checks the database when it starts. If the tables are missing, it will run the necessary SQL code to create them for you.

## Credits
Business Professionals of America (BPA) - Web Application Team (V04)
* School: Francis Tuttle Institute of Technology
* Chapter: Reno Chapter
* Year: 2026