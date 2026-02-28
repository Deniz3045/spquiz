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

// --- API: Users ---
app.get("/api/users",(req,res)=>{ res.json(users); });

app.post("/api/users/create",(req,res)=>{
    const { username, password, role } = req.body;
    users.push({username,password,role,score:0});
    fs.writeFileSync('./data/users.json',JSON.stringify(users,null,2));
    res.json({success:true});
});

app.post("/api/users/delete",(req,res)=>{
    const { username } = req.body;
    users = users.filter(u=>u.username!==username);
    fs.writeFileSync('./data/users.json',JSON.stringify(users,null,2));
    res.json({success:true});
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
