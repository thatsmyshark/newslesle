let gameActive = false;
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
let articlePublicationDate = "";
let score = 0;
let completedHeadlines = new Set();
let guessedCorrectLetters = new Set();
let guessedIncorrectLetters = new Set();
const MAX_DAILY_HEADLINES = 6;
const DATE_KEY = "headlineDate";
const COUNT_KEY = "headlineCount";

function keyboardListener(e) {
    if (e.metaKey || e.ctrlKey) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) {
        handleLetterGuess(key);
    }
}

// Only check limit before any fetch
if (checkLimit()) {
    getValidHeadline(); // Triggers the looped fetch with retry cap
} else {
    showLimitPopup(); // Rate limit hit — don’t fetch headline
}

function getValidHeadline(attempts = 0) {
    if (attempts >= 5) {
        alert("No new headlines available.");
        return;
    }

    fetch("/headline")
        .then(res => res.json())
        .then(data => {
            const completed = new Set(JSON.parse(localStorage.getItem("completedHeadlines")) || []);
            if (completed.has(data.headline)) {
                // Retry
                getValidHeadline(attempts + 1);
            } else {
                setupGame(data);            // Start the game
            }
        })
        .catch(err => {
            console.error("Failed to fetch headline:", err);
        });
}
function startGame() {
    gameActive = true;
    document.addEventListener("keydown", keyboardListener);
}

