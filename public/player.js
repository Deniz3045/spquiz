const socket = io();

let playerName = localStorage.getItem("playerName") || "Spieler";

document.getElementById("playerName").textContent = playerName;

socket.emit("playerJoin", playerName);

const overlay = document.getElementById("questionOverlay");
const buzzBtn = document.getElementById("buzzBtn");

buzzBtn.onclick = () => {

  socket.emit("buzz");

  buzzBtn.disabled = true;

  document.getElementById("buzzStatus").textContent =
    "Gebuzzed! Warten...";
};


/* Frage anzeigen */

socket.on("showQuestion", data => {

  overlay.classList.remove("hidden");

  document.getElementById("questionCategory").textContent =
    data.category;

  document.getElementById("questionValue").textContent =
    data.value;

  document.getElementById("questionText").textContent =
    data.question;

  buzzBtn.disabled = false;

  document.getElementById("buzzStatus").textContent =
    "";
});


/* Frage schließen */

socket.on("hideQuestion", () => {

  overlay.classList.add("hidden");
});


/* Score Update */

socket.on("scoreUpdate", score => {

  document.getElementById("playerScore").textContent =
    score;
});


/* Buzz Gewinner */

socket.on("buzzWinner", name => {

  if(name === playerName){

    document.getElementById("buzzStatus").textContent =
      "DU WARST SCHNELLER!";
  }
  else{

    document.getElementById("buzzStatus").textContent =
      name + " war schneller";
  }

  buzzBtn.disabled = true;
});
