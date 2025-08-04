let headline = "";
let articleURL = "";
let wrongGuesses = 0;
const maxWrong = 2;
let startTime = null;
let timerInterval = null;
let splitHeadline = [];
let wordGuesses = [];
let wordCompleted = [];
let articleImage = null;
let articleDescription = "";
let score = 0;
let guessedCorrectLetters = new Set();
let guessedIncorrectLetters = new Set();

function keyboardListener(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) {
        handleLetterGuess(key);
    }
}
document.addEventListener("keydown", keyboardListener);

fetch("/headline")
    .then(res => res.json())
    .then(data => {
        const completed = new Set(JSON.parse(localStorage.getItem("completedHeadlines")) || []);
        // Loop to retry fetch if headline is already completed
        function isCompleted(headline) {
            return completed.has(headline);
        }

        function tryFetch(data) {
            if (isCompleted(data.headline)) {
                return fetch("/headline").then(res => res.json()).then(tryFetch);
            } else {
                setupGame(data);
            }
        }

        tryFetch(data);
    });

function setupGame(data) {
    headline = data.headline;
    splitHeadline = headline.split(" ");
    wordGuesses = splitHeadline.map(() => new Set());
    wordCompleted = splitHeadline.map(word => [...word].every(char => !/^[A-Z]$/.test(char)));
    articleURL = data.url;
    articleImage = data.urlToImage;
    articleDescription = data.description;

    document.getElementById("regionTag").innerHTML = `Retrieved from: <em>${data.sourceName || "News Outlet Name"}</em>`;
    updateIncorrectGuessesDisplay();
    updateDisplay();
    renderAlphabet();
}
function titleCase(str) {
    return str.toLowerCase().split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function updateDisplay() {
    const wordDisplay = document.getElementById("wordDisplay");
    wordDisplay.innerHTML = "";
    let isComplete = true;
    let composedHeadline = "";

    splitHeadline.forEach((word, wordIndex) => {
        const wordDiv = document.createElement("div");
        wordDiv.classList.add("word");
        if (wordCompleted[wordIndex]) wordDiv.classList.add("complete");

        [...word].forEach(char => {
            const box = document.createElement("div");
            box.classList.add("letter-box");

            if (!/[A-Z]/.test(char)) {
                box.textContent = char;
                box.classList.add("revealed");
            } else if (wordGuesses[wordIndex].has(char)) {
                box.textContent = char;
                box.classList.add("revealed");
            } else {
                box.textContent = "";
                isComplete = false;
            }

            wordDiv.appendChild(box);
        });

        wordDisplay.appendChild(wordDiv);
        composedHeadline += word + " ";
    });

    if (isComplete) {
        document.getElementById("wordDisplay").style.display = "none";
        const aestheticBox = document.getElementById("aestheticBox");
        aestheticBox.style.display = "block";
        document.getElementById("aestheticHeadline").textContent = titleCase(composedHeadline.trim());
        document.getElementById("headlineSynopsis").textContent = articleDescription;
        document.getElementById("regionTag").style.display = "block";
        document.getElementById("headlineSynopsis").style.display = "block";
        aestheticBox.classList.add("fade-in");
    } else {
        document.getElementById('regionTag').style.display = 'none';
        document.getElementById('headlineSynopsis').style.display = 'none';
    }

    const articleImageElement = document.getElementById("articleImage");
    if (articleImage) {
        articleImageElement.src = articleImage;
        articleImageElement.style.display = "block";
    } else {
        articleImageElement.style.display = "none";
    }

    renderAlphabet();

}

function renderAlphabet() {
    const container = document.getElementById("alphabetDisplay");
    container.innerHTML = "";

    for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const span = document.createElement("span");
        span.classList.add("alphabet-letter");
        span.textContent = letter;

        if (guessedCorrectLetters.has(letter)) {
            span.classList.add("correct");
        } else if (guessedIncorrectLetters.has(letter)) {
            span.classList.add("incorrect");
        }

        span.addEventListener("click", () => handleLetterGuess(letter));
        container.appendChild(span);
    }
}
function updateIncorrectGuessesDisplay() {
    const remaining = maxWrong - wrongGuesses;
    document.getElementById("incorrectGuessesDisplay").textContent = `${remaining}`;
} //is this working?
function handleLetterGuess(letter) {
    if (!/^[A-Z]$/.test(letter)) return;
    if (!startTime) startStopwatch();

    if (guessedCorrectLetters.has(letter) || guessedIncorrectLetters.has(letter)) return;

    let foundMatch = false;

    splitHeadline.forEach((word, index) => {
        if (word.includes(letter)) {
            wordGuesses[index].add(letter);
            foundMatch = true;

            const allGuessed = [...word].every(char => {
                const isLetter = /^[A-Z]$/.test(char);
                return !isLetter || wordGuesses[index].has(char);
            });

            if (allGuessed) {
                wordCompleted[index] = true;
            }
        }
    });

    if (wordCompleted.every(Boolean)) {
        endGame("You Win!");
        return;
    }

    if (foundMatch) {
        guessedCorrectLetters.add(letter);
    } else {
        guessedIncorrectLetters.add(letter);
        wrongGuesses++;
        updateIncorrectGuessesDisplay();

        if (wrongGuesses >= maxWrong) {
            endGame("Too many mistakes!");
            return;
        }
    }

    updateDisplay();
    renderAlphabet();
}

