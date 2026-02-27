// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Octokit } = require("@octokit/rest");
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER; // z.B. "meinusername"
const REPO = process.env.GITHUB_REPO;   // z.B. "jeopardy-data"
const BRANCH = "main";

const octokit = new Octokit({ auth: GITHUB_TOKEN });

let users = [];
let boards = [];
let currentGame = { activePlayer: null, currentQuestion: null, timer: 0, boardIndex: null };

// --- GitHub Helper ---
async function loadFile(path) {
    try {
        const resp = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
        const content = Buffer.from(resp.data.content, 'base64').toString();
        return JSON.parse(content);
    } catch(e) {
        console.error(`GitHub read error ${path}`, e.message);
        return [];
    }
}

async function saveFile(path, data, message) {
    try {
        // Check if file exists to get sha
        let sha;
        try {
            const resp = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
            sha = resp.data.sha;
        } catch(e){ sha = undefined; }

        await octokit.repos.createOrUpdateFileContents({
            owner: OWNER,
            repo: REPO,
            path,
            message,
            content: Buffer.from(JSON.stringify(data,null,2)).toString('base64'),
            branch: BRANCH,
            sha
        });
    } catch(e){ console.error(`GitHub write error ${path}`, e.message); }
}

// --- Load initial data ---
(async()=>{
    users = await loadFile("data/users.json");
    boards = await loadFile("data/boards.json");
})();

// --- Socket.IO ---
io.on('connection', socket => {

    // Login
    socket.on('login', ({ username, password }) => {
        const user = users.find(u => u.username === username && u.password === password);
        if(user) socket.emit('loginSuccess', { username: user.username, score: user.score, role: user.role });
        else socket.emit('loginFail', 'Ungültige Daten');
    });

    // Initiale Daten
    socket.on('getUsers', ()=>socket.emit('userListUpdate',users));
    socket.on('getBoards', ()=>socket.emit('boardListUpdate',boards));
    socket.on('getBoard', ()=>{ if(currentGame.boardIndex!==null) socket.emit('boardData',boards[currentGame.boardIndex]); });

    // Spieler hinzufügen
    socket.on('addUser', async ({ username, password, role })=>{
        if(users.find(u=>u.username===username)) return socket.emit('errorMsg','User existiert');
        users.push({ username, password, score:0, role });
        await saveFile("data/users.json", users, `Added user ${username}`);
        io.emit('userListUpdate',users);
    });

    // Rolle ändern
    socket.on('changeRole', async ({ username, role })=>{
        const user = users.find(u=>u.username===username);
        if(user){ user.role = role; await saveFile("data/users.json", users, `Changed role ${username} to ${role}`); }
        io.emit('userListUpdate',users);
    });

    // Board hochladen
    socket.on('uploadBoard', async (data)=>{
        boards.push(data);
        await saveFile("data/boards.json", boards, `Uploaded board ${data.name}`);
        io.emit('boardListUpdate', boards);
    });

    // Board auswählen
    socket.on('selectBoard', index=>{
        currentGame.boardIndex = index;
        socket.emit('boardSelected', boards[index]);
        io.emit('boardData', boards[index]);
    });

    // Frage auswählen (Admin)
    socket.on('selectQuestion', ({ categoryIndex, questionIndex, admin })=>{
        if(!admin) return;
        const board = boards[currentGame.boardIndex];
        currentGame.currentQuestion = board.categories[categoryIndex].questions[questionIndex];
        currentGame.timer = currentGame.currentQuestion.timer || 30;
        currentGame.activePlayer = null;
        io.emit('questionSelected', currentGame.currentQuestion);
    });

    // Timer starten
    socket.on('startTimer', ()=>{
        const interval = setInterval(()=>{
            if(currentGame.timer<=0){ clearInterval(interval); io.emit('timerEnded'); }
            else { currentGame.timer--; io.emit('timerUpdate',currentGame.timer); }
        },1000);
    });

    // Buzzers freigeben (Admin)
    socket.on('unlockBuzzers', ()=>io.emit('buzzersUnlocked'));

    // Buzz eines Spielers
    socket.on('buzz', username=>{
        if(!currentGame.activePlayer){
            currentGame.activePlayer=username;
            io.emit('buzzUpdate', currentGame.activePlayer);
        }
    });

    // Antwort eines Spielers
    socket.on('answer', async ({ username, correct })=>{
        if(!currentGame.currentQuestion) return;
        const board = boards[currentGame.boardIndex];
        const multiplier = board.multiplier || 1;
        let points = currentGame.currentQuestion.value * multiplier;

        if(username===currentGame.activePlayer){ correct ? updateScore(username,points) : updateScore(username,-points/2); }
        else { correct ? updateScore(username,points/2) : updateScore(username,-points/2); }

        io.emit('scoreUpdate', users);
        await saveFile("data/users.json", users, "Updated scores");
    });

    function updateScore(username, delta){
        const user = users.find(u => u.username === username);
        if(user) user.score += delta;
    }

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`Server läuft auf http://localhost:${PORT}`));
