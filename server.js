const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // เราจะเอา index.html ไปใส่ในโฟลเดอร์ public หรือวางไว้ root ก็ได้ (ในโค้ดนี้วางไว้ root)

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint สำหรับคุยกับ Gemini (ซ่อน API Key ไว้ที่นี่)
app.post('/api/generate', async (req, res) => {
    const userPrompt = req.body.prompt;
    const apiKey = process.env.GEMINI_API_KEY; // อ่านจาก Render Environment Variable

    if (!apiKey) {
        return res.status(500).json({ error: { message: "API Key not configured on server." } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: userPrompt }] }] })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || 'Gemini API Error');
        }

        res.json(data);
    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: { message: error.message } });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
