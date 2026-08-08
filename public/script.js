const chatHistoryDOM = document.getElementById('chat-history');
const messageInput = document.getElementById('message-input');
const imageUpload = document.getElementById('image-upload');
const previewContainer = document.getElementById('preview-container');
const senkaModel = document.getElementById('senka-model');

const MODELS = {
    hermes:    { label: "Hermes 3 405B (free)" },
    plutonium: { label: "Plutonium Uncensored 8B (free)" },
    euryale:   { label: "Euryale 70B (berbayar)" },
    miqu:      { label: "Midnight Miqu 70B (berbayar)" }
};

let memoryList = JSON.parse(localStorage.getItem('senka_memory')) || [];
let panggilan = localStorage.getItem('senka_panggilan') || 'pengguna';
let modelKey = localStorage.getItem('senka_model') || 'hermes';

window.onload = () => {
    const modelSelect = document.getElementById('model-select');
    Object.keys(MODELS).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = MODELS[key].label;
        modelSelect.appendChild(opt);
    });
    modelSelect.value = modelKey;
    document.getElementById('panggilan-input').value = panggilan;

    if (memoryList.length === 0) {
        const initialGreeting = `Halo ${panggilan}! Senka udah online nih. Mau ngobrolin apa hari ini?`;
        appendMessage('senka', initialGreeting, false);
        memoryList.push({ role: 'assistant', content: [{ type: "text", text: initialGreeting }] });
        localStorage.setItem('senka_memory', JSON.stringify(memoryList));
    } else {
        memoryList.forEach(msg => {
            if (msg.content && msg.content[0]) appendMessage(msg.role, msg.content[0].text, false);
        });
    }
    scrollToBottom();
};

function openSettings() {
    document.getElementById('panggilan-input').value = panggilan;
    document.getElementById('model-select').value = modelKey;
    document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function saveSettings() {
    const newPanggilan = document.getElementById('panggilan-input').value.trim();
    if (newPanggilan) {
        panggilan = newPanggilan;
        localStorage.setItem('senka_panggilan', panggilan);
    }
    modelKey = document.getElementById('model-select').value;
    localStorage.setItem('senka_model', modelKey);
    closeSettings();
    appendMessage('senka', `Oke ${panggilan}, mulai sekarang Senka manggil kamu gitu ya.`, false);
    scrollToBottom();
}

document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettings();
});

let base64Image = null;
imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('file-name-preview').innerText = " " + file.name;
        previewContainer.style.display = 'flex';
        base64Image = await compressImage(file);
    }
});

function compressImage(file, maxSize = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            const scale = Math.min(maxSize / width, maxSize / height, 1);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            let dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (dataUrl.length > 4 * 1024 * 1024) dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

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

    appendMessage('user', text || "[kirim gambar]", false);
    memoryList.push({ role: 'user', content: userMessageContent });
    localStorage.setItem('senka_memory', JSON.stringify(memoryList));

    messageInput.value = '';
    removeImage();
    scrollToBottom();

    if (senkaModel.src && senkaModel.style.display !== 'none') senkaModel.src = "assets/senka_talk.gif";

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: memoryList, modelKey, panggilan })
        });

        const data = await response.json();

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
        appendMessage('senka', "Waduh, lagi error nih. Coba lagi ya.", false);
    }

    if (senkaModel.src && senkaModel.style.display !== 'none') senkaModel.src = "assets/senka_idle.png";
}

function appendMessage(role, text, isTypewriter = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', role === 'user' ? 'msg-user' : 'msg-senka');

    if (!isTypewriter) {
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
        }, 15);
    });
}

function scrollToBottom() { chatHistoryDOM.scrollTop = chatHistoryDOM.scrollHeight; }
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendToSenka(); });
