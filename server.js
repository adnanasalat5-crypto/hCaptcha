const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
// 🚀 Limit 100mb taake heavy video tasks asani se handle hon
app.use(express.json({ limit: '100mb' }));

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(DATA_DIR, 'database.json');

let hcaptchaPending = {};
let hcaptchaTrained = {};

// 🚀 Start hote hi RAM clear karega taake server crash na ho
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        hcaptchaPending = {}; // Pending flush kar diya taake RAM saaf mile
        hcaptchaTrained = data.trained || {};
        console.log(`[DB Loaded] Trained: ${Object.keys(hcaptchaTrained).length}, Pending Flushed for RAM Recovery!`);
    } catch (e) { console.log("Database load error:", e); }
}

let saveTimeout = null;
function saveDatabase() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        fs.writeFile(DB_FILE, JSON.stringify({ pending: hcaptchaPending, trained: hcaptchaTrained }), 'utf8', (err) => {
            if (err) console.error("[ERROR] Failed to save database:", err);
        });
    }, 2000); 
}

function getHammingDistance(s1, s2) {
    if (!s1 || !s2 || s1.length !== s2.length) return 999;
    let diff = 0;
    for (let i = 0; i < s1.length; i++) if (s1[i] !== s2[i]) diff++;
    return diff;
}

// 🚀 MATCHING ENGINE (100% same as before, no changes in logic)
function tryAutoSolve(task) {
    if (hcaptchaTrained[task.taskId]) return { solved: true, clicks: hcaptchaTrained[task.taskId].clicks };

    let newPrompt = (task.prompt || "").split('|||')[0].trim().toLowerCase();
    let isGrid = task.media && task.media.length > 1;

    if (isGrid) {
        let bankExact = new Set();
        let bankDhash = new Set();

        for (const id in hcaptchaTrained) {
            let tr = hcaptchaTrained[id];
            if ((tr.prompt || "").split('|||')[0].trim().toLowerCase() === newPrompt && tr.media.length > 1) {
                (tr.clicks || []).forEach(idx => {
                    if (tr.media[idx]) {
                        if (tr.media[idx].stableHash) bankExact.add(tr.media[idx].stableHash);
                        if (tr.media[idx].dhash) bankDhash.add(tr.media[idx].dhash);
                    }
                });
            }
        }

        if (bankExact.size > 0 || bankDhash.size > 0) {
            let newClicks = [];
            for (let i = 0; i < task.media.length; i++) {
                let m = task.media[i];
                let matched = false;
                
                if (m.stableHash && bankExact.has(m.stableHash)) {
                    matched = true; 
                } else if (m.dhash) {
                    for (let td of bankDhash) {
                        if (getHammingDistance(m.dhash, td) <= 5) { 
                            matched = true; break;
                        }
                    }
                }
                if (matched) newClicks.push(i);
            }

            if (newClicks.length > 0) {
                console.log(`[AI MATCH] Concept found for #${task.taskId} -> Clicks: ${newClicks.length}`);
                
                // Sirf hashes save honge, tasveer nahi taake RAM bache
                let lightweightMedia = task.media.map(m => ({ stableHash: m.stableHash, dhash: m.dhash, type: m.type }));
                hcaptchaTrained[task.taskId] = { id: task.taskId, prompt: task.prompt, media: lightweightMedia, clicks: newClicks, trainedAt: new Date().toISOString(), aiMatched: true };
                return { solved: true, clicks: newClicks };
            }
        }
    } else if (task.media.length > 0) {
        for (const id in hcaptchaTrained) {
            let tr = hcaptchaTrained[id];
            if ((tr.prompt || "").split('|||')[0].trim().toLowerCase() === newPrompt && tr.media.length > 0) {
                let nHash = task.media[task.media.length - 1].stableHash;
                let tHash = tr.media[tr.media.length - 1].stableHash;
                if (nHash && tHash && nHash === tHash) {
                    let lightweightMedia = task.media.map(m => ({ stableHash: m.stableHash, dhash: m.dhash, type: m.type }));
                    hcaptchaTrained[task.taskId] = { id: task.taskId, prompt: task.prompt, media: lightweightMedia, clicks: tr.clicks, trainedAt: new Date().toISOString() };
                    return { solved: true, clicks: tr.clicks };
                }
            }
        }
    }
    return { solved: false };
}

app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;
    if (!task || !task.taskId) return res.json({ success: false });

    let result = tryAutoSolve(task);
    if (result.solved) {
        saveDatabase();
        return res.json({ success: true, autoSolved: true });
    }

    // 🚀 FIX: Limit ko 30 se barha kar 100 kar diya gaya hai!
    const pendingKeys = Object.keys(hcaptchaPending);
    if (pendingKeys.length >= 100) {
        // Agar 100 se upar jaye to sab se purana task delete kar do
        delete hcaptchaPending[pendingKeys[0]];
    }

    hcaptchaPending[task.taskId] = { id: task.taskId, prompt: task.prompt, media: task.media, timestamp: task.timestamp };
    saveDatabase();
    res.json({ success: true, autoSolved: false });
});

app.get('/api/check-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    if (hcaptchaTrained[taskId]) {
        res.json({ status: 'solved', clicks: hcaptchaTrained[taskId].clicks });
    } else {
        res.json({ status: 'pending' });
    }
});

app.get('/api/get-hcaptcha', (req, res) => { res.json({ pending: hcaptchaPending, trained: hcaptchaTrained }); });

app.post('/api/submit-hcaptcha', (req, res) => {
    const { taskId, clicks } = req.body;
    if (hcaptchaPending[taskId]) {
        
        // 🚀 TRAINING DIET PLAN: Save karte waqt video/image ka wazan khatam kar dega
        let lightweightMedia = hcaptchaPending[taskId].media.map(m => ({
            type: m.type,
            index: m.index,
            stableHash: m.stableHash,
            dhash: m.dhash
        }));

        hcaptchaTrained[taskId] = { id: taskId, prompt: hcaptchaPending[taskId].prompt, media: lightweightMedia, clicks: clicks, trainedAt: new Date().toISOString() };
        delete hcaptchaPending[taskId];
    } else if (hcaptchaTrained[taskId]) {
        hcaptchaTrained[taskId].clicks = clicks;
        hcaptchaTrained[taskId].trainedAt = new Date().toISOString();
    }
    saveDatabase();
    res.json({ success: true });
});

app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    delete hcaptchaPending[req.params.id];
    delete hcaptchaTrained[req.params.id];
    saveDatabase();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`hCaptcha Hybrid AI Server running on port ${PORT} 🚀`);
});
