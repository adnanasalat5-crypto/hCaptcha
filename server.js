const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(DATA_DIR, 'database.json');

let hcaptchaPending = {};
let hcaptchaTrained = {};

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        hcaptchaPending = data.pending || {};
        hcaptchaTrained = data.trained || {};
        console.log(`[DB Loaded] Trained: ${Object.keys(hcaptchaTrained).length}, Pending: ${Object.keys(hcaptchaPending).length}`);
    } catch (e) {
        console.log("Database load error:", e);
    }
}

function saveDatabase() {
    fs.writeFile(DB_FILE, JSON.stringify({ pending: hcaptchaPending, trained: hcaptchaTrained }), 'utf8', (err) => {
        if (err) console.error("[ERROR] Failed to save database:", err);
    });
}

// ==========================================
// ✅ FIXED: SMART MATCHING FUNCTION
// Same task dobara aane par reliably auto-solve karega
// ==========================================
function tryAutoSolve(task) {
    // Step 1: Exact same taskId already trained hai?
    if (hcaptchaTrained[task.taskId]) {
        console.log(`[AUTO-SOLVE] Exact ID match #${task.taskId}`);
        return { solved: true, clicks: hcaptchaTrained[task.taskId].clicks };
    }

    let newPrompt = (task.prompt || "").split('|||')[0].trim().toLowerCase();
    let newMediaHashes = (task.media || []).map(m => m.stableHash).filter(Boolean);
    let isGrid = task.media && task.media.length > 1;

    // Step 2: Trained tasks mein dhundo
    for (const trainedId in hcaptchaTrained) {
        const trained = hcaptchaTrained[trainedId];

        // Prompt match hona zaroori hai
        let trainedPrompt = (trained.prompt || "").split('|||')[0].trim().toLowerCase();
        if (trainedPrompt !== newPrompt) continue;

        let trainedHashes = (trained.media || []).map(m => m.stableHash).filter(Boolean);
        if (trainedHashes.length === 0 || newMediaHashes.length === 0) continue;

        // ==========================================
        // GRID TASKS (3x3 image grid)
        // ==========================================
        if (isGrid && task.media.length === (trained.media || []).length) {
            // Trained clicks ko hashes mein convert karo
            let clickedHashes = (trained.clicks || [])
                .map(idx => trained.media[idx] && trained.media[idx].stableHash)
                .filter(Boolean);

            if (clickedHashes.length === 0) continue;

            // Naye task mein same hashes dhundo (shuffled position par bhi)
            let newClicks = [];
            for (let i = 0; i < task.media.length; i++) {
                if (task.media[i].stableHash && clickedHashes.includes(task.media[i].stableHash)) {
                    newClicks.push(i);
                }
            }

            // ✅ Sirf tab solve karo jab EXACT same number of matches hon
            if (newClicks.length > 0 && newClicks.length === clickedHashes.length) {
                console.log(`[AUTO-SOLVE] Grid match! ${newClicks.length} clicks. Task #${task.taskId}`);
                // Save karo future ke liye
                hcaptchaTrained[task.taskId] = {
                    id: task.taskId,
                    prompt: task.prompt,
                    media: task.media.map(m => ({ stableHash: m.stableHash, type: m.type })),
                    clicks: newClicks,
                    trainedAt: new Date().toISOString(),
                    aiMatched: true
                };
                return { solved: true, clicks: newClicks };
            }
        }

        // ==========================================
        // CANVAS / SINGLE IMAGE TASKS (tigers, arrows, etc.)
        // ==========================================
        else if (!isGrid && task.media.length > 0) {
            let newLastHash = task.media[task.media.length - 1].stableHash;
            let trainedLastHash = trained.media && trained.media.length > 0
                ? trained.media[trained.media.length - 1].stableHash
                : null;

            // ✅ Exact hash match — same image, same clicks
            if (newLastHash && trainedLastHash && newLastHash === trainedLastHash) {
                console.log(`[AUTO-SOLVE] Canvas exact match! Task #${task.taskId}`);
                hcaptchaTrained[task.taskId] = {
                    id: task.taskId,
                    prompt: task.prompt,
                    media: task.media.map(m => ({ stableHash: m.stableHash, type: m.type })),
                    clicks: trained.clicks,
                    trainedAt: new Date().toISOString(),
                    aiMatched: true
                };
                return { solved: true, clicks: trained.clicks };
            }
        }
    }

    return { solved: false };
}

// ==========================================
// API ROUTES
// ==========================================

// Naya task aaya
app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;

    if (!task || !task.taskId) {
        return res.json({ success: false, error: "Invalid task" });
    }

    // Auto-solve try karo
    let result = tryAutoSolve(task);

    if (result.solved) {
        saveDatabase();
        return res.json({ success: true, autoSolved: true });
    }

    // Pending mein daalo — Dashboard pe dikhega
    hcaptchaPending[task.taskId] = {
        id: task.taskId,
        prompt: task.prompt,
        media: task.media,
        timestamp: task.timestamp
    };
    console.log(`[NEW TASK] #${task.taskId} → Dashboard pe bheja`);
    saveDatabase();
    res.json({ success: true, autoSolved: false });
});

// Extension polling — check karo solved hai ya nahi
app.get('/api/check-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;

    if (hcaptchaTrained[taskId]) {
        // ✅ FIXED: Clicks directly array mein return karo
        let clicks = hcaptchaTrained[taskId].clicks;
        console.log(`[CHECK] Task #${taskId} → SOLVED (${clicks ? clicks.length : 0} clicks)`);
        res.json({ status: 'solved', clicks: clicks });
    } else {
        res.json({ status: 'pending' });
    }
});

// Saara data dashboard ke liye
app.get('/api/get-hcaptcha', (req, res) => {
    res.json({ pending: hcaptchaPending, trained: hcaptchaTrained });
});

// Dashboard se manually solve kiya
app.post('/api/submit-hcaptcha', (req, res) => {
    const { taskId, clicks } = req.body;

    if (!taskId || !clicks) {
        return res.json({ success: false, error: "taskId aur clicks zaroori hain" });
    }

    if (hcaptchaPending[taskId]) {
        let lightweightMedia = hcaptchaPending[taskId].media.map(m => ({
            type: m.type,
            stableHash: m.stableHash,
            index: m.index
        }));

        hcaptchaTrained[taskId] = {
            id: taskId,
            prompt: hcaptchaPending[taskId].prompt,
            media: lightweightMedia,
            clicks: clicks,
            trainedAt: new Date().toISOString()
        };

        delete hcaptchaPending[taskId];
        console.log(`[TRAINED] Task #${taskId} saved. Clicks: ${clicks.length}`);
        saveDatabase();
    } else {
        // Pehle se trained task update karo
        if (hcaptchaTrained[taskId]) {
            hcaptchaTrained[taskId].clicks = clicks;
            hcaptchaTrained[taskId].trainedAt = new Date().toISOString();
            console.log(`[UPDATED] Task #${taskId} clicks updated.`);
            saveDatabase();
        }
    }

    res.json({ success: true });
});

// Task delete karo
app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    delete hcaptchaPending[taskId];
    delete hcaptchaTrained[taskId];
    console.log(`[DELETED] Task #${taskId}`);
    saveDatabase();
    res.json({ success: true });
});

// Server health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        trained: Object.keys(hcaptchaTrained).length,
        pending: Object.keys(hcaptchaPending).length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`hCaptcha Server running on port ${PORT} 🚀`);
    console.log(`Trained: ${Object.keys(hcaptchaTrained).length}, Pending: ${Object.keys(hcaptchaPending).length}`);
});
