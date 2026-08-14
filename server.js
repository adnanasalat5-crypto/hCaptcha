const cors = require('cors');
const app = express();

// Video aur Canvas captchas ka data bara hota hai, is liye limit 50mb rakhi hai
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// Memory Storage (Sirf hCaptcha ke liye)
let hcaptchaPending = {};
let hcaptchaTrained = {};

// 1. Naya hCaptcha Task Receive Karna
app.post('/api/new-hcaptcha', (req, res) => {
const task = req.body;

    // Agar task pehle se trained list mein nahi hai, tabhi pending mein dalo
    if (!hcaptchaTrained[task.taskId]) {
    // 🔥 JADU: Agar task pehle se trained list mein mojood hai, toh dobara pending mein mat dalo!
    if (hcaptchaTrained[task.taskId]) {
        return res.json({ success: true, status: 'already_trained' });
    }
    
    if (!hcaptchaPending[task.taskId]) {
hcaptchaPending[task.taskId] = {
id: task.taskId,
prompt: task.prompt,
            media: task.media, // Is mein image ya video frames honge
            media: task.media,
timestamp: task.timestamp
};
console.log(`[New hCaptcha] ID: #${task.taskId} received!`);
@@ -45,21 +47,20 @@ app.get('/api/check-hcaptcha/:id', (req, res) => {
}
});

// 4. Dashboard se Training Data (Clicks/Coordinates) Save Karna
// 4. Dashboard se Training Data Save Karna (Permanent Lock)
app.post('/api/submit-hcaptcha', (req, res) => {
const { taskId, clicks } = req.body;

    if (hcaptchaPending[taskId] || !hcaptchaTrained[taskId]) {
        hcaptchaTrained[taskId] = {
            id: taskId,
            clicks: clicks,
            trainedAt: new Date().toISOString()
        };
        
        // Pending se nikal do kyunke ab yeh train ho chuka hai
        delete hcaptchaPending[taskId];
        console.log(`[Trained] hCaptcha ID: #${taskId} saved with ${clicks.length} actions.`);
    }
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

@@ -72,8 +73,7 @@ app.delete('/api/delete-hcaptcha/:id', (req, res) => {
res.json({ success: true });
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`hCaptcha Master Server is running on port ${PORT} 🚀`);
});
});
