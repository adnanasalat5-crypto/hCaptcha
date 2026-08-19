const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '60mb' }));

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(DATA_DIR, 'database.json');

let hcaptchaPending = {};
let hcaptchaTrained = {};

// 🎯 Concept Image Bank: { [conceptKey]: Set of valid image dHashes }
let conceptBank = {};

function getCleanKey(task) {
    // ✅ FIXED: sirf prompt text use karo — refHash animated hota hai, har baar badalta hai
    let p = (task.prompt || "").split("|||")[0].trim().toLowerCase();
    return "TXT_" + p;
}

function rebuildConceptBank() {
    conceptBank = {};
    for (let id in hcaptchaTrained) {
        let tr = hcaptchaTrained[id];
        let cKey = getCleanKey(tr);
        if (!conceptBank[cKey]) conceptBank[cKey] = new Set();
        
        (tr.clicks || []).forEach(idx => {
            if (tr.media && tr.media[idx] && tr.media[idx].dhash && tr.media[idx].dhash !== "0000000000000000") {
                conceptBank[cKey].add(tr.media[idx].dhash);
            }
        });
    }
}

function initDB() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            hcaptchaPending = {};
            hcaptchaTrained = data.trained || {};
            rebuildConceptBank();
            console.log(`[DB] Engine Loaded. Clean Concept Categories: ${Object.keys(conceptBank).length}`);
        } catch (e) {
            console.log("[DB] Error loading database", e);
        }
    }
}
initDB();

let saveTimeout = null;
function persistDatabase() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify({ pending: hcaptchaPending, trained: hcaptchaTrained }), 'utf8');
        } catch(err) {}
    }, 1000);
}

function getHammingDistance(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return 999;
    let diff = 0;
    for (let i = 0; i < h1.length; i++) {
        if (h1[i] !== h2[i]) diff++;
    }
    return diff;
}

// 🎯 سخت اور 100% ایکوریٹ فلٹرنگ (Strict Threshold = 3)
function evaluateAutoSolve(task) {
    if (hcaptchaTrained[task.taskId]) {
        return { solved: true, clicks: hcaptchaTrained[task.taskId].clicks || [] };
    }

    let cKey = getCleanKey(task);
    let targetDhashes = conceptBank[cKey];

    // اگر اس کیٹیگری کا ڈیٹا موجود ہو
    if (targetDhashes && targetDhashes.size > 0 && task.media && task.media.length > 1) {
        let matchedClicks = [];

        task.media.forEach((item, idx) => {
            if (!item.dhash || item.dhash === "0000000000000000") return;

            for (let savedHash of targetDhashes) {
                // 🔒 غلط سلیکشن سے بچنے کے لیے ڈسٹنس کو سخت (Strict <= 3) کر دیا گیا ہے
                if (getHammingDistance(item.dhash, savedHash) <= 3) {
                    matchedClicks.push(idx);
                    break;
                }
            }
        });

        // صرف تب کلک کرے گا جب کم از کم 1 اور زیادہ سے زیادہ 5 صحیح میچ ملیں
        if (matchedClicks.length >= 1 && matchedClicks.length <= 5) {
            let lightMedia = task.media.map(m => ({ dhash: m.dhash, type: m.type, index: m.index }));
            hcaptchaTrained[task.taskId] = {
                id: task.taskId,
                prompt: task.prompt,
                refHash: task.refHash,
                media: lightMedia,
                clicks: matchedClicks,
                trainedAt: new Date().toISOString()
            };
            return { solved: true, clicks: matchedClicks };
        }
    }
    return { solved: false };
}

app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;
    if (!task || !task.taskId) return res.json({ success: false });

    let autoRes = evaluateAutoSolve(task);
    if (autoRes.solved) {
        persistDatabase();
        // ✅ FIXED: clicks seedha response mein bhejo — polling ka wait nahi
        return res.json({ success: true, autoSolved: true, clicks: autoRes.clicks });
    }

    const keys = Object.keys(hcaptchaPending);
    if (keys.length > 60) delete hcaptchaPending[keys[0]];

    hcaptchaPending[task.taskId] = {
        id: task.taskId,
        prompt: task.prompt,
        refHash: task.refHash,
        media: task.media,
        timestamp: task.timestamp
    };
    persistDatabase();
    res.json({ success: true, autoSolved: false });
});

app.get('/api/check-hcaptcha/:id', (req, res) => {
    const tid = req.params.id;
    if (hcaptchaTrained[tid]) {
        let task = hcaptchaTrained[tid];
        res.json({ 
            status: 'solved', 
            clicks: task.clicks || [],
            // ✅ manualTrained: dashboard se manually save kiya tha
            manualTrained: task.manualTrained || false,
            // ✅ newTask: abhi pehli baar solve hua (auto-matched)
            newTask: task.aiMatched || false
        });
    } else {
        res.json({ status: 'pending' });
    }
});

app.get('/api/get-hcaptcha', (req, res) => {
    res.json({ pending: hcaptchaPending, trained: hcaptchaTrained });
});

app.post('/api/submit-hcaptcha', (req, res) => {
    const { taskId, clicks } = req.body;
    let source = hcaptchaPending[taskId] || hcaptchaTrained[taskId];
    
    if (source) {
        let lightMedia = (source.media || []).map(m => ({
            dhash: m.dhash || "",
            stableHash: m.stableHash || "",
            type: m.type || "image",
            index: m.index !== undefined ? m.index : 0,
            thumb: m.thumb || ""
        }));

        let cKey = getCleanKey(source);
        if (!conceptBank[cKey]) conceptBank[cKey] = new Set();

        (clicks || []).forEach(idx => {
            if (lightMedia[idx] && lightMedia[idx].dhash && lightMedia[idx].dhash !== "0000000000000000") {
                conceptBank[cKey].add(lightMedia[idx].dhash);
            }
        });

        hcaptchaTrained[taskId] = {
            id: taskId,
            prompt: source.prompt,
            conceptKey: getCleanKey(source),
            media: lightMedia,
            clicks: clicks || [],
            trainedAt: new Date().toISOString(),
            manualTrained: true  // ✅ Dashboard se manually save kiya
        };

        delete hcaptchaPending[taskId];
        persistDatabase();
    }
    res.json({ success: true });
});

// ✅ RESTORE: Trained → Pending wapas
app.post('/api/restore-hcaptcha', (req, res) => {
    const { taskId } = req.body;
    if (hcaptchaTrained[taskId]) {
        hcaptchaPending[taskId] = {
            ...hcaptchaTrained[taskId],
            clicks: [],
            restoredAt: new Date().toISOString()
        };
        delete hcaptchaTrained[taskId];
        rebuildConceptBank();
        persistDatabase();
        console.log(`[RESTORE] #${taskId} wapas pending mein`);
    }
    res.json({ success: true });
});

app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    delete hcaptchaPending[req.params.id];
    delete hcaptchaTrained[req.params.id];
    rebuildConceptBank();
    persistDatabase();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Strict Accuracy Engine Running on Port ${PORT}`));
