const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
// 🚀 Limit can stay large for incoming tasks, but outgoing will be tiny!
app.use(express.json({ limit: '50mb' })); 

const DB_FILE = path.join(__dirname, 'database.json');

let hcaptchaPending = {};
let hcaptchaTrained = {};

// Load data on startup
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

// 🚀 SPEED FIX 1: Asynchronous Database Save (Server hang nahi hoga!)
function saveDatabase() {
    fs.writeFile(DB_FILE, JSON.stringify({ pending: hcaptchaPending, trained: hcaptchaTrained }), 'utf8', (err) => {
        if (err) console.error("[ERROR] Failed to save database:", err);
    });
}

function getSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    let matches = 0;
    const len = Math.min(str1.length, str2.length);
    for (let i = 0; i < len; i++) {
        if (str1[i] === str2[i]) matches++;
    }
    return (matches / Math.max(str1.length, str2.length)) * 100;
}

// 1. Naya hCaptcha Task Receive Karna
app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;
    
    if (hcaptchaTrained[task.taskId]) return res.json({ success: true });

    let isAutoSolved = false;

    // AI ENGINE: Fast Searching
    for (const trainedId in hcaptchaTrained) {
        const trainedTask = hcaptchaTrained[trainedId];
        
        if (!trainedTask.media || trainedTask.prompt !== task.prompt) continue;

        const isGrid = task.media.length > 1 && task.media.every(m => m.type === 'image' || m.type === 'single_image');
        
        // GRID SHUFFLE LOGIC
        if (isGrid && trainedTask.media.length === task.media.length) {
            let clickedHashes = trainedTask.clicks.map(index => trainedTask.media[index]?.stableHash).filter(Boolean);
            let newClicks = [];
            let matchCount = 0;
            
            for (let i = 0; i < task.media.length; i++) {
                if (clickedHashes.includes(task.media[i].stableHash)) {
                    newClicks.push(i);
                    matchCount++;
                }
            }

            if (matchCount > 0 && matchCount === clickedHashes.length) {
                console.log(`[AI SOLVED] Grid Shuffled Match found for #${task.taskId}`);
                
                // 🚀 SPEED FIX 2: Save Only Hashes in Trained Data, not Heavy Media
                const lightweightMedia = task.media.map(m => ({ stableHash: m.stableHash, type: m.type }));
                hcaptchaTrained[task.taskId] = { ...task, media: lightweightMedia, clicks: newClicks, trainedAt: new Date().toISOString(), aiMatched: true };
                isAutoSolved = true;
                break;
            }
        } 
        // CANVAS FUZZY LOGIC
        else if (!isGrid && task.media.length > 0 && trainedTask.media.length > 0) {
            let newHash = task.media[task.media.length - 1].stableHash; 
            let oldHash = trainedTask.media[trainedTask.media.length - 1].stableHash;
            let similarity = getSimilarity(newHash, oldHash);
            
            if (similarity >= 94) { 
                console.log(`[AI SOLVED] Canvas Fuzzy Match (${similarity.toFixed(1)}%) for #${task.taskId}`);
                
                // 🚀 SPEED FIX 2: Save Only Hashes in Trained Data
                const lightweightMedia = task.media.map(m => ({ stableHash: m.stableHash, type: m.type }));
                hcaptchaTrained[task.taskId] = { ...task, media: lightweightMedia, clicks: trainedTask.clicks, trainedAt: new Date().toISOString(), aiMatched: true };
                isAutoSolved = true;
                break;
            }
        }
    }

    if (!isAutoSolved) {
        hcaptchaPending[task.taskId] = {
            id: task.taskId,
            prompt: task.prompt,
            media: task.media, // Pending mein media zaroori hai taake dashboard par nazar aye
            timestamp: task.timestamp
        };
        console.log(`[New hCaptcha] ID: #${task.taskId} sent to Dashboard!`);
    }

    saveDatabase(); 
    res.json({ success: true });
});

// 2. Dashboard ke liye Tasks Bhejna
app.get('/api/get-hcaptcha', (req, res) => {
    // 🚀 SPEED FIX 3: Dashboard ko ab halka data mile ga
    res.json({ pending: hcaptchaPending, trained: hcaptchaTrained });
});

// 3. Extension ke liye Task Status Check Karna
app.get('/api/check-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    if (hcaptchaTrained[taskId]) {
        res.json({ status: 'solved', clicks: hcaptchaTrained[taskId].clicks });
    } else {
        res.json({ status: 'pending' });
    }
});

// 4. Dashboard se Training Data Save Karna (LIGHTWEIGHT FIX)
app.post('/api/submit-hcaptcha', (req, res) => {
    const { taskId, clicks } = req.body;
    
    if (hcaptchaPending[taskId]) {
        
        // 🚀 THE ULTIMATE SPEED FIX: Extract only Hashes, delete heavy base64 images/videos!
        const lightweightMedia = hcaptchaPending[taskId].media.map(m => ({
            type: m.type,
            stableHash: m.stableHash,
            index: m.index
        }));

        hcaptchaTrained[taskId] = {
            id: taskId,
            prompt: hcaptchaPending[taskId].prompt, 
            media: lightweightMedia, // Sirf Hashes! No heavy images.
            clicks: clicks,
            trainedAt: new Date().toISOString()
        };
        
        delete hcaptchaPending[taskId];
        console.log(`[Trained] hCaptcha ID: #${taskId} saved efficiently.`);
        saveDatabase(); 
    }
    res.json({ success: true });
});

// 5. Dashboard se Task Delete Karna
app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    delete hcaptchaPending[taskId];
    delete hcaptchaTrained[taskId];
    console.log(`[Deleted] hCaptcha ID: #${taskId}`);
    saveDatabase();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`hCaptcha AI Master Server is running FAST on port ${PORT} 🚀`);
});
