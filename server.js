require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const { Server } = require("socket.io");
const { Octokit } = require("@octokit/rest");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

/* GitHub Config */
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;

/* Local paths */
const DATA_DIR = "./data";
const BOARDS_DIR = path.join(DATA_DIR, "boards");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ACTIVE_FILE = path.join(DATA_DIR, "activeGame.json");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

/* ensure folders exist */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BOARDS_DIR)) fs.mkdirSync(BOARDS_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

/* Middleware */
app.use(express.json());
app.use(express.static("public"));

app.use(session({
    store: new FileStore({ path: SESSIONS_DIR }),
    secret: "quiz-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 }
}));

/* --- GitHub helpers --- */
async function githubRead(filePath, defaultData = {}) {
    try {
        const res = await octokit.repos.getContent({
            owner: OWNER,
            repo: REPO,
            path: filePath
        });
        const content = Buffer.from(res.data.content, "base64").toString();
        return JSON.parse(content);
    } catch {
        await githubWrite(filePath, defaultData);
        return defaultData;
    }
}

async function githubWrite(filePath, data) {
    let sha;
    try {
        const res = await octokit.repos.getContent({
            owner: OWNER,
            repo: REPO,
            path: filePath
        });
        sha = res.data.sha;
    } catch {}
    await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: filePath,
        message: "update " + filePath,
        content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
        sha
    });
}

/* --- Users --- */
async function readUsers() {
    return await githubRead("data/users.json", [{
        username: "admin",
        password: "admin",
        role: "admin",
        score: 0
    }]);
}

async function saveUsers(users) {
    await githubWrite("data/users.json", users);
}

/* --- Boards --- */
function getLocalBoards() {
    return fs.readdirSync(BOARDS_DIR).filter(f => f.endsWith(".json"));
}

function loadBoardFile(file) {
    return JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, file)));
}

function saveBoardFile(file, data) {
    fs.writeFileSync(path.join(BOARDS_DIR, file), JSON.stringify(data, null, 2));
}

/* --- Auth --- */
app.post("/api/login", async (req, res) => {
    const users = await readUsers();
    const user = users.find(u => u.username === req.body.username && u.password === req.body.password);
    if (!user) return res.json({ success: false });
    req.session.user = user;
    res.json({ success: true, username: user.username, role: user.role });
});

app.get("/api/me", (req, res) => res.json(req.session.user || null));

/* --- Admin: Spieler Management --- */
app.get("/api/users", async (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") return res.status(403).end();
    const users = await readUsers();
    res.json(users);
});

app.post("/api/users/create", async (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") return res.status(403).end();
    const users = await readUsers();
    users.push({
        username: req.body.username,
        password: req.body.password,
        role: req.body.role,
        createdBy: req.session.user.username,
        score: 0
    });
    await saveUsers(users);
    res.json({ success: true });
});

app.post("/api/users/delete", async (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") return res.status(403).end();
    let users = await readUsers();
    users = users.filter(u => u.username !== req.body.username);
    await saveUsers(users);
    res.json({ success: true });
});

/* --- Boards --- */
app.get("/api/boards/files", (req, res) => {
    const boards = getLocalBoards().map(file => {
        const data = loadBoardFile(file);
        return { file, createdBy: data.createdBy, boardCount: data.boards.length };
    });
    res.json(boards);
});

app.post("/api/boards/create", (req, res) => {
    const file = req.body.fileName.endsWith(".json") ? req.body.fileName : req.body.fileName + ".json";
    saveBoardFile(file, { createdBy: req.session.user.username, boards: [] });
    res.json({ success: true });
});

/* --- Start Quiz --- */
app.post("/api/game/start", (req, res) => {
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ file: req.body.file }));
    io.emit("gameStarted", req.body.file);
    res.json({ success: true });
});

app.get("/api/game", (req, res) => {
    if (!fs.existsSync(ACTIVE_FILE)) return res.json(null);
    res.json(JSON.parse(fs.readFileSync(ACTIVE_FILE)));
});

/* --- Socket.IO --- */
io.on("connection", socket => {
    socket.on("getBoard", () => {
        if (!fs.existsSync(ACTIVE_FILE)) return;
        const active = JSON.parse(fs.readFileSync(ACTIVE_FILE));
        const board = loadBoardFile(active.file);
        socket.emit("boardData", board);
    });
});

/* --- Server starten --- */
server.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));
