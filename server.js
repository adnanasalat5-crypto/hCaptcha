const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// 🚀 Database File Setup (Volume ke liye ab 100% kam kare ga)
const DB_FILE = path.join(__dirname, 'database.json');

let hcaptchaPending = {};
let hcaptchaTrained = {};

// Load data from file on startup
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

// Function to save data securely
function saveDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ pending: hcaptchaPending, trained: hcaptchaTrained }), 'utf8');
}

// 🧠 AI ENGINE: Compare two Canvas hashes for percentage similarity
function getSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    let matches = 0;
    const len = Math.min(str1.length, str2.length);
    for (let i = 0; i < len; i++) {
        if (str1[i] === str2[i]) matches++;
    }
    return (matches / Math.max(str1.length, str2.length)) * 100;
}

// 1. Naya hCaptcha Task Receive Karna (WITH AI FUZZY & SHUFFLE LOGIC)
app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;
    
    // Agar exact match mil jaye (Jo ab mushkil hai hCaptcha ki chalaki ki waja se)
    if (hcaptchaTrained[task.taskId]) {
        return res.json({ success: true });
    }

    let isAutoSolved = false;

    // 🧠 AI ENGINE: Search in all previously trained tasks
    for (const trainedId in hcaptchaTrained) {
        const trainedTask = hcaptchaTrained[trainedId];
        
        // Agar prompt match nahi karta (ya pehle media save nahi tha), toh skip karo
        if (!trainedTask.media || trainedTask.prompt !== task.prompt) continue;

        const isGrid = task.media.length > 1 && task.media.every(m => m.type === 'image' || m.type === 'single_image');
        
        // 💡 GRID SHUFFLE LOGIC (Rabbits / Concepts)
        if (isGrid && trainedTask.media.length === task.media.length) {
            
            // Pata lagao ke purane task mein user ne kin tasveeron (hashes) par click kiya tha
            let clickedHashes = trainedTask.clicks.map(index => trainedTask.media[index]?.stableHash).filter(Boolean);
            
            let newClicks = [];
            let matchCount = 0;
            
            // Ab check karo ke naye task mein wo tasveerain kis number par hain
            for (let i = 0; i < task.media.length; i++) {
                if (clickedHashes.includes(task.media[i].stableHash)) {
                    newClicks.push(i);
                    matchCount++;
                }
            }

            // Agar saari click ki hui tasveerain naye grid mein mil gayin (Chahe jagah badal gayi ho)
            if (matchCount > 0 && matchCount === clickedHashes.length) {
                console.log(`[AI SOLVED] Grid Shuffled Match found! Mapping old clicks to new layout for #${task.taskId}`);
                hcaptchaTrained[task.taskId] = { ...task, clicks: newClicks, trainedAt: new Date().toISOString(), aiMatched: true };
                isAutoSolved = true;
                break;
            }
        } 
        // 💡 CANVAS FUZZY LOGIC (Tiger / Arrows)
        else if (!isGrid && task.media.length > 0 && trainedTask.media.length > 0) {
            
            let newHash = task.media[task.media.length - 1].stableHash; 
            let oldHash = trainedTask.media[trainedTask.media.length - 1].stableHash;
            
            let similarity = getSimilarity(newHash, oldHash);
            
            // Agar canvas 94% se zyada match kar jaye (Pixels thore se hile hon)
            if (similarity >= 94) { 
                console.log(`[AI SOLVED] Canvas Fuzzy Match (${similarity.toFixed(1)}%) for #${task.taskId}`);
                hcaptchaTrained[task.taskId] = { ...task, clicks: trainedTask.clicks, trainedAt: new Date().toISOString(), aiMatched: true };
                isAutoSolved = true;
                break;
            }
        }
    }

    if (!isAutoSolved) {
        hcaptchaPending[task.taskId] = {
            id: task.taskId,
            prompt: task.prompt,
            media: task.media, // 🚀 Ye bhejna zaroori tha
            timestamp: task.timestamp
        };
        console.log(`[New hCaptcha] ID: #${task.taskId} sent to Dashboard!`);
    }

    saveDatabase(); 
    res.json({ success: true });
});

// 2. Dashboard ke liye Tasks Bhejna
app.get('/api/get-hcaptcha', (req, res) => {
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

// 4. Dashboard se Training Data Save Karna (FIXED)
app.post('/api/submit-hcaptcha', (req, res) => {
    const { taskId, clicks } = req.body;
    
    if (hcaptchaPending[taskId]) {
        // 🚀 THE FIX: Ab Prompt aur Media dono database mein save honge AI ke liye!
        hcaptchaTrained[taskId] = {
            id: taskId,
            prompt: hcaptchaPending[taskId].prompt, 
            media: hcaptchaPending[taskId].media,   
            clicks: clicks,
            trainedAt: new Date().toISOString()
        };
        
        delete hcaptchaPending[taskId];
        console.log(`[Trained] hCaptcha ID: #${taskId} saved. Prepared for AI Matching.`);
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
    console.log(`hCaptcha AI Master Server is running on port ${PORT} 🚀`);
});
