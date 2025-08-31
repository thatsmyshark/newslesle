/* main.js — server-backed version (fully replaces localStorage) */

/* =========================
   Game state (unchanged)
   ========================= */
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
let lastKnownStreak = 0;
let StreakCelebrationDate = null; // date string "YYYY-MM-DD" of last celebration
let score = 0;
let completedHeadlines = new Set(); // session-only cache (optional)
let guessedCorrectLetters = new Set();
let guessedIncorrectLetters = new Set();

/* =========================
   Small server helpers
   - All persistence now hits the Flask endpoints:
     /status  (GET)  -> returns {canPlay, playsToday, maxDaily, streak, firstPlayDate}
     /headline (GET) -> returns a headline or 429/204
     /play     (POST)-> save a completed play {headline, score, timeTaken, url, sourceName, publishedAt}
     /history  (GET/DELETE) -> list of history entries or clear
   ========================= */

async function getJSON(path, opts = {}) {
    const res = await fetch(path, opts);
    // If non-JSON (e.g., 204), handle elsewhere
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    return { status: res.status, json, ok: res.ok };
}

async function postJSON(path, payload) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, ok: res.ok };
}

/* =========================
   Init: check limit using /status
   (replaces checkLimit/localStorage check)
   ========================= */
(async function init() {
    try {
        const { json } = await getJSON("/status");
        if (json) {
            lastKnownStreak = json.streak || 0;   // remember starting streak
        }
        if (json && json.canPlay) {
            await getValidHeadline();
        } else {
            showLimitPopup();
            getValidHeadline(); // try preview fetch
        }
    } catch (err) {
        console.error("Failed to get status:", err);
        await getValidHeadline();
    }
})();


/* =========================
   Keyboard handling (unchanged)
   ========================= */
function keyboardListener(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) {
        handleLetterGuess(key);
    }
}

/* =========================
   HEADLINE fetching
   - uses /headline endpoint (server filters played headlines)
   - handles 429 (limit), 204 (no new headlines), and success
   ========================= */
async function getValidHeadline(attempts = 0) {
    if (attempts >= 5) {
        alert("No new headlines available.");
        return;
    }

    try {
        const res = await fetch("/headline");
        if (res.status === 429) {
            // user hit limit
            showLimitPopup();
            // server supports previewing an image — try preview fetch
            const preview = await fetch("/headline?preview=1").then(r => r.json()).catch(() => null);
            if (preview && preview.urlToImage) {
                articleImage = preview.urlToImage;
                const articleImageElement = document.getElementById("articleImage");
                if (articleImageElement) {
                    articleImageElement.src = articleImage;
                    articleImageElement.style.display = "block";
                }
            }
            return;
        }
        if (res.status === 204) {
            alert("No new headlines available.");
            return;
        }
        const data = await res.json();
        // server should only return unseen headlines; directly setup
        setupGame(data);
    } catch (err) {
        console.error("Failed to fetch headline:", err);
    }
}

/* =========================
   Start / stop game listeners
   ========================= */
function startGame() {
    gameActive = true;
    document.addEventListener("keydown", keyboardListener);
}
function showLimitPopup() {
    const limitDiv = document.getElementById("limitMessage");
    if (limitDiv) {
        limitDiv.innerHTML = `All done! Come back tomorrow for more headlines to solve!`;
        limitDiv.style.display = "block";
    }
}


/* =========================
   Daily-limit functions
   - replaced local increment/check with server-driven endpoints via /status and /play
   - incrementDailyCount is no longer necessary because /play saves and enforces cap server-side.
   - we keep a helper that calls /status for "checkLimit" behaviour
   ========================= */

async function checkLimit() {
    // returns boolean; used elsewhere before fetching
    try {
        const { json } = await getJSON("/status");
        return json ? json.canPlay : true;
    } catch (err) {
        console.error("checkLimit error:", err);
        // assume allowed if endpoint fails (to not block)
        return true;
    }
}

// debug: server-side reset of history (DELETE /history)
window.resetDailyLimitDebug = async function() {
    try {
        const { status, json } = await fetch("/history", { method: "DELETE" }).then(r => ({ status: r.status, json: r.status === 200 ? r.json() : null })).catch(() => ({ status: 500 }));
        console.log("Server history cleared (status):", status);
    } catch (err) {
        console.error("Reset debug failed:", err);
    }
};