function incrementDailyCount() {
    const today = new Date().toLocaleDateString('en-CA');
    const savedDate = localStorage.getItem(DATE_KEY);
    let count = parseInt(localStorage.getItem(COUNT_KEY) || "0");

    if (savedDate !== today) {
        localStorage.setItem(DATE_KEY, today);
        localStorage.setItem(COUNT_KEY, "1");
    } else {
        localStorage.setItem(COUNT_KEY, (count + 1).toString());
    }
}   
function checkLimit() {
    const today = new Date().toLocaleDateString('en-CA');
    const savedDate = localStorage.getItem(DATE_KEY);
    let count = parseInt(localStorage.getItem(COUNT_KEY) || "0");

    if (savedDate !== today) {
        localStorage.setItem(DATE_KEY, today);
        localStorage.setItem(COUNT_KEY, "1");
        return true;
    }

    if (count < MAX_DAILY_HEADLINES) {
        return true;
    }

    return false;
}
function showLimitPopup() {
    const limitDiv = document.getElementById("limitMessage");
    if (limitDiv) {
        limitDiv.innerHTML = `All done! Come back tomorrow for more headlines to solve!`;
        limitDiv.style.display = "block";
    }

    // Still load the image
    fetch("/headline")
        .then(res => res.json())
        .then(data => {
            articleImage = data.urlToImage;
            const articleImageElement = document.getElementById("articleImage");
            if (articleImage && articleImageElement) {
                articleImageElement.src = articleImage;
                articleImageElement.style.display = "block";
            }
        });
}
function formatDateSimple(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // JS months are 0-based
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
window.resetDailyLimitDebug = function() {
    localStorage.removeItem("headlineCount");
    localStorage.removeItem("headlineDate");
    console.log("Daily play count reset.");
};  
window.CheckCountDebug = function() {
    const count = parseInt(localStorage.getItem("headlineCount") || "0");
    console.log("Sending count to server:", count);
}
window.CheckCurrentDate = function() {
    const today = new Date().toLocaleDateString('en-CA');
    console.log("Current date:", today);
}


function setupGame(data) {
    startGame();
    headline = data.headline;
    splitHeadline = headline.split(" ");
    wordGuesses = splitHeadline.map(() => new Set());
    wordCompleted = splitHeadline.map(word => [...word].every(char => !/^[A-Z]$/.test(char)));
    articleURL = data.url;
    articleImage = data.urlToImage;
    articleDescription = data.description;
    articlePublicationDate = data.publishedAt; // ISO string like "2025-08-15T12:34:56Z"

    document.getElementById("regionTag").innerHTML = 
    `Retrieved from: <strong>${data.sourceName || "News Outlet Name"}</strong> (Published on: <strong>${formatDateSimple(articlePublicationDate)}</strong>)`;

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
}
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

function startStopwatch() { // Start the stopwatch when the first letter is guessed
    startTime = Date.now();
    timerInterval = setInterval(updateStopwatch, 100);
}
function updateStopwatch() { // Update the stopwatch display every 100ms
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    document.getElementById("StopwatchDisplay").textContent = ` ${elapsed}s`;
}
function stopStopwatch() { // Stop the stopwatch without resetting
    clearInterval(timerInterval);
    timerInterval = null;
    // Do NOT reset startTime or change the text content.
}
function updateScoreDisplay() { // Update the score display based on the time taken
    document.getElementById("ScoreDisplay").textContent = ` ${score.toFixed(1)}`;
}
/* ---------------------------
   Calendar rendering + helpers
   --------------------------- */

function renderCalendar(year, month) {
    const panel = document.getElementById("historyPanel");
    const container = document.getElementById("calendarContainer");
    const results = document.getElementById("historyResults");

    // hide results, show container
    results.style.display = "none";
    container.style.display = "grid";
    container.innerHTML = "";

    // remove old nav if present (prevents duplicates)
    const oldNav = panel.querySelector(".calendar-nav");
    if (oldNav) oldNav.remove();

    // build month nav and insert before the calendar container
    const nav = document.createElement("div");
    nav.className = "calendar-nav";
    nav.innerHTML = `
        <button class="prev" aria-label="Previous month">‹</button>
        <div class="month-title">${year}-${String(month + 1).padStart(2,"0")}</div>
        <button class="next" aria-label="Next month">›</button>
    `;
    panel.insertBefore(nav, container);

    nav.querySelector(".prev").addEventListener("click", () => {
        let newMonth = month - 1;
        let newYear = year;
        if (newMonth < 0) { newMonth = 11; newYear = year - 1; }
        renderCalendar(newYear, newMonth);
    });
    nav.querySelector(".next").addEventListener("click", () => {
        let newMonth = month + 1;
        let newYear = year;
        if (newMonth > 11) { newMonth = 0; newYear = year + 1; }
        renderCalendar(newYear, newMonth);
    });

    // load history and build lookup map by date (YYYY-MM-DD)
    const history = JSON.parse(localStorage.getItem("newslesleHistory")) || [];
    const historyMap = {};
    history.forEach(entry => {
        if (!entry.date) return;
        historyMap[entry.date] = historyMap[entry.date] || [];
        historyMap[entry.date].push(entry);
    });

    // firstPlay (use stored firstPlayDate if available)
    const firstPlayRaw = localStorage.getItem("firstPlayDate") || new Date().toISOString().split("T")[0];
    const firstPlay = new Date(firstPlayRaw + "T00:00:00");
    // today at midnight (local)
    const todayRaw = new Date().toISOString().split("T")[0];
    const today = new Date(todayRaw + "T00:00:00");

    // weekday header (Sun..Sat)
    const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    weekdays.forEach(w => {
        const wEl = document.createElement("div");
        wEl.className = "calendar-weekday";
        wEl.textContent = w;
        container.appendChild(wEl);
    });

    // days calculation
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // blank placeholders before the 1st
    for (let i = 0; i < firstDayIndex; i++) {
        const blank = document.createElement("div");
        blank.className = "calendar-empty";
        container.appendChild(blank);
    }

    // create day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day, 0, 0, 0);
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const dayEl = document.createElement("div");
        dayEl.className = "calendar-day";
        dayEl.textContent = day;
        dayEl.setAttribute("data-date", dateStr);
        dayEl.title = dateStr;

        const beforeFirstPlay = dateObj < firstPlay;
        const afterToday = dateObj > today;
        const hasPlays = !!historyMap[dateStr];

        // completed headline = has plays
        if (hasPlays) {
            dayEl.classList.add("completed");
            dayEl.addEventListener("click", () => {
                renderDayEntries(dateStr, year, month);
            });
        }
        // greyed out only if before first play OR after today OR no plays and before current day
        else if (beforeFirstPlay || afterToday) {
            dayEl.classList.add("greyed");
        }
        // available but unplayed
        else {
            dayEl.classList.add("clickable");
            dayEl.addEventListener("click", () => {
                renderDayEntries(dateStr, year, month);
            });
        }

        container.appendChild(dayEl);
    }
}

