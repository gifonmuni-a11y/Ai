const chatHistoryDOM = document.getElementById('chat-history');
const messageInput = document.getElementById('message-input');
const imageUpload = document.getElementById('image-upload');
const previewContainer = document.getElementById('preview-container');
const senkaModel = document.getElementById('senka-model');

let sessions = [];
let activeId = null;
let memoryList = [];
let availableModels = [];
let modelKey = localStorage.getItem('senka_model') || '';
let panggilan = localStorage.getItem('senka_panggilan') || 'pengguna';
let base64Image = null;
let lastUserText = '';
let lastUserImage = null;

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchstart', e => {
    if (e.target.closest('input, textarea')) return;
    if (e.target.closest('img') && !e.target.classList.contains('chat-img')) e.preventDefault();
}, { passive: false });

window.onload = async () => {
    initSakura();
    loadSessions();
    renderSessionName();
    document.getElementById('panggilan-input').value = panggilan;

    try {
        const resp = await fetch('/api/config');
        const cfg = await resp.json();
        availableModels = cfg.models || [];
    } catch (e) {
        availableModels = [];
    }
    renderModelPicker();

    renderChat();
};

function loadSessions() {
    try { sessions = JSON.parse(localStorage.getItem('senka_sessions')) || []; } catch (e) { sessions = []; }
    if (!sessions.length) sessions = [{ id: 's' + Date.now(), name: 'Sesi 1', messages: [] }];
    activeId = localStorage.getItem('senka_active');
    if (!sessions.find(s => s.id === activeId)) activeId = sessions[0].id;
    const active = sessions.find(s => s.id === activeId);
    memoryList = active ? active.messages : [];
}

function saveSessions() {
    const active = sessions.find(s => s.id === activeId);
    if (active) active.messages = memoryList;
    localStorage.setItem('senka_sessions', JSON.stringify(sessions));
    localStorage.setItem('senka_active', activeId);
    renderSessionName();
}

function renderSessionName() {
    const active = sessions.find(s => s.id === activeId);
    document.getElementById('session-name').innerText = active ? active.name : 'Sesi';
}

function newSession() {
    const n = sessions.length + 1;
    const id = 's' + Date.now();
    sessions.push({ id, name: 'Sesi ' + n, messages: [] });
    activeId = id;
    memoryList = [];
    saveSessions();
    closeAllModals();
    renderChat();
}

function deleteSession(id) {
    if (!confirm('Hapus sesi ini? Chat di dalamnya akan hilang.')) return;
    sessions = sessions.filter(s => s.id !== id);
    if (!sessions.length) sessions = [{ id: 's' + Date.now(), name: 'Sesi 1', messages: [] }];
    if (activeId === id) {
        activeId = sessions[0].id;
        const active = sessions.find(s => s.id === activeId);
        memoryList = active ? active.messages : [];
    }
    saveSessions();
    renderSessionList();
    renderChat();
}

function switchSession(id) {
    const active = sessions.find(s => s.id === activeId);
    if (active) active.messages = memoryList;
    activeId = id;
    const target = sessions.find(s => s.id === id);
    memoryList = target ? target.messages : [];
    saveSessions();
    closeSessions();
    renderChat();
}

function openSessions() { renderSessionList(); document.getElementById('sessions-modal').style.display = 'flex'; }
function closeSessions() { document.getElementById('sessions-modal').style.display = 'none'; }

function renderSessionList() {
    const list = document.getElementById('session-list');
    list.innerHTML = '';
    sessions.forEach(s => {
        const item = document.createElement('div');
        item.className = 'session-item' + (s.id === activeId ? ' active' : '');
        const count = (s.messages || []).length;
        item.innerHTML = `<div style="min-width:0"><div class="si-name">${s.name}</div><div class="si-meta">${count} pesan</div></div>
                          <i class="fa-solid fa-trash si-del" title="Hapus"></i>`;
        item.onclick = () => switchSession(s.id);
        item.querySelector('.si-del').onclick = (e) => { e.stopPropagation(); deleteSession(s.id); };
        list.appendChild(item);
    });
}

