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

function initDB() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            hcaptchaPending = {};
            hcaptchaTrained = data.trained || {};
            
            // میموری سے تمام ٹرینڈ امیجز کا بینک ری بلڈ کریں
            for (let id in hcaptchaTrained) {
                let tr = hcaptchaTrained[id];
                let cKey = tr.refHash || tr.prompt || "default";
                if (!conceptBank[cKey]) conceptBank[cKey] = new Set();
                
                (tr.clicks || []).forEach(idx => {
                    if (tr.media && tr.media[idx] && tr.media[idx].dhash) {
                        conceptBank[cKey].add(tr.media[idx].dhash);
                    }
                });
            }
            console.log(`[DB] Engine Ready. Loaded ${Object.keys(hcaptchaTrained).length} tasks.`);
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

// 🎯 کسی بھی کالم/پوزیشن پر موجود امیج کو پہچاننا
function evaluateAutoSolve(task) {
    if (hcaptchaTrained[task.taskId]) {
        return { solved: true, clicks: hcaptchaTrained[task.taskId].clicks || [] };
    }

    let cKey = task.refHash || task.prompt || "default";
    let targetDhashes = conceptBank[cKey];

    if (targetDhashes && targetDhashes.size > 0 && task.media && task.media.length > 1) {
        let matchedClicks = [];

        task.media.forEach((item, idx) => {
            if (!item.dhash || item.dhash === "0000000000000000") return;

            // بینک میں موجود ہر محفوظ شدہ خرگوش کے ساتھ موازنہ
            for (let savedHash of targetDhashes) {
                if (getHammingDistance(item.dhash, savedHash) <= 6) { // 6 تک کا فرق ایکسیپٹ ہوگا
                    matchedClicks.push(idx);
                    break;
                }
            }
        });

        // اگر کم از کم 1 یا زیادہ مطلوبہ تصویریں مل جائیں
        if (matchedClicks.length > 0) {
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
        return res.json({ success: true, autoSolved: true });
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
            dhash: m.dhash,
            stableHash: m.stableHash,
            type: m.type,
            index: m.index
        }));

        let cKey = source.refHash || source.prompt || "default";
        if (!conceptBank[cKey]) conceptBank[cKey] = new Set();

        // بینک میں کلک شدہ امیجز شامل کریں
        (clicks || []).forEach(idx => {
            if (lightMedia[idx] && lightMedia[idx].dhash) {
                conceptBank[cKey].add(lightMedia[idx].dhash);
            }
        });

        hcaptchaTrained[taskId] = {
            id: taskId,
            prompt: source.prompt,
            refHash: source.refHash,
            media: lightMedia,
            clicks: clicks || [],
            trainedAt: new Date().toISOString()
        };

        delete hcaptchaPending[taskId];
        persistDatabase();
    }
    res.json({ success: true });
});

app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    delete hcaptchaPending[req.params.id];
    delete hcaptchaTrained[req.params.id];
    persistDatabase();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Concept Bank Engine Active on Port ${PORT}`));