window.CheckCountDebug = async function() {
    try {
        const { json } = await getJSON("/status");
        console.log("Plays today (server):", json ? json.playsToday : "unknown");
    } catch (err) {
        console.error("CheckCountDebug failed:", err);
    }
};

window.CheckCurrentDate = function() {
    const today = new Date().toLocaleDateString('en-CA');
    console.log("Current date:", today);
};

/* =========================
   Setup game display (unchanged logic)
   ========================= */
function setupGame(data) {
    startGame();
    headline = data.headline;
    splitHeadline = headline.split(" ");
    wordGuesses = splitHeadline.map(() => new Set());
    wordCompleted = splitHeadline.map(word => [...word].every(char => !/^[A-Z]$/.test(char)));
    articleURL = data.url;
    articleImage = data.urlToImage;
    articleDescription = data.description;
    articlePublicationDate = data.publishedAt; // ISO string

    const regionTagEl = document.getElementById("regionTag");
    if (regionTagEl) {
        regionTagEl.innerHTML = `Retrieved from: <strong>${data.sourceName || "News Outlet Name"}</strong> (Published on: <strong>${formatDateSimple(articlePublicationDate)}</strong>)`;
    }

    updateIncorrectGuessesDisplay();
    updateDisplay();
    renderAlphabet();
}

/* =========================
   Utilities (unchanged)
   ========================= */
