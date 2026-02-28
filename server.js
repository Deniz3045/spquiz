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

// ============================
// CONFIG
// ============================

const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const BRANCH = process.env.GITHUB_BRANCH || "main";

const octokit = GITHUB_TOKEN
  ? new Octokit({ auth: GITHUB_TOKEN })
  : null;

const LOCAL_USERS = path.join(__dirname, "data", "users.json");
const LOCAL_BOARDS = path.join(__dirname, "data", "boards.json");

// ============================
// EXPRESS
// ============================

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ============================
// MEMORY
// ============================

let users = [];
let boards = {
  multiplier: 1,
  categories: []
};

let currentGame = {

  activePlayer: null,
  currentQuestion: null,
  timer: 0,
  buzzersUnlocked: false

};

// ============================
// FILE HELPERS
// ============================

function ensureFile(file, defaultData){

  if(!fs.existsSync(file)){

    fs.mkdirSync(path.dirname(file), { recursive: true });

    fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));

  }

}

function loadLocal(file){

  ensureFile(file, file.includes("users") ? [] : { multiplier:1, categories:[] });

  return JSON.parse(fs.readFileSync(file,"utf8"));

}

async function saveJSON(filePath, fallbackPath, data){

  const jsonString = JSON.stringify(data, null, 2);

  // ALWAYS SAVE LOCAL
  try{

    fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });

    fs.writeFileSync(fallbackPath, jsonString, "utf8");

    console.log("Saved locally:", fallbackPath);

  }catch(err){

    console.error("Local save error:", err);

  }

  // SAVE TO GITHUB (optional)
  if(octokit && GITHUB_OWNER && GITHUB_REPO){

    try{

      const content = Buffer.from(jsonString).toString("base64");

      let sha;

      try{

        const res = await octokit.rest.repos.getContent({

          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          path: filePath,
          ref: BRANCH

        });

        sha = res.data.sha;

      }catch{}

      await octokit.rest.repos.createOrUpdateFileContents({

        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath,
        message: "Update " + filePath,
        content,
        sha,
        branch: BRANCH

      });

      console.log("Saved to GitHub:", filePath);

    }catch(err){

      console.error("GitHub save error:", err.message);

    }

  }

}

// ============================
// INITIAL LOAD
// ============================

users = loadLocal(LOCAL_USERS);

boards = loadLocal(LOCAL_BOARDS);

// ============================
// ADMIN HTTP ROUTES
// ============================

// ADD USER
app.post("/admin/addUser", async (req,res)=>{

  try{

    const { username, password, role } = req.body;

    if(!username || !password)
      return res.status(400).send("Username oder Passwort fehlt");

    if(users.find(u=>u.username===username))
      return res.status(400).send("User existiert bereits");

    const newUser = {

      username,
      password,
      role: role || "player",
      score: 0

    };

    users.push(newUser);

    await saveJSON("data/users.json", LOCAL_USERS, users);

    res.send("User erstellt");

  }catch(err){

    console.error(err);

    res.status(500).send("Server Fehler");

  }

});

// GET USERS
app.get("/admin/users",(req,res)=>{

  res.json(users);

});

// GET BOARDS
app.get("/admin/boards",(req,res)=>{

  res.json(boards);

});

// SAVE BOARD
app.post("/admin/saveBoard", async (req,res)=>{

  boards = req.body;

  await saveJSON("data/boards.json", LOCAL_BOARDS, boards);

  res.send("Board gespeichert");

});

// ============================
// SOCKET.IO
// ============================

io.on("connection",(socket)=>{

  console.log("Client connected");

  // LOGIN
  socket.on("login", ({ username, password })=>{

    const user = users.find(

      u => u.username === username && u.password === password

    );

    if(user){

      socket.user = user;

      socket.emit("loginSuccess",{

        username: user.username,
        role: user.role,
        score: user.score

      });

    }else{

      socket.emit("loginFail","Ungültige Login Daten");

    }

  });

  // GET BOARD
  socket.on("getBoard",()=>{

    socket.emit("boardData", boards);

  });

  // GET USERS
  socket.on("getUsers",()=>{

    socket.emit("usersData", users);

  });

  // SELECT QUESTION (ADMIN)
  socket.on("selectQuestion",({categoryIndex, questionIndex, admin})=>{

    if(!admin) return;

    const question = boards.categories?.[categoryIndex]?.questions?.[questionIndex];

    if(!question) return;

    currentGame.currentQuestion = question;

    currentGame.timer = question.timer || 30;

    currentGame.activePlayer = null;

    currentGame.buzzersUnlocked = false;

    io.emit("questionSelected", question);

  });

  // START TIMER
  socket.on("startTimer",()=>{

    const interval = setInterval(()=>{

      if(currentGame.timer <= 0){

        clearInterval(interval);

        io.emit("timerEnded");

      }else{

        currentGame.timer--;

        io.emit("timerUpdate", currentGame.timer);

      }

    },1000);

  });

  // UNLOCK BUZZERS
  socket.on("unlockBuzzers",()=>{

    currentGame.buzzersUnlocked = true;

    io.emit("buzzersUnlocked");

  });

  // BUZZ
  socket.on("buzz",(username)=>{

    if(!currentGame.buzzersUnlocked) return;

    if(!currentGame.activePlayer){

      currentGame.activePlayer = username;

      io.emit("buzzUpdate", username);

    }

  });

  // ANSWER RESULT
  socket.on("answer", async ({ username, correct })=>{

    if(!currentGame.currentQuestion) return;

    const multiplier = boards.multiplier || 1;

    let points = currentGame.currentQuestion.value * multiplier;

    const user = users.find(u=>u.username===username);

    if(!user) return;

    if(username === currentGame.activePlayer){

      user.score += correct ? points : -points/2;

    }else{

      user.score += correct ? points/2 : -points/2;

    }

    await saveJSON("data/users.json", LOCAL_USERS, users);

    io.emit("scoreUpdate", users);

  });

  socket.on("disconnect",()=>{

    console.log("Client disconnected");

  });

});

// ============================
// START SERVER
// ============================

server.listen(PORT,()=>{

  console.log("=================================");
  console.log("Server läuft auf Port:", PORT);
  console.log("http://localhost:"+PORT);
  console.log("=================================");

});
