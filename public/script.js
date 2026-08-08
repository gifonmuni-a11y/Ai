const chatHistoryDOM = document.getElementById('chat-history');
const messageInput = document.getElementById('message-input');
const imageUpload = document.getElementById('image-upload');
const previewContainer = document.getElementById('preview-container');
const senkaModel = document.getElementById('senka-model');

let memoryList = JSON.parse(localStorage.getItem('senka_memory')) || [];
let panggilan = localStorage.getItem('senka_panggilan') || 'pengguna';
let modelKey = localStorage.getItem('senka_model') || '';
let availableModels = [];

let lastUserText = '';
let lastUserImage = null;

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchstart', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.target.closest('img')) e.preventDefault();
}, { passive: false });

window.onload = async () => {
    document.getElementById('panggilan-input').value = panggilan;
    const modelSelect = document.getElementById('model-select');

    try {
        const resp = await fetch('/api/config');
        const cfg = await resp.json();
        availableModels = cfg.models || [];
    } catch (e) {
        availableModels = [];
    }

    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = '— pilih model —';
    placeholderOpt.disabled = true;
    placeholderOpt.hidden = true;
    modelSelect.appendChild(placeholderOpt);

    availableModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.key;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
    });

    if (modelKey && !availableModels.some(m => m.key === modelKey)) modelKey = '';
    modelSelect.value = modelKey;

    if (memoryList.length === 0) {
        appendMessage('senka', `Halo ${panggilan}! Senka online. Sebelum ngobrol, pilih dulu model AI-nya lewat tombol gear ⚙️ di kanan atas ya.`, false);
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
    const chosen = document.getElementById('model-select').value;
    if (chosen) {
        modelKey = chosen;
        localStorage.setItem('senka_model', modelKey);
    }
    closeSettings();
    if (modelKey) {
        const label = (availableModels.find(m => m.key === modelKey) || {}).label || modelKey;
        appendMessage('senka', `Oke ${panggilan}, model ${label} siap dipakai.`, false);
    }
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

async function sendToSenka() {
    const text = messageInput.value.trim();
    if (!text && !base64Image) return;

    if (!modelKey) {
        openSettings();
        appendMessage('senka', `Pilih dulu model AI-nya ya ${panggilan}, terus kirim lagi.`, false);
        scrollToBottom();
        return;
    }

    if (text.toLowerCase().startsWith('/gambar')) {
        const prompt = text.slice(7).trim();
        if (!prompt) {
            appendMessage('senka', 'Contoh: /gambar <deskripsi>. Contoh: /gambar gadis anime berambut biru di taman.', false);
            scrollToBottom();
            return;
        }
        handleGambar(prompt);
        messageInput.value = '';
        return;
    }

    lastUserText = text;
    lastUserImage = base64Image;

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

    const msgDiv = appendMessage('senka', '', true);
    msgDiv.innerText = 'Senka ngetik…';
    chatHistoryDOM.appendChild(msgDiv);
    scrollToBottom();

    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: memoryList, modelKey, panggilan })
        });

        if (!response.ok) {
            let msg = `API error (${response.status})`;
            try { msg = (await response.json()).error || msg; } catch (e) { }
            throw new Error(msg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let started = false;
        let streamError = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (payload === '[DONE]') continue;
                try {
                    const j = JSON.parse(payload);
                    if (j.error) {
                        streamError = j.error.message || 'upstream error';
                        continue;
                    }
                    if (!j.choices) continue;
                    const delta = j.choices[0]?.delta?.content;
                    if (delta) {
                        if (!started) { msgDiv.innerText = ''; started = true; }
                        msgDiv.innerText += delta;
                        scrollToBottom();
                    }
                } catch (e) { }
            }
        }

        if (streamError) throw new Error(streamError);
        if (!started) throw new Error('empty');

        const senkaReply = msgDiv.innerText;
        memoryList.push({ role: 'assistant', content: [{ type: "text", text: senkaReply }] });
        localStorage.setItem('senka_memory', JSON.stringify(memoryList));
    } catch (error) {
        if (error.message === 'empty') {
            memoryList.pop();
            localStorage.setItem('senka_memory', JSON.stringify(memoryList));
            return;
        }
        const errBubble = document.createElement('div');
        errBubble.classList.add('message', 'msg-senka');
        errBubble.innerHTML = `Waduh error: ${error.message.replace(/</g, '&lt;')} — <span class="retry-btn" onclick="retryLast()">coba lagi</span>`;
        msgDiv.replaceWith(errBubble);
        scrollToBottom();
    }

    if (senkaModel.src && senkaModel.style.display !== 'none') senkaModel.src = "assets/senka_idle.png";
}

async function retryLast() {
    if (!lastUserText && !lastUserImage) return;
    messageInput.value = lastUserText;
    base64Image = lastUserImage;
    if (lastUserImage) {
        document.getElementById('file-name-preview').innerText = " gambar";
        previewContainer.style.display = 'flex';
    }
    sendToSenka();
}

async function handleGambar(prompt) {
    appendMessage('user', `/gambar ${prompt}`, false);
    const loading = appendMessage('senka', '🎨 bikin gambar...', false);
    scrollToBottom();
    try {
        const response = await fetch('/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            loading.innerText = 'Gagal: ' + (data.error || `API error (${response.status})`);
            scrollToBottom();
            return;
        }
        loading.innerHTML = '';
        const img = document.createElement('img');
        img.src = data.url;
        img.classList.add('chat-img');
        img.alt = prompt;
        img.onerror = () => { loading.innerText = 'Gagal memuat gambar. Coba lagi.'; };
        loading.appendChild(img);
        scrollToBottom();
    } catch (e) {
        loading.innerText = 'Gagal generate gambar. Coba lagi.';
        scrollToBottom();
    }
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

function scrollToBottom() { chatHistoryDOM.scrollTop = chatHistoryDOM.scrollHeight; }
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendToSenka(); });