function formatDateSimple(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function titleCase(str) {
    return str.toLowerCase().split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

/* =========================
   Display update (unchanged)
   ========================= */
function updateDisplay() {
    const wordDisplay = document.getElementById("wordDisplay");
    if (!wordDisplay) return;
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
        wordDisplay.style.display = "none";
        const aestheticBox = document.getElementById("aestheticBox");
        if (aestheticBox) aestheticBox.style.display = "block";
        const aestheticHeadline = document.getElementById("aestheticHeadline");
        if (aestheticHeadline) aestheticHeadline.textContent = titleCase(composedHeadline.trim());
        const synopsisEl = document.getElementById("headlineSynopsis");
        if (synopsisEl) synopsisEl.textContent = articleDescription;
        const regionTag = document.getElementById("regionTag");
        if (regionTag) regionTag.style.display = "block";
        if (synopsisEl) synopsisEl.style.display = "block";
        if (aestheticBox) aestheticBox.classList.add("fade-in");
    } else {
        const regionTag = document.getElementById('regionTag');
        const synopsis = document.getElementById('headlineSynopsis');
        if (regionTag) regionTag.style.display = 'none';
        if (synopsis) synopsis.style.display = 'none';
    }

    const articleImageElement = document.getElementById("articleImage");
    if (articleImageElement) {
        if (articleImage) {
            articleImageElement.src = articleImage;
            articleImageElement.style.display = "block";
        } else {
            articleImageElement.style.display = "none";
        }
    }

    renderAlphabet();
}

/* =========================
   Alphabet rendering & guesses (unchanged)
   ========================= */
function renderAlphabet() {
    const container = document.getElementById("alphabetDisplay");
    if (!container) return;
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
    const el = document.getElementById("incorrectGuessesDisplay");
    if (el) el.textContent = `${maxWrong - wrongGuesses}`;
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

/* =========================
   Stopwatch & score (unchanged)
   ========================= */
function startStopwatch() {
    startTime = Date.now();
    timerInterval = setInterval(updateStopwatch, 100);
}

function updateStopwatch() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const el = document.getElementById("StopwatchDisplay");
    if (el) el.textContent = ` ${elapsed}s`;
}

function stopStopwatch() {
    clearInterval(timerInterval);
    timerInterval = null;
}

function updateScoreDisplay() {
    const el = document.getElementById("ScoreDisplay");
    if (el) el.textContent = ` ${score.toFixed(1)}`;
}


/* =========================
   Calendar / History (server-backed)
   - uses GET /history which returns entries like:
     [{headline, score, timeTaken, date, url, sourceName, publishedAt}, ...]
   ========================= */

function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`; // "YYYY-MM-DD"
}

   async function renderCalendar(year, month) {
    const panel = document.getElementById("historyPanel");
    const container = document.getElementById("calendarContainer");
    const results = document.getElementById("historyResults");
    if (!panel || !container || !results) return;

    results.style.display = "none";
    container.style.display = "grid";
    container.innerHTML = "";

    const oldNav = panel.querySelector(".calendar-nav");
    if (oldNav) oldNav.remove();

    const nav = document.createElement("div");
        nav.className = "calendar-nav";
        nav.innerHTML = `
            <button class="prev" aria-label="Previous month">‹</button>
            <div class="month-title">${year}-${String(month + 1).padStart(2,"0")}</div>
            <button class="next" aria-label="Next month">›</button>
        `;
        panel.insertBefore(nav, container);

    // attach click handlers like clear/back buttons
    nav.querySelector(".prev").addEventListener("click", (e) => {
        e.stopPropagation(); // prevent outside-click from firing
        let newMonth = month - 1;
        let newYear = year;
        if (newMonth < 0) { newMonth = 11; newYear = year - 1; }
        renderCalendar(newYear, newMonth);
    });
    nav.querySelector(".next").addEventListener("click", (e) => {
        e.stopPropagation(); // prevent outside-click from firing
        let newMonth = month + 1;
        let newYear = year;
        if (newMonth > 11) { newMonth = 0; newYear = year + 1; }
        renderCalendar(newYear, newMonth);
    });

    // load history and build lookup map by date (YYYY-MM-DD)
    const { json: history } = await getJSON("/history");
    const historyList = Array.isArray(history) ? history : [];
    const historyMap = {};
    historyList.forEach(entry => {
        if (!entry.date) return;
        historyMap[entry.date] = historyMap[entry.date] || [];
        historyMap[entry.date].push(entry);
    });

    // get firstPlayDate from /status if available
    const { json: statusJson } = await getJSON("/status");
    const firstPlayRaw = (statusJson && statusJson.firstPlayDate) ? statusJson.firstPlayDate : new Date().toISOString().split("T")[0];
    const firstPlay = new Date(firstPlayRaw + "T00:00:00");
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

        if (hasPlays) {
            dayEl.classList.add("completed");
            dayEl.addEventListener("click", () => {
                renderDayEntries(dateStr, year, month);
            });
        } else if (beforeFirstPlay || afterToday) {
            dayEl.classList.add("greyed");
        } else {
            dayEl.classList.add("clickable");
            dayEl.addEventListener("click", () => {
                renderDayEntries(dateStr, year, month);
            });
        }

        container.appendChild(dayEl);
    }

    await renderStreakDisplay(); // Update streak after calendar renders
}

async function renderDayEntries(dateString, year = null, month = null) {
    const container = document.getElementById("calendarContainer");
    const results = document.getElementById("historyResults");
    const panel = document.getElementById("historyPanel");
    if (!container || !results || !panel) return;

    // hide month calendar container and its nav
    container.style.display = "none";
    const monthNav = panel.querySelector(".calendar-nav");
    if (monthNav) monthNav.style.display = "none";

    // show results container for day entries
    results.style.display = "block";
    results.innerHTML = "";

    // Remove any old nav in results
    const oldNav = results.querySelector(".calendar-nav");
    if (oldNav) oldNav.remove();

    // Day-navigation styled like month navigation
    const dayNav = document.createElement("div");
    dayNav.className = "calendar-nav day-nav";

    const backBtn = document.createElement("button");
    backBtn.className = "prev";
    backBtn.setAttribute("aria-label", "Back to month");
    backBtn.textContent = "‹";
    backBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // show the month calendar and nav again
        container.style.display = "grid";
        if (monthNav) monthNav.style.display = "flex";
        results.style.display = "none";
    });

    const titleDiv = document.createElement("div");
    titleDiv.className = "month-title";
    titleDiv.textContent = dateString;

    dayNav.appendChild(backBtn);
    dayNav.appendChild(titleDiv);
    results.prepend(dayNav);

    // fetch history
    const { json: history } = await getJSON("/history");
    const historyList = Array.isArray(history) ? history : [];

    const entries = historyList.filter(h => h.date === dateString);
    const dayResults = document.createElement("div");
    dayResults.id = "dayResults";
    results.appendChild(dayResults);

    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.classList.add("empty-history");
        empty.textContent = "No entries for this day.";
        dayResults.appendChild(empty);
        return;
    }

    // Build UI for each entry
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

async function renderSearchResults(filter) {
    const container = document.getElementById("calendarContainer");
    const results = document.getElementById("historyResults");
    if (!container || !results) return;

    container.style.display = "none";
    results.style.display = "block";
    results.innerHTML = "";

    // fetch history
    const { json: history } = await getJSON("/history");
    const historyList = Array.isArray(history) ? history : [];

    const backRow = document.createElement("div");
    backRow.className = "history-back";
    const backBtn = document.createElement("button");
    backBtn.id = "backBtn";
    backBtn.textContent = "← Back to month";
    backBtn.onclick = () => {
        const now = new Date();
        renderCalendar(now.getFullYear(), now.getMonth());
        const search = document.getElementById("historySearch");
        if (search) search.value = "";
    };

    results.appendChild(backRow);
    backRow.appendChild(backBtn);

    const heading = document.createElement("h3");
    heading.className = "history-day-date-heading";
    heading.id = "dateHeading";
    heading.textContent = `Search results: "${filter}"`;
    results.appendChild(heading);

    const matches = historyList.filter(entry => entry.headline.toLowerCase().includes(filter.toLowerCase()));
    if (matches.length === 0) {
        const none = document.createElement("div");
        none.textContent = `No history items match "${filter}".`;
        results.appendChild(none);
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
        results.appendChild(div);
    });
}

/* =========================
   Saving history / play
   - POST to /play (server enforces daily cap and returns status)
   - saveToHistory returns the server response for use
   ========================= */
async function saveToHistory(headlineArg, scoreArg, timeTakenArg) {
    const currentDateString = getLocalDateString(); // "YYYY-MM-DD"
    const payload = {
        headline: headlineArg,
        score: scoreArg,
        timeTaken: timeTakenArg,
        date: currentDateString,
        url: articleURL,
        sourceName: (window.__lastSourceName || ""),
        publishedAt: articlePublicationDate
    };
    try {
        const { status, json } = await postJSON("/play", payload);
        if (status === 429) {
            // server says daily cap reached (race condition)
            showLimitPopup();
        }
        return json;
    } catch (err) {
        console.error("saveToHistory error:", err);
        return null;
    }
}

/* =========================
   Streak calculations & UI
   - Uses /status for quick info where possible
   ========================= */
async function calculateStreak() {
    const { json } = await getJSON("/status");
    return json && typeof json.streak === "number" ? json.streak : 0;
}

async function renderStreakDisplay() {
    const streak = await calculateStreak();
    let streakEl = document.getElementById("streakDisplay");

    if (!streakEl) {
        streakEl = document.createElement("div");
        streakEl.id = "streakDisplay";
        streakEl.className = "streak-display";
    }

    streakEl.innerHTML = `
        <div class="streak-box">
            <div class="streak-label">${streak} Day${streak === 1 ? "" : "s"} Streak</div>
        </div>
        <div class="triangle-container"></div>
    `;
    streakEl.dataset.streak = streak;

    const panel = document.getElementById("historyPanel");
    if (!panel) return;

    // find existing nav
    const nav = panel.querySelector(".calendar-nav");

    if (nav) {
        // insert streak display *before* nav
        panel.insertBefore(streakEl, nav);
    } else {
        // if nav doesn't exist yet, just append normally
        panel.appendChild(streakEl);
    }
}

function triggerStreakAnimation() {
    const streakEl = document.getElementById("streakDisplay");
    if (!streakEl) return;

    const streak = parseInt(streakEl.dataset.streak || "0", 10);
    const label = streakEl.querySelector(".streak-label");
    const box = streakEl.querySelector(".streak-box");
    if (!label || !box) return;

    label.classList.add("flash-gold-text");

    setTimeout(() => {
        box.classList.remove("flash-gold");
        label.classList.remove("flash-gold-text");

        const panel = document.getElementById("historyPanel");
        const rect = label.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const startX = rect.left + rect.width / 2 - panelRect.left;
        const startY = rect.top - panelRect.top;

        const triangleCount = Math.min(streak * 6, 40);
        const triangles = [];

        function seededRandom(seed) {
            const x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        }

        for (let i = 0; i < triangleCount; i++) {
            const t = document.createElement("div");
            t.className = "streak-triangle";
            t.style.position = "absolute";
            t.style.left = `${startX}px`;
            t.style.top = `${startY}px`;

            const size = 6 + seededRandom(i + 10) * 12;
            t.style.borderLeft = `${size}px solid transparent`;
            t.style.borderRight = `${size}px solid transparent`;
            t.style.borderBottom = `${size * 1.5}px solid #decb9e`;

            const dx = seededRandom(i + 1) * 120 - 60;
            const dy = -(seededRandom(i + 2) * 100 + 50);
            const rot = seededRandom(i + 3) * 720 - 360;
            const duration = 800 + seededRandom(i + 4) * 800;

            t.animate([
                { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
                { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 }
            ], { duration: duration, easing: 'ease-out', fill: 'forwards' });

            panel.appendChild(t);
            triangles.push(t);
        }

        setTimeout(() => {
            triangles.forEach(t => t.remove());
        }, 1800);

    }, 500);
}