function renderDayEntries(dateString, year = null, month = null) {
    const container = document.getElementById("calendarContainer");
    const results = document.getElementById("historyResults");
    const history = JSON.parse(localStorage.getItem("newslesleHistory")) || [];

    // show results, hide calendar
    container.style.display = "none";
    results.style.display = "block";

    // remove month nav if present
    const nav = document.querySelector(".calendar-nav");
    if (nav) nav.remove();

    // try to reuse existing elements from HTML (non-destructive)
    let backRow = results.querySelector(".history-back");
    let backBtn = results.querySelector("#backBtn");
    let heading = results.querySelector("#dateHeading");
    let dayResults = results.querySelector("#dayResults");

    // create missing pieces
    if (!backRow) {
        backRow = document.createElement("div");
        backRow.className = "history-back";
    }
    if (!backBtn) {
        backBtn = document.createElement("button");
        backBtn.id = "backBtn";
        backBtn.textContent = "←";
    }
    if (!heading) {
        heading = document.createElement("h3");
        heading.className = "history-day-date-heading";
        heading.id = "dateHeading";
    }
    if (!dayResults) {
        dayResults = document.createElement("div");
        dayResults.id = "dayResults";
    }

    // If results container does not already contain #dayResults, reset results and append
    if (!results.querySelector("#dayResults")) {
        results.innerHTML = "";
        results.appendChild(backRow);
        results.appendChild(dayResults);
    } else {
        // ensure backRow exists and sits before dayResults
        if (!results.contains(backRow)) {
            results.insertBefore(backRow, dayResults);
        }
    }

    // ensure backRow contains the button and heading in the right order
    if (!backRow.contains(backBtn)) backRow.appendChild(backBtn);
    if (!backRow.contains(heading)) backRow.appendChild(heading);

    // clear only the dayResults area
    dayResults.innerHTML = "";

    // set up back button (assign to avoid adding duplicate listeners)
    backBtn.onclick = () => {
        const now = new Date();
        renderCalendar(year ?? now.getFullYear(), month ?? now.getMonth());
    };

    // set heading
    heading.textContent = dateString;

    // populate entries for the day
    const entries = history.filter(h => h.date === dateString);
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.classList.add("empty-history");
        empty.textContent = "No entries for this day.";
        dayResults.appendChild(empty);
        return;
    }

    entries.forEach(entry => {
        const div = document.createElement("div");
        div.classList.add("history-item");
        div.innerHTML = `
            <h4>${titleCase(entry.headline)}</h4>
            <div>Score: ${entry.score}</div>
            <div>Time: ${parseFloat(entry.timeTaken).toFixed(1)}s</div>
        `;
        dayResults.appendChild(div);
    });
}

function renderSearchResults(filter) {
    const container = document.getElementById("calendarContainer");
    const results = document.getElementById("historyResults");
    const history = JSON.parse(localStorage.getItem("newslesleHistory")) || [];

    container.style.display = "none";
    results.style.display = "block";

    // remove month nav if present
    const nav = document.querySelector(".calendar-nav");
    if (nav) nav.remove();

    // reuse/ensure header + dayResults exist (same logic as renderDayEntries)
    let backRow = results.querySelector(".history-back");
    let backBtn = results.querySelector("#backBtn");
    let heading = results.querySelector("#dateHeading");
    let dayResults = results.querySelector("#dayResults");

    if (!backRow) {
        backRow = document.createElement("div");
        backRow.className = "history-back";
    }
    if (!backBtn) {
        backBtn = document.createElement("button");
        backBtn.id = "backBtn";
        backBtn.textContent = "← Back to month";
    }
    if (!heading) {
        heading = document.createElement("h3");
        heading.className = "history-day-date-heading";
        heading.id = "dateHeading";
    }
    if (!dayResults) {
        dayResults = document.createElement("div");
        dayResults.id = "dayResults";
    }

    if (!results.querySelector("#dayResults")) {
        results.innerHTML = "";
        results.appendChild(backRow);
        results.appendChild(dayResults);
    } else {
        if (!results.contains(backRow)) results.insertBefore(backRow, dayResults);
    }

    if (!backRow.contains(backBtn)) backRow.appendChild(backBtn);
    if (!backRow.contains(heading)) backRow.appendChild(heading);

    backBtn.onclick = () => {
        const now = new Date();
        renderCalendar(now.getFullYear(), now.getMonth());
        const search = document.getElementById("historySearch");
        if (search) search.value = "";
    };

    heading.textContent = `Search results: "${filter}"`;

    dayResults.innerHTML = "";

    const matches = history.filter(entry => entry.headline.toLowerCase().includes(filter.toLowerCase()));
    if (matches.length === 0) {
        const none = document.createElement("div");
        none.textContent = `No history items match "${filter}".`;
        dayResults.appendChild(none);
        return;
    }

    matches.forEach(entry => {
        const div = document.createElement("div");
        div.classList.add("history-item");
        div.innerHTML = `
            <h4>${titleCase(entry.headline)}</h4>
            <div>Date: ${entry.date}</div>
            <div>Score: ${entry.score}</div>
            <div>Time: ${parseFloat(entry.timeTaken).toFixed(1)}s</div>
        `;
        dayResults.appendChild(div);
    });
}

