const fs = require("fs");
const path = require("path");

// 1. CONFIGURATION
// The file we will create
const OUTPUT_FILE = "full_project_code.txt";

// Folders to strictly IGNORE
const IGNORE_DIRS = [
  "node_modules",
  ".git",
  ".vscode",
  "public/images",
  "database_backup",
];

// File types to INCLUDE
const INCLUDE_EXTS = [".js", ".ejs", ".css", ".sql", ".json"];

// Files to specifically IGNORE
const IGNORE_FILES = ["package-lock.json", "bundle_code.cjs", OUTPUT_FILE];

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function (file) {
    const fullPath = path.join(dirPath, file);

    if (fs.statSync(fullPath).isDirectory()) {
      if (!IGNORE_DIRS.includes(file)) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      const ext = path.extname(file);
      if (INCLUDE_EXTS.includes(ext) && !IGNORE_FILES.includes(file)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

try {
  console.log("📦 Bundling project files...");

  if (fs.existsSync(OUTPUT_FILE)) {
    fs.unlinkSync(OUTPUT_FILE);
  }

  const allFiles = getAllFiles(__dirname);
  let content = "";

  allFiles.forEach((filePath) => {
    const relativePath = path.relative(__dirname, filePath);
    const fileContent = fs.readFileSync(filePath, "utf8");

    content += `\n\n/* ==========================================================================\n`;
    content += `   FILE: ${relativePath}\n`;
    content += `   ========================================================================== */\n\n`;
    content += fileContent;
  });

  fs.writeFileSync(OUTPUT_FILE, content);
  console.log(`✅ Success! All code saved to: ${OUTPUT_FILE}`);
} catch (err) {
  console.error("❌ Error bundling files:", err);
}
