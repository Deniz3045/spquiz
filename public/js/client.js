const socket = io();
const username = localStorage.getItem('username');
let currentQuestion = null;

// --- Board laden ---
socket.emit('getBoard');
socket.on('boardData', (board) => {
    renderBoard(board);
});

function renderBoard(board) {
    const boardDiv = document.getElementById('board');
    boardDiv.innerHTML = '';
    board.categories.forEach((cat, i) => {
        const col = document.createElement('div');
        col.className = 'category';
        const title = document.createElement('h3');
        title.textContent = cat.name;
        col.appendChild(title);

        cat.questions.forEach((q, j) => {
            const btn = document.createElement('button');
            btn.textContent = q.value;
            btn.addEventListener('click', () => {
                socket.emit('selectQuestion', { categoryIndex: i, questionIndex: j, admin: false });
            });
            col.appendChild(btn);
        });
        boardDiv.appendChild(col);
    });
}

// --- Frage anzeigen ---
socket.on('questionSelected', (question) => {
    currentQuestion = question;
    document.getElementById('questionPanel').classList.remove('hidden');
    document.getElementById('categoryTitle').textContent = question.category || '';
    document.getElementById('questionText').textContent = question.question;
    document.getElementById('timerDisplay').textContent = question.timer;
});

// --- Timer Update ---
socket.on('timerUpdate', (time) => {
    document.getElementById('timerDisplay').textContent = time;
});

// --- Buzz ---
document.getElementById('buzzBtn').addEventListener('click', () => {
    socket.emit('buzz', username);
});

// --- Antwort abgeben ---
document.getElementById('submitAnswerBtn').addEventListener('click', () => {
    const answer = document.getElementById('answerInput').value;
    const correct = answer.trim().toLowerCase() === currentQuestion.answer.toLowerCase();
    socket.emit('answer', { username, correct });
});

// --- Score Update ---
socket.on('scoreUpdate', (users) => {
    const scoreList = document.getElementById('scoreList');
    scoreList.innerHTML = '';
    users.forEach(u => {
        const li = document.createElement('li');
        li.textContent = `${u.username}: ${u.score} Punkte`;
        scoreList.appendChild(li);
    });
});

// --- Buzz Update ---
socket.on('buzzUpdate', (activePlayer) => {
    alert(`Aktiver Spieler: ${activePlayer}`);
});