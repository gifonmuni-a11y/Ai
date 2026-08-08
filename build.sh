#!/bin/bash

echo "========================================"
echo "🚀 AUTO-BUILD WEB AI BY HW 🚀"
echo "========================================"
echo ""

# Minta API Key langsung di awal biar 1x jalan
read -p "Masukkan API Key OpenRouter lo (sk-or-v1-...): " API_KEY

# Validasi: pastikan API key tidak kosong
if [[ -z "$API_KEY" ]]; then
    echo "[!] API Key kosong. Jalankan lagi dan masukkan key lo."
    exit 1
fi

echo "[+] Bikin struktur folder..."
mkdir -p public/assets

echo "[+] Generate package.json..."
cat << 'EOF' > package.json
{
  "name": "ai-by-hw",
  "version": "1.0.0",
  "description": "Senka 2D AI Chatbot",
  "main": "server.js",
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  }
}
EOF

echo "[+] Generate .env..."
cat << EOF > .env
OPENROUTER_API_KEY=$API_KEY
EOF

echo "[+] Generate server.js..."
cat << 'EOF' > server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages harus diisi dulu, Sensei." });
        }

        const systemPrompt = {
            role: "system",
            content: "Kamu adalah Senka, asisten virtual 2D yang ramah, santai, dan blak-blakan khas anak zaman sekarang. Panggil pengguna dengan sebutan 'Sensei'. Gunakan bahasa gaul Indonesia yang asik. Boleh bercanda dan santai, tapi tetap jujur, tidak mengarang, dan tidak memberikan saran yang membahayakan pengguna atau orang lain. Kalau Sensei mengirim gambar, berikan analisis yang jelas."
        };

        const apiPayload = {
            model: "meta-llama/llama-3.1-8b-instruct:free",
            messages: [systemPrompt, ...messages],
            temperature: 0.85
        };

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(apiPayload)
        });

        const data = await response.json();

        // OpenRouter kadang balas HTTP error (401, 402, 429, dll)
        if (!response.ok) {
            console.error("OpenRouter error:", data.error?.message || response.status);
            return res.status(response.status).json({
                error: data.error?.message || `API error (${response.status})`
            });
        }

        res.json(data);
    } catch (error) {
        console.error("Error API:", error);
        res.status(500).json({ error: "Waduh koneksi putus nih Sensei..." });
    }
});

app.listen(port, () => {
    console.log(`[🚀] Server 'ai by hw' jalan di http://localhost:${port}`);
});
EOF

echo "[+] Generate public/index.html..."
cat << 'EOF' > public/index.html
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ai by hw | Senka</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="main-wrapper">
        <div class="senka-section">
            <img id="senka-model" src="assets/senka_idle.png" alt="Senka">
        </div>
        <div class="chat-section">
            <div class="glass-panel">
                <div class="chat-header">
                    <h2><i class="fa-solid fa-microchip"></i> ai by hw</h2>
                    <span class="status">Senka Online</span>
                </div>
                <div id="chat-history" class="chat-history"></div>

                <div id="preview-container" class="preview-container">
                    <span><i class="fa-solid fa-image"></i> <span id="file-name-preview">Gambar</span></span>
                    <i class="fa-solid fa-xmark remove-btn" onclick="removeImage()"></i>
                </div>

                <div class="input-area">
                    <label for="image-upload" class="upload-btn"><i class="fa-solid fa-paperclip"></i></label>
                    <input type="file" id="image-upload" accept="image/*" hidden>
                    <input type="text" id="message-input" placeholder="Ketik ke Senka..." autocomplete="off">
                    <button id="send-btn" onclick="sendToSenka()"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>
EOF

