const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); 

let hcaptchaPending = {};
let hcaptchaTrained = {};

// 1. Naya hCaptcha Task Receive Karna
app.post('/api/new-hcaptcha', (req, res) => {
    const task = req.body;
    
    // 🔥 JADU: Agar task pehle se trained list mein mojood hai, toh dobara pending mein mat dalo!
    if (hcaptchaTrained[task.taskId]) {
        return res.json({ success: true, status: 'already_trained' });
    }
    
    if (!hcaptchaPending[task.taskId]) {
        hcaptchaPending[task.taskId] = {
            id: task.taskId,
            prompt: task.prompt,
            media: task.media,
            timestamp: task.timestamp
        };
        console.log(`[New hCaptcha] ID: #${task.taskId} received!`);
    }
    res.json({ success: true });
});

// 2. Dashboard ke liye Tasks Bhejna
app.get('/api/get-hcaptcha', (req, res) => {
    res.json({
        pending: hcaptchaPending,
        trained: hcaptchaTrained
    });
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

// 4. Dashboard se Training Data Save Karna (Permanent Lock)
app.post('/api/submit-hcaptcha', (req, res) => {
    const { taskId, clicks } = req.body;
    
    hcaptchaTrained[taskId] = {
        id: taskId,
        clicks: clicks,
        trainedAt: new Date().toISOString()
    };
    
    // Pending se foran nikal do taake wapis na aaye
    delete hcaptchaPending[taskId];
    console.log(`[Permanently Trained] hCaptcha ID: #${taskId} saved safely.`);
    
    res.json({ success: true });
});

// 5. Dashboard se Task Delete Karna
app.delete('/api/delete-hcaptcha/:id', (req, res) => {
    const taskId = req.params.id;
    delete hcaptchaPending[taskId];
    delete hcaptchaTrained[taskId];
    console.log(`[Deleted] hCaptcha ID: #${taskId}`);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`hCaptcha Master Server is running on port ${PORT} 🚀`);
});
