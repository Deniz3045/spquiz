const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const { Server } = require("socket.io");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

const DATA_DIR = "./data";
const BOARDS_DIR = "./data/boards";
const USERS_FILE = "./data/users.json";
const ACTIVE_FILE = "./data/activeGame.json";

/* ensure folders */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BOARDS_DIR)) fs.mkdirSync(BOARDS_DIR, { recursive: true });
if (!fs.existsSync("./data/sessions")) fs.mkdirSync("./data/sessions");

if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([
        {
            username: "admin",
            password: "admin",
            role: "admin",
            score: 0
        }
    ], null, 2));
}

/* middleware */
app.use(express.json());

app.use(session({
    store: new FileStore({
        path: "./data/sessions"
    }),
    secret: "quiz-secret",
    resave: false,
    saveUninitialized: false
}));

app.use(express.static("public"));

/* helpers */

function readUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getBoardFiles() {
    return fs.readdirSync(BOARDS_DIR).filter(f => f.endsWith(".json"));
}

function loadBoardFile(file) {
    return JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, file)));
}

function saveBoardFile(file, data) {
    fs.writeFileSync(path.join(BOARDS_DIR, file), JSON.stringify(data, null, 2));
}

/* LOGIN */

app.post("/api/login", (req, res) => {

    const { username, password } = req.body;

    const users = readUsers();

    const user = users.find(u =>
        u.username === username &&
        u.password === password
    );

    if (!user)
        return res.json({ success: false });

    req.session.user = user;

    res.json({
        success: true,
        username: user.username,
        role: user.role
    });
});

/* GET SESSION */

app.get("/api/me", (req, res) => {

    if (!req.session.user)
        return res.json(null);

    res.json(req.session.user);
});

/* ADD USER */

app.post("/api/admin/addUser", (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin")
        return res.status(403).end();

    const { username, password, role } = req.body;

    const users = readUsers();

    if (users.find(u => u.username === username))
        return res.json({ success: false });

    users.push({
        username,
        password,
        role,
        score: 0
    });

    saveUsers(users);

    res.json({ success: true });
});

/* BOARD FILE LIST */

app.get("/api/boards/files", (req, res) => {

    const files = getBoardFiles().map(file => {

        const data = loadBoardFile(file);

        return {
            file,
            createdBy: data.createdBy,
            boardCount: data.boards.length
        };
    });

    res.json(files);
});

/* CREATE BOARD FILE */

app.post("/api/boards/create", (req, res) => {

    const { fileName } = req.body;

    const file = fileName.endsWith(".json")
        ? fileName
        : fileName + ".json";

    saveBoardFile(file, {
        createdBy: req.session.user.username,
        boards: []
    });

    res.json({ success: true });
});

/* START GAME */

app.post("/api/game/start", (req, res) => {

    const { file } = req.body;

    fs.writeFileSync(ACTIVE_FILE, JSON.stringify({
        file
    }));

    io.emit("gameStarted", file);

    res.json({ success: true });
});

/* SOCKET */

io.on("connection", socket => {

    socket.on("getBoard", () => {

        if (!fs.existsSync(ACTIVE_FILE))
            return;

        const active = JSON.parse(fs.readFileSync(ACTIVE_FILE));

        const board = loadBoardFile(active.file);

        socket.emit("boardData", board);
    });

});

/* start */

server.listen(PORT, () =>
    console.log("Server läuft auf http://localhost:" + PORT)
);
