const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Daten laden ---
let users = JSON.parse(fs.readFileSync('./data/users.json'));
let boards = JSON.parse(fs.readFileSync('./data/boards.json'));
let currentGame = { activePlayer:null, currentQuestion:null, timer:0 };

// --- Admin HTTP APIs ---

// Spieler erstellen
app.post('/admin/addUser', (req,res)=>{
  const {username,password,role} = req.body;
  if(users.find(u=>u.username===username)) return res.status(400).send('User existiert');
  users.push({username,password,score:0,role:role || "player"});
  fs.writeFileSync('./data/users.json', JSON.stringify(users,null,2));
  res.send('Spieler hinzugefügt');
});

// Board speichern (Admin)
app.post('/admin/saveBoard', (req,res)=>{
  boards = req.body;
  fs.writeFileSync('./data/boards.json', JSON.stringify(boards,null,2));
  res.send('Board gespeichert');
});

// Board hochladen (Editor/Admin)
app.post('/admin/uploadBoard',(req,res)=>{
  const {username,board} = req.body;
  const user = users.find(u=>u.username===username);
  if(!user || (user.role!=="admin" && user.role!=="editor")) return res.status(403).send('Keine Berechtigung');
  const filename = './data/'+board.name+'.json';
  fs.writeFileSync(filename, JSON.stringify(board,null,2));
  res.send('Board hochgeladen');
});

// --- Socket.IO Multiplayer ---
io.on('connection', (socket)=>{

  // Login
  socket.on('login', ({username,password})=>{
    const user = users.find(u=>u.username===username && u.password===password);
    if(user) socket.emit('loginSuccess', {username:user.username,score:user.score,role:user.role});
    else socket.emit('loginFail','Ungültige Daten');
  });

  // Board senden
  socket.on('getBoard', ()=>{
    socket.emit('boardData', boards);
  });

  // Frage auswählen (Admin)
  socket.on('selectQuestion', ({categoryIndex,questionIndex,admin})=>{
    if(admin){
      currentGame.currentQuestion = boards.categories[categoryIndex].questions[questionIndex];
      currentGame.timer = currentGame.currentQuestion.timer || 30;
      currentGame.activePlayer = null;
      io.emit('questionSelected', currentGame.currentQuestion);
    }
  });

  // Timer starten
  socket.on('startTimer', ()=>{
    const interval = setInterval(()=>{
      if(currentGame.timer<=0){
        clearInterval(interval);
        io.emit('timerEnded');
      } else{
        currentGame.timer--;
        io.emit('timerUpdate', currentGame.timer);
      }
    },1000);
  });

  // Buzz
  socket.on('buzz',(username)=>{
    if(!currentGame.activePlayer){
      currentGame.activePlayer=username;
      io.emit('buzzUpdate', currentGame.activePlayer);
    }
  });

  // Antwort auswerten
  socket.on('answer', ({username,correct})=>{
    const multiplier = boards.multiplier || 1;
    let points = currentGame.currentQuestion.value * multiplier;

    if(username === currentGame.activePlayer){
      if(correct) updateScore(username, points);
      else updateScore(username, -points/2);
    } else {
      if(correct) updateScore(username, points/2);
      else updateScore(username, -points/2);
    }
    io.emit('scoreUpdate', users);
  });

  function updateScore(username, delta){
    const user = users.find(u=>u.username===username);
    if(user){
      user.score += delta;
      fs.writeFileSync('./data/users.json', JSON.stringify(users,null,2));
    }
  }

});

server.listen(3000,()=>console.log('Server läuft auf http://localhost:3000'));
