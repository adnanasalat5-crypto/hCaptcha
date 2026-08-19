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
let conceptBank = {};

function getCleanKey(task) {
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

// ✅ FIX: Task immediately save hoga taakay wapas pending mein na jaye
function persistDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({ pending: hcaptchaPending, trained: hcaptchaTrained }), 'utf8');
    } catch(err) {
        console.log("[DB] Error saving data", err);
    }
}

app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;
    if (!task || !task.taskId) return res.json({ success: false });

    // ✅ Sirf exact matched tasks auto-solve honge, AI site pe ghalat click nahi marega
    if (hcaptchaTrained[task.taskId]) {
        return res.json({ success: true, autoSolved: true });
    }

    const keys = Object.keys(hcaptchaPending);
    if (keys.length >= 80) delete hcaptchaPending[keys[0]];

    hcaptchaPending[task.taskId] = {
        id: task.taskId,
        prompt: task.prompt,
        refHash: task.refHash,
        media: task.media,
        timestamp: task.timestamp
    };

    res.json({ success: true, autoSolved: false });
});

app.get('/api/check-hcaptcha/:id', (req, res) => {
    const tid = req.params.id;
    if (hcaptchaTrained[tid]) {
        res.json({ status: 'solved', clicks: hcaptchaTrained[tid].clicks || [] });
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
            trainedAt: new Date().toISOString()
        };

        delete hcaptchaPending[taskId];
        persistDatabase();
    }
    res.json({ success: true });
});

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
