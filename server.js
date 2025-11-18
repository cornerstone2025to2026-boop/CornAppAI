const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Load OAuth client JSON
const oauthConfig = require("./oauth-client.json");

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  oauthConfig.web.client_id,
  oauthConfig.web.client_secret,
  oauthConfig.web.redirect_uris[0] // http://localhost:3001/oauth2callback
);

// Multer temp upload folder
const upload = multer({
  dest: path.join(__dirname, "uploads/"),
});

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads/");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ========== 1. GET GOOGLE LOGIN URL ==========
app.get("/auth", (req, res) => {
  const scopes = ["https://www.googleapis.com/auth/drive.file"];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });

  res.json({ authUrl: url });
});

// ========== 2. HANDLE GOOGLE REDIRECT ==========
app.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;

    const { tokens } = await oauth2Client.getToken(code);

    // Save tokens to disk for future use (login only once)
    fs.writeFileSync("tokens.json", JSON.stringify(tokens));

    res.send("Google Drive connected! You can close this window.");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth error");
  }
});

// ========== 3. UPLOAD FILE TO GOOGLE DRIVE ==========
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Load saved tokens
    const tokens = JSON.parse(fs.readFileSync("tokens.json"));
    oauth2Client.setCredentials(tokens);

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Upload to MyDrive (root folder)
    const response = await drive.files.create({
      requestBody: { name: fileName, parents: ["root"] },
      media: {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(filePath),
      },
    });

    // Make file public
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: "reader", type: "anyone" },
    });

    const fileUrl = `https://drive.google.com/uc?id=${response.data.id}`;

    fs.unlinkSync(filePath);

    res.json({
      status: "uploaded",
      fileId: response.data.id,
      name: fileName,
      link: fileUrl,
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({
      error: "Upload failed",
      details: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