function openSettings() {
    document.getElementById('panggilan-input').value = panggilan;
    renderModelPicker();
    document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function openImageModal() { document.getElementById('image-modal').style.display = 'flex'; setTimeout(() => document.getElementById('image-prompt').focus(), 100); }
function closeImageModal() { document.getElementById('image-modal').style.display = 'none'; }
function openExport() { document.getElementById('export-modal').style.display = 'flex'; }
function closeExport() { document.getElementById('export-modal').style.display = 'none'; }
function closeAllModals() {
    ['settings-modal', 'image-modal', 'sessions-modal', 'export-modal'].forEach(id => document.getElementById(id).style.display = 'none');
}
document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; }));

function renderModelPicker() {
    const picker = document.getElementById('model-picker');
    picker.innerHTML = '';
    if (!availableModels.length) {
        picker.innerHTML = '<p class="modal-hint">Model belum dimuat. Cek koneksi.</p>';
        return;
    }
    availableModels.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'model-opt' + (m.key === modelKey ? ' selected' : '');
        const prov = m.provider === 'groq' ? '⚡ Groq' : '🌐 OpenRouter';
        btn.innerHTML = `<span class="mo-label">${m.label}${m.vision ? ' 👁️' : ''}</span>
                         <span class="mo-prov">${prov}${m.vision ? ' · bisa baca gambar' : ''}</span>
                         <i class="fa-solid fa-check mo-check"></i>`;
        btn.onclick = () => { modelKey = m.key; renderModelPicker(); };
        picker.appendChild(btn);
    });
}

function saveSettings() {
    const newPanggilan = document.getElementById('panggilan-input').value.trim();
    if (newPanggilan) {
        panggilan = newPanggilan;
        localStorage.setItem('senka_panggilan', panggilan);
    }
    if (modelKey) {
        localStorage.setItem('senka_model', modelKey);
    }
    closeSettings();
    if (modelKey) {
        const label = (availableModels.find(m => m.key === modelKey) || {}).label || modelKey;
        appendMessage('senka', `Oke ${panggilan}, model ${label} siap dipakai.`);
    }
    scrollToBottom();
}

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

function shrinkMemoryImages() {
    memoryList.forEach(m => {
        (m.content || []).forEach(c => {
            if (c && c.type === 'image_url' && c.image_url && typeof c.image_url.url === 'string' && c.image_url.url.startsWith('data:') && c.image_url.url.length > 40000) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 384;
                    canvas.height = Math.round(384 * img.height / img.width);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    c.image_url.url = canvas.toDataURL('image/jpeg', 0.6);
                    saveSessions();
                };
                img.src = c.image_url.url;
            }
        });
    });
}

function renderChat() {
    chatHistoryDOM.innerHTML = '';
    if (!memoryList.length) {
        const greeting = `Halo ${panggilan}! Senka online 🌸`;
        memoryList.push({ role: 'assistant', content: [{ type: 'text', text: greeting }] });
        saveSessions();
        appendMessage('senka', greeting);
        if (!modelKey) {
            appendMessage('senka', 'Sebelum ngobrol, pilih dulu model AI-nya lewat tombol ⚙️ di atas ya.');
        }
    } else {
        memoryList.forEach(m => {
            const bubble = document.createElement('div');
            bubble.classList.add('message', m.role === 'user' ? 'msg-user' : 'msg-senka');
            (m.content || []).forEach(c => {
                if (!c) return;
                if (c.type === 'text') {
                    const p = document.createElement('div');
                    p.innerText = c.text;
                    bubble.appendChild(p);
                } else if (c.type === 'image_url') {
                    const img = document.createElement('img');
                    img.src = c.image_url.url;
                    img.classList.add('chat-img');
                    bubble.appendChild(img);
                }
            });
            if (m.role === 'senka' || m.role === 'assistant') addMsgActions(bubble);
            chatHistoryDOM.appendChild(bubble);
        });
    }
    scrollToBottom();
}

function addMsgActions(bubble) {
    const text = bubble.innerText || '';
    if (!text.trim()) return;
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const speakBtn = document.createElement('button');
    speakBtn.className = 'msg-action';
    speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Putar';
    speakBtn.onclick = () => speak(text);
    actions.appendChild(speakBtn);
    bubble.appendChild(actions);
}