function showStreakCelebration(newStreak) {
    const overlay = document.createElement("div");
    overlay.className = "streak-overlay";

    const dayLabel = newStreak === 1 ? "day" : "days";

    overlay.innerHTML = `
        <div class="streak-text">
            <div class="streak-days">${newStreak} ${dayLabel} streak!</div>
            <div class="streak-sub">Come back tomorrow to keep it going!</div>
        </div>
        <div class="triangle-rain"></div>
    `;

    document.body.appendChild(overlay);

    const rain = overlay.querySelector(".triangle-rain");
    for (let i = 0; i < 25; i++) {
        const t = document.createElement("div");
        t.className = "triangle";
        t.style.left = `${Math.random() * 100}vw`;
        t.style.animationDelay = `${Math.random() * 1.5}s`;
        t.style.animationDuration = `${1.5 + Math.random()}s`;
        rain.appendChild(t);
    }

    overlay.addEventListener("click", () => {
        overlay.classList.add("fade-out");
        setTimeout(() => overlay.remove(), 700);
    });
}

/* =========================
   END GAME (finish)
   - On win: POST to /play to save play and get the new streak (server increments)
   - On lose: just show fail state
   ========================= */
async function endGame(message) {
    stopStopwatch();
    const timeTaken = (Date.now() - startTime) / 1000;
    const currentDateString = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const playerLost = wrongGuesses >= maxWrong;
    score = playerLost ? 0 : parseFloat((1000 / timeTaken).toFixed(1));

    gameActive = false;
    document.removeEventListener("keydown", keyboardListener);
    const wordDisplay = document.getElementById("wordDisplay");
    if (wordDisplay) wordDisplay.style.display = "none";

    const aestheticBox = document.getElementById("aestheticBox");
    if (aestheticBox) aestheticBox.style.display = "block";

    const aestheticHeadline = document.getElementById("aestheticHeadline");
    const synopsisEl = document.getElementById("headlineSynopsis");
    const regionTag = document.getElementById("regionTag");
    const publicationDateEl = document.getElementById("publicationDate");

    if (aestheticHeadline) aestheticHeadline.textContent = titleCase(headline);
    if (synopsisEl) synopsisEl.textContent = articleDescription;
    if (regionTag) regionTag.style.display = "block";
    if (synopsisEl) synopsisEl.style.display = "block";
    if (publicationDateEl) publicationDateEl.style.display = "block";

    if (aestheticBox) aestheticBox.classList.add("fade-in");
    if (regionTag) regionTag.classList.add("fade-in");
    if (synopsisEl) synopsisEl.classList.add("fade-in");
    if (publicationDateEl) publicationDateEl.classList.add("fade-in");

    const actionLinks = document.createElement("div");
    actionLinks.classList.add("endgame-links");
    actionLinks.innerHTML = `
        <a href="${articleURL}" target="_blank" class="aesthetic-button">Read Full Article</a>
        <button class="aesthetic-button" id="nextArticleBtn">Next Article</button>
    `;

    const existingLinks = aestheticBox ? aestheticBox.querySelector(".endgame-links") : null;
    if (existingLinks) existingLinks.remove();
    if (aestheticBox) aestheticBox.appendChild(actionLinks);

    const nextBtn = document.getElementById("nextArticleBtn");
    if (nextBtn) nextBtn.addEventListener("click", () => location.reload());

    if (!playerLost && wordCompleted.every(Boolean)) {
        // Save to server and get new streak
        const playRes = await saveToHistory(headline, score, timeTaken);
        let newStreak = 0;
        if (playRes && typeof playRes.streak === "number") newStreak = playRes.streak;
        else newStreak = await calculateStreak();

        // Check last celebrated date in sessionStorage
        const lastCelebratedDate = sessionStorage.getItem("lastStreakCelebrationDate");
        if (lastCelebratedDate !== currentDateString) {
            showStreakCelebration(newStreak);
            sessionStorage.setItem("lastStreakCelebrationDate", currentDateString);
        }
    }

    // Flip back to article image after a short delay
    const flipContainer = document.getElementById("flipContainer");
    const flipResultText = document.getElementById("flipResultText");
    if (flipResultText && flipContainer) {
        if (playerLost) {
            flipResultText.textContent = "Fail";
            flipContainer.classList.add("flip-fail");
        } else if (wordCompleted.every(Boolean)) {
            flipResultText.textContent = "Success";
            flipContainer.classList.add("flip-success");
        }
    }

    setTimeout(() => {
        if (flipContainer) {
            flipContainer.classList.remove("flip-success", "flip-fail");
            flipContainer.style.setProperty("margin-bottom", "-1rem", "important");
        }
    }, 3000);

    updateScoreDisplay();
}