function saveToHistory(headline, score, timeTaken) {
    const history = JSON.parse(localStorage.getItem("newslesleHistory")) || [];
    const todayDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // Save firstPlayDate if not already set
    if (!localStorage.getItem("firstPlayDate")) {
        localStorage.setItem("firstPlayDate", todayDate);
    }

    // Add the new entry with the date
    history.push({ 
        headline, 
        score, 
        timeTaken, 
        date: todayDate // << Calendar key
    });

    localStorage.setItem("newslesleHistory", JSON.stringify(history));

    // Save completed headlines for exclusion in getValidHeadline()
    const completed = new Set(JSON.parse(localStorage.getItem("completedHeadlines")) || []);
    completed.add(headline);
    localStorage.setItem("completedHeadlines", JSON.stringify([...completed]));

    // No more direct list rendering — calendar handles it now
}



function endGame(message) { // End the game and display the result
    stopStopwatch();
    const timeTaken = (Date.now() - startTime) / 1000;
    const currentDateString = new Date().toLocaleDateString('en-CA');
    const playerLost = wrongGuesses >= maxWrong;
    score = playerLost ? 0 : parseFloat((1000 / timeTaken).toFixed(1));
    const articleImageElement = document.getElementById("articleImage");
    const flipContainer = document.getElementById("flipContainer");
    const flipResultText = document.getElementById("flipResultText");

    gameActive = false;
    document.removeEventListener("keydown", keyboardListener);
    document.getElementById("wordDisplay").style.display = "none";

    const aestheticBox = document.getElementById("aestheticBox");
    aestheticBox.style.display = "block";

    const aestheticHeadline = document.getElementById("aestheticHeadline");
    const synopsisEl = document.getElementById("headlineSynopsis");
    const regionTag = document.getElementById("regionTag");
    const publicationDateEl = document.getElementById("publicationDate");

    aestheticHeadline.textContent = titleCase(headline);
    synopsisEl.textContent = articleDescription;
    regionTag.style.display = "block";
    synopsisEl.style.display = "block";
    publicationDateEl.style.display = "block";

    aestheticBox.classList.add("fade-in");
    regionTag.classList.add("fade-in");
    synopsisEl.classList.add("fade-in");
    publicationDateEl.classList.add("fade-in");

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

    // Trigger flip with appropriate result
    if (playerLost) {
        flipResultText.textContent = "Fail";
        flipContainer.classList.add("flip-fail");
    } else if (wordCompleted.every(Boolean)) {
        flipResultText.textContent = "Success";
        flipContainer.classList.add("flip-success");
        incrementDailyCount();
        completedHeadlines.add(currentDateString); // e.g., "2025-08-11"
        saveToHistory(headline, score, (Date.now() - startTime) / 1000);
    }

    //Flip back to article image after 5 seconds
        setTimeout(() => {
            flipContainer.classList.remove("flip-success", "flip-fail");
            flipContainer.style.setProperty("margin-bottom", "-1rem", "important");
        }, 3000);

    
    updateScoreDisplay();
} 

// History Panel Toggle and Search Functionality
const historyToggle = document.getElementById("historyToggle");
const historyPanel = document.getElementById("historyPanel");

historyToggle.addEventListener("click", (event) => {
    historyPanel.classList.add("open");
    historyToggle.style.display = "none";

    // Render the current month when the panel opens
    const now = new Date();
    renderCalendar(now.getFullYear(), now.getMonth());

    // Delay adding the outside-click listener to avoid immediate close
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
    if (e.target.value.trim() === "") {
        const now = new Date();
        renderCalendar(now.getFullYear(), now.getMonth());
    } else {
        renderSearchResults(e.target.value);
    }
});
document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    if (confirm("Clear all saved history?")) {
        localStorage.removeItem("newslesleHistory");
        localStorage.removeItem("completedHeadlines");
        const now = new Date();
        renderCalendar(new Date().getFullYear(), new Date().getMonth());
    }
});
