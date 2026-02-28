const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketio = require('socket.io');
require('dotenv').config();
const { Octokit } = require("@octokit/rest");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = "DEIN_GITHUB_USER"; // GitHub User
const repo = "spquiz";             // Repo Name

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let users = JSON.parse(fs.readFileSync('./data/users.json'));
let currentGame = { activePlayer: null, currentQuestion: null, timer: 0, board: null };

// --- API: Login ---
app.post("/api/login", (req,res)=>{
    const {username,password} = req.body;
    const user = users.find(u=>u.username===username && u.password===password);
    if(user) res.json({success:true, role:user.role, username:user.username});
    else res.json({success:false});
});

/* ===============================
   USERS API (FULL CRUD WITH GITHUB)
================================ */

// Alle User laden
app.get("/api/users", async (req, res) => {

    users = await githubRead("data/users.json") || [];

    res.json(users);

});


// User erstellen
app.post("/api/users/create", async (req, res) => {

    const sessionUser = req.session.user;

    if (!sessionUser || sessionUser.role !== "admin")
        return res.status(403).json({ error: "Keine Berechtigung" });

    const { username, password, role } = req.body;

    if (!username || !password || !role)
        return res.status(400).json({ error: "Fehlende Daten" });

    users = await githubRead("data/users.json") || [];

    if (users.find(u => u.username === username))
        return res.status(400).json({ error: "User existiert bereits" });

    const newUser = {

        username,
        password,
        role,
        score: 0

    };

    users.push(newUser);

    await githubWrite("data/users.json", users);

    io.emit("usersUpdated", users);

    res.json({ success: true });

});


// User bearbeiten
app.post("/api/users/update", async (req, res) => {

    const sessionUser = req.session.user;

    if (!sessionUser || sessionUser.role !== "admin")
        return res.status(403).json({ error: "Keine Berechtigung" });

    const { username, password, role, score } = req.body;

    users = await githubRead("data/users.json") || [];

    const user = users.find(u => u.username === username);

    if (!user)
        return res.status(404).json({ error: "User nicht gefunden" });

    if (password !== undefined)
        user.password = password;

    if (role !== undefined)
        user.role = role;

    if (score !== undefined)
        user.score = score;

    await githubWrite("data/users.json", users);

    io.emit("usersUpdated", users);

    res.json({ success: true });

});


// User löschen
app.post("/api/users/delete", async (req, res) => {

    const sessionUser = req.session.user;

    if (!sessionUser || sessionUser.role !== "admin")
        return res.status(403).json({ error: "Keine Berechtigung" });

    const { username } = req.body;

    users = await githubRead("data/users.json") || [];

    users = users.filter(u => u.username !== username);

    await githubWrite("data/users.json", users);

    io.emit("usersUpdated", users);

    res.json({ success: true });

});

// --- API: Boards auflisten ---
app.get("/api/boards/files", async (req,res)=>{
    try{
        const ghFiles = await octokit.repos.getContent({owner,repo,path:"data/boards"});
        const boards = ghFiles.data.map(f=>({file:f.name, createdBy:"-" }));
        res.json(boards);
    }catch(e){ console.error(e); res.status(500).json({error:"GitHub Fehler"}); }
});

// --- API: Board speichern ---
app.post("/api/boards/save", async (req,res)=>{
    const { fileName, boardData } = req.body;
    const content = Buffer.from(JSON.stringify(boardData,null,2)).toString('base64');
    try{
        await octokit.repos.createOrUpdateFileContents({
            owner, repo, path:`data/boards/${fileName}`,
            message:`Board ${fileName} gespeichert`,
            content,
            branch:"main"
        });
        res.json({success:true});
    }catch(e){ console.error(e); res.status(500).json({error:"GitHub Fehler"}); }
});

// --- Socket.IO Live Sync ---
io.on('connection', socket=>{

    // Spieler/ Admin lädt aktuelles Board
    socket.on('getBoard', async () => {
        if(currentGame.board){
            socket.emit('boardData', currentGame.board);
        }
    });

    // Admin wählt Frage aus
    socket.on('selectQuestion', ({categoryIndex,questionIndex,admin})=>{
        if(!currentGame.board) return;
        const q = currentGame.board.categories[categoryIndex].questions[questionIndex];
        currentGame.currentQuestion = q;
        currentGame.timer = q.timer || 30;
        currentGame.activePlayer = null;
        io.emit('questionSelected', q);
        io.emit('buzzEnabled'); // Spieler können buzzern
    });

    // Timer starten
    socket.on('startTimer', ()=>{
        let timer = currentGame.timer;
        const interval = setInterval(()=>{
            if(timer<=0){ clearInterval(interval); io.emit('timerEnded'); }
            else { timer--; io.emit('timerUpdate',timer); }
        },1000);
    });

    // Spieler buzzert
    socket.on('buzz', (username)=>{
        if(!currentGame.activePlayer){
            currentGame.activePlayer = username;
            io.emit('buzzUpdate', username);
        }
    });

    // Antwort abgeben
    socket.on('answer', ({username,correct})=>{
        if(!currentGame.currentQuestion) return;
        const multiplier = currentGame.board?.multiplier || 1;
        let points = currentGame.currentQuestion.value * multiplier;

        if(username === currentGame.activePlayer){
            points = correct ? points : -points/2;
        } else {
            points = correct ? points/2 : -points/2;
        }

        const user = users.find(u=>u.username===username);
        if(user) { user.score += points; fs.writeFileSync('./data/users.json',JSON.stringify(users,null,2)); }

        io.emit('scoreUpdate', users);
    });

});
server.listen(3000, ()=>console.log("Server läuft auf http://localhost:3000"));
