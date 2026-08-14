const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 🚀 RAILWAY VOLUME SETUP (For Permanent Data Save)
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

let db = { pending: {}, trained: {} };

if (fs.existsSync(MEMORY_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        console.log("🚀 Memory Loaded Safely from Volume!");
    } catch (e) {
        console.error("Error reading memory file. Starting fresh.", e);
    }
}

function saveDatabase() {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(db, null, 2)); } 
    catch (e) { console.error("Error saving to memory file!", e); }
}

app.post('/api/new-hcaptcha', (req, res) => {
    try {
        const { taskId, prompt, media, timestamp } = req.body;
        if (!taskId) return res.status(400).json({ error: "Task ID missing" });

        if (!db.trained[taskId]) {
            db.pending[taskId] = { id: taskId, prompt, media, timestamp: timestamp || new Date().toISOString() };
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/api/get-hcaptcha', (req, res) => { res.json(db); });

app.get('/api/check-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    if (db.trained[taskId]) {
        res.json({ success: true, data: { status: 'solved', clicks: db.trained[taskId].clicks } });
    } else {
        res.json({ success: true, data: { status: 'pending' } });
    }
});

app.post('/api/submit-hcaptcha', (req, res) => {
    try {
        const { taskId, clicks, prompt } = req.body;
        if (!taskId || !clicks) return res.status(400).json({ error: "Invalid data" });

        db.trained[taskId] = { id: taskId, prompt, clicks, media: [], timestamp: new Date().toISOString() };
        delete db.pending[taskId];
        saveDatabase();

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    delete db.pending[taskId];
    delete db.trained[taskId];
    saveDatabase();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 hCaptcha Master Server running on port ${PORT}`); });
