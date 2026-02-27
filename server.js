require('dotenv').config(); // dotenv für sichere Tokens
const express = require('express');
const http = require('http');
const path = require('path');
const socketio = require('socket.io');
const { Octokit } = require('@octokit/rest');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static(path.join(__dirname,'public')));
app.use(express.json());

// --- GitHub Config ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER  = process.env.GITHUB_USER;
const REPO_NAME   = process.env.GITHUB_REPO;
const BRANCH      = process.env.GITHUB_BRANCH || 'main';
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- Helper Functions ---
async function readJSON(path){
  try{
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path, ref: BRANCH
    });
    return JSON.parse(Buffer.from(data.content,'base64').toString());
  }catch(e){
    console.log('GitHub read error',path,e.message);
    return [];
  }
}

async function writeJSON(path,json){
  try{
    const existing = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path, ref: BRANCH
    }).catch(()=>({data:{sha:null}}));

    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      message: 'Update via Jeopardy System',
      content: Buffer.from(JSON.stringify(json,null,2)).toString('base64'),
      sha: existing.data.sha || undefined,
      branch: BRANCH
    });
  }catch(e){console.log('GitHub write error',path,e.message);}
}

// --- Initial Data ---
let users = [];
let boards = { categories: [], multiplier: 1 };

(async ()=>{
  users = await readJSON('data/users.json');
  boards = await readJSON('data/boards.json');
})();

// --- Admin APIs ---
app.post('/admin/addUser', async(req,res)=>{
  try{
    const {username,password,role,creator} = req.body;
    const creatorUser = users.find(u=>u.username===creator);
    if(!creatorUser || creatorUser.role!=='admin') return res.status(403).send('Nur Admins dürfen neue User anlegen');
    if(users.find(u=>u.username===username)) return res.status(400).send('User existiert');
    users.push({username,password,role:role||'player',score:0});
    await writeJSON('data/users.json',users);
    res.send('Spieler hinzugefügt');
  }catch(e){
    console.log('addUser error',e.message);
    res.status(500).send('Fehler beim Hinzufügen');
  }
});

app.post('/admin/saveBoard', async(req,res)=>{
  try{
    const {username, board} = req.body;
    const user = users.find(u=>u.username===username);
    if(!user || (user.role!=='admin' && user.role!=='editor')) return res.status(403).send('Keine Berechtigung');
    boards = board;
    await writeJSON('data/boards.json',boards);
    res.send('Board gespeichert');
  }catch(e){
    console.log('saveBoard error',e.message);
    res.status(500).send('Fehler beim Speichern');
  }
});

app.post('/admin/uploadBoard', async(req,res)=>{
  try{
    const {username, board} = req.body;
    const user = users.find(u=>u.username===username);
    if(!user || (user.role!=='admin' && user.role!=='editor')) return res.status(403).send('Keine Berechtigung');
    if(!board.name) return res.status(400).send('Board muss einen Namen haben');
    board.uploadedBy = username;
    const filename = `data/${board.name}.json`;
    await writeJSON(filename,board);
    res.send('Board hochgeladen');
  }catch(e){
    console.log('uploadBoard error',e.message);
    res.status(500).send('Fehler beim Upload');
  }
});

// --- Socket.IO ---
let currentGame = { activePlayer:null, currentQuestion:null, timer:0 };

io.on('connection', socket=>{
  socket.on('login', ({username,password})=>{
    const user = users.find(u=>u.username===username && u.password===password);
    if(user) socket.emit('loginSuccess',{username:user.username,score:user.score,role:user.role});
    else socket.emit('loginFail','Ungültige Daten');
  });

  socket.on('getBoard', ()=>socket.emit('boardData',boards));

  socket.on('selectQuestion', ({categoryIndex,questionIndex,admin})=>{
    if(admin){
      currentGame.currentQuestion = boards.categories[categoryIndex].questions[questionIndex];
      currentGame.timer = currentGame.currentQuestion.timer || 30;
      currentGame.activePlayer = null;
      io.emit('questionSelected',currentGame.currentQuestion);
    }
  });

  socket.on('startTimer', ()=>{
    const interval = setInterval(()=>{
      if(currentGame.timer<=0){
        clearInterval(interval);
        io.emit('timerEnded');
      } else{
        currentGame.timer--;
        io.emit('timerUpdate',currentGame.timer);
      }
    },1000);
  });

  socket.on('buzz', username=>{
    if(!currentGame.activePlayer){
      currentGame.activePlayer=username;
      io.emit('buzzUpdate',currentGame.activePlayer);
    }
  });

  socket.on('answer', ({username,correct})=>{
    const multiplier = boards.multiplier||1;
    let points = currentGame.currentQuestion.value*multiplier;
    if(username===currentGame.activePlayer){
      correct ? updateScore(username,points) : updateScore(username,-points/2);
    } else{
      correct ? updateScore(username,points/2) : updateScore(username,-points/2);
    }
    io.emit('scoreUpdate',users);
  });

  function updateScore(username,delta){
    const user = users.find(u=>u.username===username);
    if(user){
      user.score += delta;
      writeJSON('data/users.json',users);
    }
  }
});

server.listen(3000,()=>console.log('Server läuft auf http://localhost:3000'));