/* =========================
   History panel toggles & wiring (unchanged UX)
   - Use server endpoints for data
   ========================= */

const historyToggle = document.getElementById("historyToggle");
const historyPanel = document.getElementById("historyPanel");
if (historyToggle && historyPanel) {
    historyToggle.addEventListener("click", (event) => {
        historyPanel.classList.add("open");
        historyToggle.style.display = "none";

        // Render the current month when the panel opens
        const now = new Date();
        renderCalendar(now.getFullYear(), now.getMonth());

        // Trigger streak animation once panel is open
        setTimeout(() => triggerStreakAnimation(), 300);

        // Delay adding the outside-click listener to avoid immediate close
        setTimeout(() => {
            document.addEventListener("click", handleOutsideClick);
        }, 0);
    });
}

function handleOutsideClick(event) {
    if (!historyPanel) return;
    if (!historyPanel.contains(event.target)) {
        historyPanel.classList.remove("open");
        if (historyToggle) historyToggle.style.display = "inline-block";
        document.removeEventListener("click", handleOutsideClick);
    }
}

const historySearchEl = document.getElementById("historySearch");
if (historySearchEl) {
    historySearchEl.addEventListener("input", (e) => {
        if (e.target.value.trim() === "") {
            const now = new Date();
            renderCalendar(now.getFullYear(), now.getMonth());
        } else {
            renderSearchResults(e.target.value);
        }
    });
}