echo "[+] Generate public/style.css (Teal & Sky Blue Glassmorphism)..."
cat << 'EOF' > public/style.css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
body { background-color: #0f172a; background-image: radial-gradient(circle at top right, #0f2b38, #0f172a); height: 100vh; overflow: hidden; color: #f8fafc; }
.main-wrapper { display: flex; height: 100vh; width: 100vw; }
.senka-section { width: 40%; position: relative; display: flex; justify-content: center; align-items: flex-end; }
#senka-model { height: 90vh; object-fit: contain; filter: drop-shadow(0 0 15px rgba(20, 184, 166, 0.3)); transition: 0.3s; }
.chat-section { width: 60%; padding: 30px; display: flex; flex-direction: column; justify-content: center; }
.glass-panel { background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 20px; height: 100%; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.chat-header { padding: 20px; border-bottom: 1px solid rgba(56, 189, 248, 0.2); display: flex; justify-content: space-between; align-items: center; }
.chat-header h2 { font-size: 1.2rem; color: #38bdf8; }
.status { font-size: 0.8rem; color: #14b8a6; background: rgba(20, 184, 166, 0.1); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(20, 184, 166, 0.3); }
.chat-history { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth; }
.chat-history::-webkit-scrollbar { width: 5px; }
.chat-history::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.3); border-radius: 10px; }
.message { max-width: 85%; padding: 12px 16px; border-radius: 16px; font-size: 0.9rem; line-height: 1.5; }
.msg-user { align-self: flex-end; background: linear-gradient(135deg, #14b8a6, #0ea5e9); border-bottom-right-radius: 4px; box-shadow: 0 4px 15px rgba(14, 165, 233, 0.3); }
.msg-senka { align-self: flex-start; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-bottom-left-radius: 4px; }
.preview-container { display: none; padding: 10px 20px; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(56, 189, 248, 0.1); justify-content: space-between; align-items: center; font-size: 0.85rem; color: #38bdf8; }
.remove-btn { cursor: pointer; color: #ef4444; }
.input-area { padding: 15px 20px; display: flex; gap: 10px; align-items: center; border-top: 1px solid rgba(56, 189, 248, 0.2); }
.upload-btn { cursor: pointer; color: #38bdf8; font-size: 1.2rem; padding: 10px; transition: 0.3s; }
.upload-btn:hover { color: #14b8a6; }
#message-input { flex: 1; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(56, 189, 248, 0.3); color: #fff; padding: 12px 18px; border-radius: 25px; outline: none; transition: 0.3s; }
#message-input:focus { border-color: #14b8a6; box-shadow: 0 0 10px rgba(20, 184, 166, 0.2); }
#send-btn { background: linear-gradient(135deg, #14b8a6, #0ea5e9); border: none; color: #fff; width: 45px; height: 45px; border-radius: 50%; cursor: pointer; transition: 0.3s; }
#send-btn:hover { transform: scale(1.05); box-shadow: 0 0 15px rgba(20, 184, 166, 0.5); }
@media (max-width: 768px) {
    .main-wrapper { flex-direction: column; }
    .senka-section { width: 100%; height: 35vh; align-items: flex-start; overflow: hidden; }
    #senka-model { height: 120%; margin-top: 20px; }
    .chat-section { width: 100%; height: 65vh; padding: 10px; }
}
EOF

echo "[+] Generate public/script.js..."
cat << 'EOF' > public/script.js
const chatHistoryDOM = document.getElementById('chat-history');
const messageInput = document.getElementById('message-input');
const imageUpload = document.getElementById('image-upload');
const previewContainer = document.getElementById('preview-container');
const senkaModel = document.getElementById('senka-model');

let memoryList = JSON.parse(localStorage.getItem('senka_memory')) || [];

window.onload = () => {
    if (memoryList.length === 0) {
        const initialGreeting = "Halo Sensei sayang! Senka udah online nih. Mau ngobrolin apa hari ini?";
        appendMessage('senka', initialGreeting, false);
        memoryList.push({ role: 'assistant', content: [{ type: "text", text: initialGreeting }] });
        localStorage.setItem('senka_memory', JSON.stringify(memoryList));
    } else {
        memoryList.forEach(msg => {
            if(msg.content && msg.content[0]) appendMessage(msg.role, msg.content[0].text, false);
        });
    }
    scrollToBottom();
};

let base64Image = null;
imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('file-name-preview').innerText = " " + file.name;
        previewContainer.style.display = 'flex';
        base64Image = await toBase64(file);
    }
});

function removeImage() {
    base64Image = null;
    imageUpload.value = '';
    previewContainer.style.display = 'none';
}

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

async function sendToSenka() {
    const text = messageInput.value.trim();
    if (!text && !base64Image) return;

    const userMessageContent = [];
    if (text) userMessageContent.push({ type: "text", text: text });
    if (base64Image) userMessageContent.push({ type: "image_url", image_url: { url: base64Image } });

    appendMessage('user', text || "[Sensei mengirimkan gambar]", false);
    memoryList.push({ role: 'user', content: userMessageContent });
    localStorage.setItem('senka_memory', JSON.stringify(memoryList));

    messageInput.value = '';
    removeImage();
    scrollToBottom();

    senkaModel.src = "assets/senka_talk.gif";

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: memoryList })
        });

        const data = await response.json();

        // Jangan crash kalau API balas error
        if (!response.ok) {
            throw new Error(data.error || `API error (${response.status})`);
        }
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error("Respons API tidak sesuai format.");
        }

        const senkaReply = data.choices[0].message.content;

        await typeWriterEffect('senka', senkaReply);

        memoryList.push({ role: 'assistant', content: [{ type: "text", text: senkaReply }] });
        localStorage.setItem('senka_memory', JSON.stringify(memoryList));
    } catch (error) {
        appendMessage('senka', "Waduh koneksi putus, Sensei. Coba lagi ya.", false);
    }

    senkaModel.src = "assets/senka_idle.png";
}

function appendMessage(role, text, isTypewriter = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', role === 'user' ? 'msg-user' : 'msg-senka');

    if(!isTypewriter) {
        msgDiv.innerText = text;
        chatHistoryDOM.appendChild(msgDiv);
        scrollToBottom();
    }
    return msgDiv;
}

function typeWriterEffect(role, text) {
    return new Promise(resolve => {
        const msgDiv = appendMessage(role, "", true);
        chatHistoryDOM.appendChild(msgDiv);

        let i = 0;
        const interval = setInterval(() => {
            msgDiv.innerText += text.charAt(i);
            i++;
            scrollToBottom();
            if (i >= text.length) {
                clearInterval(interval);
                resolve();
            }
        }, 20);
    });
}

function scrollToBottom() { chatHistoryDOM.scrollTop = chatHistoryDOM.scrollHeight; }
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendToSenka(); });
EOF

echo "[+] Install dependencies Node.js..."
npm install

echo ""
echo "🎉 PROJECT SELESAI DIBANGUN!"
echo "Tinggal upload gambar Senka, lalu ketik 'npm start' buat ngejalanin."
echo "========================================"
