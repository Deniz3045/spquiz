require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");

const { Octokit } = require("@octokit/rest");

const app = express();

const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

app.use(express.json());

app.use(session({
    secret: "quiz-secret",
    resave: false,
    saveUninitialized: false
}));

app.use(express.static("public"));

const DATA_DIR = path.join(__dirname, "data");
const BOARDS_DIR = path.join(DATA_DIR, "boards");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BOARDS_DIR)) fs.mkdirSync(BOARDS_DIR);

//////////////////////////////////////////////////
// GitHub Storage
//////////////////////////////////////////////////

async function githubRead(filePath, defaultData) {

    try {

        const res = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
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
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath
        });

        sha = res.data.sha;

    } catch {}

    await octokit.repos.createOrUpdateFileContents({

        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath,
        message: "update " + filePath,
        content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
        sha
    });
}

//////////////////////////////////////////////////
// USERS
//////////////////////////////////////////////////

app.post("/api/login", async (req, res) => {

    const users = await githubRead("data/users.json", []);

    const user = users.find(u =>
        u.username === req.body.username &&
        u.password === req.body.password
    );

    if (!user)
        return res.json({ success: false });

    req.session.user = user;

    res.json({ success: true, user });
});

app.get("/api/me", (req, res) => {

    res.json(req.session.user || null);
});

app.get("/api/users", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin")
        return res.status(403).end();

    const users = await githubRead("data/users.json", []);

    res.json(users);
});

app.post("/api/users/create", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin")
        return res.status(403).end();

    const users = await githubRead("data/users.json", []);

    users.push({
        username: req.body.username,
        password: req.body.password,
        role: req.body.role,
        createdBy: req.session.user.username
    });

    await githubWrite("data/users.json", users);

    res.json({ success: true });
});

//////////////////////////////////////////////////
// BOARD FILE SYSTEM
//////////////////////////////////////////////////

function localBoardFiles() {

    return fs.readdirSync(BOARDS_DIR).filter(f => f.endsWith(".json"));
}

function localLoadBoard(file) {

    const filePath = path.join(BOARDS_DIR, file);

    if (!fs.existsSync(filePath))
        return null;

    return JSON.parse(fs.readFileSync(filePath));
}

function localSaveBoard(file, data) {

    const filePath = path.join(BOARDS_DIR, file);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

//////////////////////////////////////////////////
// BOARD API
//////////////////////////////////////////////////

app.get("/api/boards/files", (req, res) => {

    const files = localBoardFiles().map(file => {

        const data = localLoadBoard(file);

        return {

            file,
            createdBy: data.createdBy,
            createdAt: data.createdAt,
            boards: data.boards.length
        };
    });

    res.json(files);
});

app.get("/api/boards/file/:file", (req, res) => {

    res.json(localLoadBoard(req.params.file));
});

app.post("/api/boards/file/create", (req, res) => {

    const file = req.body.file.endsWith(".json")
        ? req.body.file
        : req.body.file + ".json";

    localSaveBoard(file, {

        createdBy: req.session.user.username,
        createdAt: Date.now(),
        boards: []
    });

    res.json({ success: true });
});

app.post("/api/boards/file/save", (req, res) => {

    localSaveBoard(req.body.file, req.body.data);

    res.json({ success: true });
});

//////////////////////////////////////////////////
// GAME START
//////////////////////////////////////////////////

app.post("/api/game/start", (req, res) => {

    const data = localLoadBoard(req.body.file);

    fs.writeFileSync(
        path.join(DATA_DIR, "activeGame.json"),
        JSON.stringify(data, null, 2)
    );

    res.json({ success: true });
});

app.get("/api/game", (req, res) => {

    const file = path.join(DATA_DIR, "activeGame.json");

    if (!fs.existsSync(file))
        return res.json(null);

    res.json(JSON.parse(fs.readFileSync(file)));
});

//////////////////////////////////////////////////

app.listen(PORT, () =>
    console.log("Server running on " + PORT)
);