const clearHistoryBtn = document.getElementById("clearHistoryBtn");
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", async () => {
        if (confirm("Clear all saved history?")) {
            // clear server history via DELETE /history
            try {
                const res = await fetch("/history", { method: "DELETE" });
                if (res.ok) {
                    const now = new Date();
                    renderCalendar(now.getFullYear(), now.getMonth());
                } else {
                    alert("Failed to clear history on server.");
                }
            } catch (err) {
                console.error("Failed to clear history:", err);
            }
        }
    });
}

/* =========================
   Extra little helpers/visuals
   (streakBurst, showStreakTrianglesFixed)
   ========================= */

function streakBurst() {
    const streakEl = document.getElementById("streakDisplay");
    if (!streakEl) return;
    streakEl.classList.add("streak-burst");
    setTimeout(() => streakEl.classList.remove("streak-burst"), 600);
}

function showStreakTrianglesFixed(streakEl, count = 10) {
    if (!streakEl) return;
    const panel = document.getElementById("historyPanel");
    const rect = streakEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    const startX = rect.left + rect.width / 2 - panelRect.left - 6;
    const startY = rect.top - panelRect.top - 10;

    const offsets = [];
    for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 10;
        offsets.push(spread);
    }

    offsets.forEach((dx) => {
        const t = document.createElement("div");
        t.className = "streak-triangle";

        t.style.left = `${startX}px`;
        t.style.top = `${startY}px`;

        t.style.setProperty('--dx', `${dx}px`);
        t.style.setProperty('--dy', `-40px`);
        t.style.setProperty('--deg', `0deg`);

        t.style.animationDuration = `1s`;
        t.style.animationTimingFunction = `ease-out`;

        panel.appendChild(t);

        setTimeout(() => t.remove(), 1200);
    });
}
