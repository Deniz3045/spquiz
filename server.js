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

let users = JSON.parse(fs.readFileSync('./data/users.json'));
let boards = JSON.parse(fs.readFileSync('./data/boards.json'));
let currentGame = { activePlayer: null, currentQuestion: null, timer: 0 };

// --- Admin HTTP APIs ---
app.post('/admin/addUser', (req, res) => {
    const { username, password } = req.body;
    if(users.find(u => u.username === username)) return res.status(400).send('User exists');
    users.push({ username, password, score: 0, role: "player" });
    fs.writeFileSync('./data/users.json', JSON.stringify(users, null, 2));
    res.send('Spieler hinzugefügt');
});

app.post('/admin/saveBoard', (req, res) => {
    boards = req.body;
    fs.writeFileSync('./data/boards.json', JSON.stringify(boards, null, 2));
    res.send('Board gespeichert');
});

// --- Socket.IO ---
io.on('connection', (socket) => {
    socket.on('login', ({ username, password }) => {
        const user = users.find(u => u.username === username && u.password === password);
        if(user) {
            socket.emit('loginSuccess', { username: user.username, score: user.score, role: user.role });
        } else {
            socket.emit('loginFail', 'Ungültige Daten');
        }
    });

    socket.on('getBoard', () => {
        socket.emit('boardData', boards);
    });

    socket.on('selectQuestion', ({ categoryIndex, questionIndex, admin }) => {
        if(admin) {
            currentGame.currentQuestion = boards.categories[categoryIndex].questions[questionIndex];
            currentGame.timer = currentGame.currentQuestion.timer || 30;
            currentGame.activePlayer = null;
            io.emit('questionSelected', currentGame.currentQuestion);
        }
    });

    socket.on('startTimer', () => {
        const interval = setInterval(() => {
            if(currentGame.timer <= 0) {
                clearInterval(interval);
                io.emit('timerEnded');
            } else {
                currentGame.timer--;
                io.emit('timerUpdate', currentGame.timer);
            }
        }, 1000);
    });

    socket.on('buzz', (username) => {
        if(!currentGame.activePlayer) {
            currentGame.activePlayer = username;
            io.emit('buzzUpdate', currentGame.activePlayer);
        }
    });

    socket.on('answer', ({ username, correct }) => {
        const multiplier = boards.multiplier || 1;
        let points = currentGame.currentQuestion.value * multiplier;
        if(username === currentGame.activePlayer) {
            if(correct) updateScore(username, points);
            else updateScore(username, -points/2);
        } else {
            if(correct) updateScore(username, points/2);
            else updateScore(username, -points/2);
        }
        io.emit('scoreUpdate', users);
    });

    function updateScore(username, delta) {
        const user = users.find(u => u.username === username);
        if(user) {
            user.score += delta;
            fs.writeFileSync('./data/users.json', JSON.stringify(users, null, 2));
        }
    }
});

server.listen(3000, () => console.log('Server läuft auf http://localhost:3000'));