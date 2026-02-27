const socket = io();

// --- Spieler hinzufügen ---
document.getElementById('addUserBtn').addEventListener('click', () => {
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    fetch('/admin/addUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => res.text()).then(msg => {
        document.getElementById('userMsg').textContent = msg;
    });
});

// --- Board speichern ---
document.getElementById('saveBoardBtn').addEventListener('click', () => {
    const boardJson = document.getElementById('boardJson').value;
    try {
        const board = JSON.parse(boardJson);
        fetch('/admin/saveBoard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(board)
        }).then(res => res.text()).then(msg => {
            document.getElementById('boardMsg').textContent = msg;
        });
    } catch(e) {
        document.getElementById('boardMsg').textContent = 'Ungültiges JSON';
    }
});