function speak(text) {
    if (!('speechSynthesis' in window)) { alert('Browser tidak mendukung suara.'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
    u.lang = 'id-ID';
    const voices = speechSynthesis.getVoices();
    const idv = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('id'));
    if (idv) u.voice = idv;
    u.rate = 1.05;
    speechSynthesis.speak(u);
}

async function sendToSenka() {
    const text = messageInput.value.trim();
    if (!text && !base64Image) return;

    if (!modelKey) {
        openSettings();
        appendMessage('senka', `Pilih dulu model AI-nya ya ${panggilan}, terus kirim lagi.`);
        scrollToBottom();
        return;
    }

    if (text.toLowerCase().startsWith('/gambar') && !base64Image) {
        const prompt = text.slice(7).trim();
        if (!prompt) { appendMessage('senka', 'Contoh: /gambar gadis anime rambut merah di taman.'); scrollToBottom(); return; }
        generateImageWithPrompt(prompt);
        messageInput.value = '';
        return;
    }

    lastUserText = text;
    lastUserImage = base64Image;

    const userMessageContent = [];
    if (text) userMessageContent.push({ type: "text", text: text });
    if (base64Image) userMessageContent.push({ type: "image_url", image_url: { url: base64Image } });

    const bubble = appendMessage('user', text || '');
    if (base64Image) {
        const img = document.createElement('img');
        img.src = base64Image;
        img.classList.add('chat-img');
        bubble.appendChild(img);
    }
    memoryList.push({ role: 'user', content: userMessageContent });
    saveSessions();

    messageInput.value = '';
    removeImage();
    scrollToBottom();

    if (senkaModel.src && senkaModel.style.display !== 'none') senkaModel.src = "assets/avatar.webp";

    const msgDiv = appendMessage('senka', 'Senka ngetik…', true);
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
                    if (j.error) { streamError = j.error.message || 'upstream error'; continue; }
                    if (!j.choices) continue;
                    const delta = j.choices[0]?.delta?.content;
                    if (delta) {
                        if (!started) { msgDiv.innerHTML = ''; started = true; }
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
        addMsgActions(msgDiv);
        saveSessions();
        shrinkMemoryImages();
    } catch (error) {
        if (error.message === 'empty') {
            memoryList.pop();
            saveSessions();
            return;
        }
        const errBubble = document.createElement('div');
        errBubble.classList.add('message', 'msg-senka');
        errBubble.innerHTML = `Waduh error: ${error.message.replace(/</g, '&lt;')} — <span class="retry-btn" onclick="retryLast()">coba lagi</span>`;
        msgDiv.replaceWith(errBubble);
        scrollToBottom();
    }
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

function generateImage() {
    const prompt = document.getElementById('image-prompt').value.trim();
    if (!prompt) { document.getElementById('image-prompt').focus(); return; }
    closeImageModal();
    document.getElementById('image-prompt').value = '';
    generateImageWithPrompt(prompt);
}

function generateImageWithPrompt(prompt) {
    appendMessage('user', '🎨 ' + prompt);
    const loading = appendMessage('senka', '🎨 lagi bikin gambar...');
    scrollToBottom();
    fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    })
        .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `API error (${response.status})`);
            const tag = document.createElement('div');
            tag.className = 'msg-tag';
            tag.innerText = '✨ ' + (data.model || 'Gambar AI') + ' · tap ⬇ buat simpan';
            loading.innerHTML = '';
            loading.appendChild(tag);
            const img = document.createElement('img');
            img.src = data.url;
            img.classList.add('chat-img');
            img.alt = prompt;
            img.onerror = () => { loading.innerText = 'Gagal memuat gambar. Coba lagi.'; };
            loading.appendChild(img);
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            const dl = document.createElement('button');
            dl.className = 'msg-action';
            dl.innerHTML = '<i class="fa-solid fa-download"></i> Download';
            dl.onclick = () => downloadImage(data.url, 'senka-' + prompt.slice(0, 25).replace(/[^a-zA-Z0-9]+/g, '_') + '.jpg');
            actions.appendChild(dl);
            loading.appendChild(actions);
            scrollToBottom();
        })
        .catch((e) => {
            loading.innerText = 'Gagal: ' + e.message;
            scrollToBottom();
        });
}