function startStopwatch() {
    startTime = Date.now();
    timerInterval = setInterval(updateStopwatch, 100);
}
function updateStopwatch() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    document.getElementById("StopwatchDisplay").textContent = ` ${elapsed}s`;
}
function stopStopwatch() {
    clearInterval(timerInterval);
    timerInterval = null;
    // Do NOT reset startTime or change the text content.
}

function updateScoreDisplay() {
    document.getElementById("ScoreDisplay").textContent = ` ${score.toFixed(1)}`;
}

function saveToHistory(headline, score, timeTaken) {
    const history = JSON.parse(localStorage.getItem("newslesleHistory")) || [];
    history.push({ headline, score, timeTaken });
    localStorage.setItem("newslesleHistory", JSON.stringify(history));

    // Save completed headlines for exclusion
    const completed = new Set(JSON.parse(localStorage.getItem("completedHeadlines")) || []);
    completed.add(headline);
    localStorage.setItem("completedHeadlines", JSON.stringify([...completed]));

    renderHistoryList(); // Refresh list
}
function renderHistoryList(filter = "") {
    const history = JSON.parse(localStorage.getItem("newslesleHistory")) || [];
    const container = document.getElementById("historyList");
    container.innerHTML = "";

    history.filter(entry => entry.headline.toLowerCase().includes(filter.toLowerCase()))
        .forEach(entry => {
            const div = document.createElement("div");
            div.classList.add("history-item");
            div.innerHTML = `
                <h4>${titleCase(entry.headline)}</h4>
                <div>Score: ${entry.score}</div>
                <div>Time: ${entry.timeTaken.toFixed(1)}s</div>
            `;
            container.appendChild(div);
        });
}

function endGame(message) {
    stopStopwatch();
    const timeTaken = (Date.now() - startTime) / 1000;
    const playerLost = wrongGuesses >= maxWrong;
    score = playerLost ? 0 : parseFloat((1000 / timeTaken).toFixed(1));
    const articleImageElement = document.getElementById("articleImage");
    const flipContainer = document.getElementById("flipContainer");
    const flipResultText = document.getElementById("flipResultText");

    document.removeEventListener("keydown", keyboardListener);
    document.getElementById("wordDisplay").style.display = "none";

    const aestheticBox = document.getElementById("aestheticBox");
    aestheticBox.style.display = "block";

    const aestheticHeadline = document.getElementById("aestheticHeadline");
    const synopsisEl = document.getElementById("headlineSynopsis");
    const regionTag = document.getElementById("regionTag");

    aestheticHeadline.textContent = titleCase(headline);
    synopsisEl.textContent = articleDescription;
    regionTag.style.display = "block";
    synopsisEl.style.display = "block";

    aestheticBox.classList.add("fade-in");
    regionTag.classList.add("fade-in");
    synopsisEl.classList.add("fade-in");

    const actionLinks = document.createElement("div");
    actionLinks.classList.add("endgame-links");

    actionLinks.innerHTML = `
        <a href="${articleURL}" target="_blank" class="aesthetic-button">Read Full Article</a>
        <button class="aesthetic-button" id="nextArticleBtn">Next Article</button>
    `;

    const existingLinks = aestheticBox.querySelector(".endgame-links");
    if (existingLinks) existingLinks.remove();

    aestheticBox.appendChild(actionLinks);

    document.getElementById("nextArticleBtn").addEventListener("click", () => location.reload());
    // Remove any existing flip state
    // flipContainer.classList.remove("flip-success", "flip-fail");

    if (wordCompleted.every(Boolean)) {
    saveToHistory(headline, score, (Date.now() - startTime) / 1000);
    }

    // Trigger flip with appropriate result
    if (playerLost) {
        flipResultText.textContent = "Fail";
        flipContainer.classList.add("flip-fail");
    } else if (wordCompleted.every(Boolean)) {
        flipResultText.textContent = "Success";
        flipContainer.classList.add("flip-success");
    }

    //Flip back to article image after 5 seconds
        setTimeout(() => {
            flipContainer.classList.remove("flip-success", "flip-fail");
            flipContainer.style.setProperty("margin-bottom", "-1rem", "important");
        }, 3000);

    updateScoreDisplay();
}

const historyToggle = document.getElementById("historyToggle");
const historyPanel = document.getElementById("historyPanel");
    historyToggle.addEventListener("click", (event) => {
            historyPanel.classList.add("open");
            historyToggle.style.display = "none";

            // Delay adding the listener to avoid immediate trigger from this click
            setTimeout(() => {
                document.addEventListener("click", handleOutsideClick);
            }, 0);
        }); 
function handleOutsideClick(event) {
    // If the click is outside the historyPanel, close it and show toggle again
    if (!historyPanel.contains(event.target)) {
        historyPanel.classList.remove("open");
        historyToggle.style.display = "inline-block";
        document.removeEventListener("click", handleOutsideClick);
    }
}
document.getElementById("historySearch").addEventListener("input", (e) => {
    renderHistoryList(e.target.value);
});
document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    if (confirm("Clear all saved history?")) {
        localStorage.removeItem("newslesleHistory");
        localStorage.removeItem("completedHeadlines");
        renderHistoryList();
    }
});
renderHistoryList();