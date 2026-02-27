// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketio = require('socket.io');
const { Octokit } = require('@octokit/rest');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// GitHub Octokit
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const GITHUB_OWNER = 'Deniz3045'; // <-- anpassen
const GITHUB_REPO = 'spquiz';                 // <-- anpassen
const BRANCH = 'main';                        // branch prüfen

// Express static & JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Lokale JSON Dateien fallback ---
const LOCAL_USERS = path.join(__dirname, 'data', 'users.json');
const LOCAL_BOARDS = path.join(__dirname, 'data', 'boards.json');

// --- Lade JSON von GitHub oder lokal ---
let users = [];
let boards = { categories: [], multiplier: 1 };

async function loadJSON(filePath, fallbackPath) {
    try {
        const res = await octokit.rest.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath,
            ref: BRANCH
        });
        const content = Buffer.from(res.data.content, 'base64').toString();
        return JSON.parse(content);
    } catch (err) {
        console.warn(`GitHub read error ${filePath} - using local fallback`);
        if(fs.existsSync(fallbackPath)){
            return JSON.parse(fs.readFileSync(fallbackPath));
        } else {
            // Datei anlegen
            const empty = filePath.includes('users') ? [] : { categories: [], multiplier: 1 };
            fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
            fs.writeFileSync(fallbackPath, JSON.stringify(empty, null,2));
            return empty;
        }
    }
}

// --- Initial load ---
(async ()=>{
    users = await loadJSON('data/users.json', LOCAL_USERS);
    boards = await loadJSON('data/boards.json', LOCAL_BOARDS);
})();

// --- GitHub save helper ---
async function saveJSON(filePath, fallbackPath, data) {
    const content = Buffer.from(JSON.stringify(data,null,2)).toString('base64');
    try {
        // check if file exists
        let sha;
        try {
            const res = await octokit.rest.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: filePath,
                ref: BRANCH
            });
            sha = res.data.sha;
        } catch {}
        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filePath,
            message: `Update ${filePath}`,
            content,
            sha,
            branch: BRANCH
        });
    } catch(err) {
        console.warn(`GitHub write error ${filePath}, saving locally`);
        fs.writeFileSync(fallbackPath, JSON.stringify(data,null,2));
    }
}

// --- Admin HTTP APIs ---
app.post('/admin/addUser', async (req,res)=>{
    const { username, password, role="player" } = req.body;
    if(users.find(u=>u.username===username)) return res.status(400).send('User exists');
    users.push({ username,password, score:0, role });
    await saveJSON('data/users.json', LOCAL_USERS, users);
    res.send('Spieler hinzugefügt');
});

app.post('/admin/saveBoard', async (req,res)=>{
    boards = req.body;
    await saveJSON('data/boards.json', LOCAL_BOARDS, boards);
    res.send('Board gespeichert');
});

// --- Socket.IO ---
let currentGame = { activePlayer:null, currentQuestion:null, timer:0, buzzersUnlocked:false };

io.on('connection', socket=>{

    // Login
    socket.on('login', ({username,password})=>{
        const user = users.find(u=>u.username===username && u.password===password);
        if(user){
            socket.emit('loginSuccess', { username:user.username, score:user.score, role:user.role });
        } else {
            socket.emit('loginFail','Ungültige Daten');
        }
    });

    // Board
    socket.on('getBoard', ()=> socket.emit('boardData', boards) );

    // Frage auswählen (Admin)
    socket.on('selectQuestion', ({categoryIndex, questionIndex, admin})=>{
        if(admin){
            currentGame.currentQuestion = boards.categories[categoryIndex].questions[questionIndex];
            currentGame.timer = currentGame.currentQuestion.timer || 30;
            currentGame.activePlayer = null;
            currentGame.buzzersUnlocked = false;
            io.emit('questionSelected', currentGame.currentQuestion);
        }
    });

    // Timer starten
    socket.on('startTimer', ()=>{
        const interval = setInterval(()=>{
            if(currentGame.timer<=0){
                clearInterval(interval);
                io.emit('timerEnded');
            } else {
                currentGame.timer--;
                io.emit('timerUpdate', currentGame.timer);
            }
        },1000);
    });

    // Buzzers freigeben
    socket.on('unlockBuzzers', ()=>{
        currentGame.buzzersUnlocked = true;
        io.emit('buzzersUnlocked');
    });

    // Buzz
    socket.on('buzz', username=>{
        if(!currentGame.activePlayer){
            currentGame.activePlayer=username;
            io.emit('buzzUpdate', username);
        }
    });

    // Antwort prüfen
    socket.on('answer', ({username,correct})=>{
        const multiplier = boards.multiplier || 1;
        let points = currentGame.currentQuestion.value * multiplier;
        if(username===currentGame.activePlayer){
            updateScore(username, correct? points : -points/2);
        } else {
            updateScore(username, correct? points/2 : -points/2);
        }
        io.emit('scoreUpdate', users);
    });

    function updateScore(username, delta){
        const user = users.find(u=>u.username===username);
        if(user){
            user.score += delta;
            saveJSON('data/users.json', LOCAL_USERS, users); // speichert live
        }
    }

});

server.listen(3000, ()=>console.log('Server läuft auf http://localhost:3000'));