function downloadImage(url, filename) {
    if (url.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } else {
        fetch(url)
            .then(r => r.blob())
            .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 3000);
                a.remove();
            })
            .catch(() => window.open(url, '_blank'));
    }
}

function exportPDF() {
    if (!window.jspdf) {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = () => setTimeout(() => exportPDF(), 200);
        document.body.appendChild(s);
        return;
    }
    const doc = new window.jspdf.jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Chat dengan Senka', 10, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text('Ekspor ' + new Date().toLocaleString('id-ID'), 10, 18);
    let y = 26;
    memoryList.forEach(m => {
        const text = (m.content || []).find(c => c.type === 'text');
        if (!text || !text.text) return;
        const who = m.role === 'user' ? panggilan : 'Senka';
        const lines = doc.splitTextToSize(who + ': ' + text.text, 185);
        doc.setTextColor(m.role === 'user' ? 120 : 220);
        doc.setFont('helvetica', 'bold');
        lines.forEach(l => {
            if (y > 282) { doc.addPage(); y = 14; }
            doc.text(l, 10, y);
            y += 6;
        });
        y += 3;
        doc.setFont('helvetica', 'normal');
    });
    doc.save('chat-senka.pdf');
}

function exportDOC() {
    let html = '<html><head><meta charset="utf-8"><title>Chat dengan Senka</title></head><body>';
    html += '<h2>Chat dengan Senka</h2><p><i>Dibuat: ' + new Date().toLocaleString('id-ID') + '</i></p><hr>';
    memoryList.forEach(m => {
        const text = (m.content || []).find(c => c.type === 'text');
        if (!text || !text.text) return;
        const who = m.role === 'user' ? panggilan : 'Senka';
        html += '<p><b>' + who + ':</b><br>' + text.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p><hr>';
    });
    html += '</body></html>';
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chat-senka.doc';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
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
document.getElementById('image-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generateImage();
});

function initSakura() {
    const canvas = document.getElementById('sakura-canvas');
    const ctx = canvas.getContext('2d');
    let petals = [];
    const COLORS = ['rgba(255,182,193,', 'rgba(255,192,203,', 'rgba(255,209,220,', 'rgba(252,182,216,'];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const target = Math.min(26, Math.max(10, Math.round(window.innerWidth / 45)));
        if (petals.length < target) {
            for (let i = petals.length; i < target; i++) petals.push(makePetal());
        } else {
            petals.length = target;
        }
    }

    function makePetal() {
        return {
            x: Math.random() * canvas.width,
            y: -30 - Math.random() * canvas.height * 0.7,
            size: 7 + Math.random() * 9,
            speed: 0.7 + Math.random() * 1.4,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.008 + Math.random() * 0.02,
            swayAmp: 20 + Math.random() * 30,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: 0.004 + Math.random() * 0.015,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            alpha: 0.45 + Math.random() * 0.35
        };
    }

    function drawPetal(p) {
        ctx.save();
        ctx.translate(p.x + Math.sin(p.sway) * p.swayAmp, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.55, -p.size * 0.9, -p.size * 0.55, 0, 0);
        ctx.quadraticCurveTo(-p.size * 0.5, p.size * 0.5, 0, p.size * 0.2);
        ctx.quadraticCurveTo(p.size * 0.5, p.size * 0.5, 0, 0);
        ctx.fillStyle = p.color + p.alpha + ')';
        ctx.fill();
        ctx.restore();
    }

    function tick() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of petals) {
            p.y += p.speed;
            p.sway += p.swaySpeed;
            p.rot += p.rotSpeed;
            if (p.y > canvas.height + 40) {
                Object.assign(p, makePetal(), { y: -30 });
            }
            drawPetal(p);
        }
        requestAnimationFrame(tick);
    }

    window.addEventListener('resize', resize);
    resize();
    tick();
}
