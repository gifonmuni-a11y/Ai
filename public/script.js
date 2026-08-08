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
let isStreaming = false;

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

    if (modelKey && !availableModels.some(m => m.key === modelKey)) {
        modelKey = '';
        localStorage.removeItem('senka_model');
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
        item.innerHTML = `<div style="min-width:0"><div class="si-name"></div><div class="si-meta">${count} pesan</div></div>
                          <i class="fa-solid fa-trash si-del" title="Hapus"></i>`;
        item.querySelector('.si-name').innerText = s.name;
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
        btn.innerHTML = `<div class="mo-line">
                            <span class="mo-label"></span>
                            <span class="mo-chip"></span>
                            <i class="fa-solid fa-check mo-check"></i>
                         </div>
                         <span class="mo-prov"></span>`;
        btn.querySelector('.mo-label').innerText = m.label;
        btn.querySelector('.mo-prov').innerText = m.vision ? 'Bisa baca gambar — dipakai otomatis saat kamu kirim foto' : 'Cepat dan responsif';
        btn.querySelector('.mo-chip').innerText = m.provider === 'groq' ? 'Groq' : 'OpenRouter';
        btn.querySelector('.mo-chip').classList.add(m.provider === 'groq' ? 'chip-groq' : 'chip-or');
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
    scrollToBottom(true);
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
        const greeting = `Halo ${panggilan}! Senka online.`;
        memoryList.push({ role: 'assistant', content: [{ type: 'text', text: greeting }] });
        saveSessions();
        appendMessage('senka', greeting);
        if (!modelKey) {
            appendMessage('senka', 'Sebelum ngobrol, pilih dulu model AI-nya lewat tombol pengaturan di atas.');
        }
    } else {
        memoryList.forEach(m => {
            const bubble = document.createElement('div');
            bubble.classList.add('message', m.role === 'user' ? 'msg-user' : 'msg-senka');
            (m.content || []).forEach(c => {
                if (!c) return;
                if (c.type === 'text') {
                    const p = document.createElement('div');
                    p.innerHTML = formatReply(c.text);
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
    scrollToBottom(true);
}

function formatReply(raw) {
    if (!raw) return '';
    let html = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="em">$1</span>');
    html = html.replace(/[*_`~#]/g, '');
    return html;
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
    if (isStreaming) return;

    if (!modelKey) {
        openSettings();
        appendMessage('senka', `Pilih dulu model AI-nya ya ${panggilan}, terus kirim lagi.`);
        scrollToBottom(true);
        return;
    }

    if (text.toLowerCase().startsWith('/gambar') && !base64Image) {
        const prompt = text.slice(7).trim();
        if (!prompt) { appendMessage('senka', 'Contoh: /gambar gadis anime rambut merah di taman.'); scrollToBottom(true); return; }
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
    scrollToBottom(true);

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'msg-senka');
    msgDiv.innerText = 'Senka ngetik…';
    chatHistoryDOM.appendChild(msgDiv);
    scrollToBottom(true);
    isStreaming = true;

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
                        if (!started) { msgDiv.innerText = ''; started = true; }
                        msgDiv.innerText += delta;
                        if (chatHistoryDOM.scrollHeight - chatHistoryDOM.scrollTop - chatHistoryDOM.clientHeight < 160) {
                            chatHistoryDOM.scrollTop = chatHistoryDOM.scrollHeight;
                        }
                    }
                } catch (e) { }
            }
        }

        if (streamError) throw new Error(streamError);
        if (!started) throw new Error('empty');

        const fullReply = msgDiv.innerText;
        const fileReq = parseFileRequest(fullReply);
        const displayText = fileReq ? fileReq.displayText.trim() : fullReply;

        msgDiv.innerHTML = formatReply(displayText);
        if (fileReq) msgDiv.appendChild(makeFileCard(fileReq.meta));
        addMsgActions(msgDiv);

        memoryList.push({ role: 'assistant', content: [{ type: "text", text: displayText }] });
        saveSessions();
        shrinkMemoryImages();
    } catch (error) {
        if (error.message === 'empty') {
            memoryList.pop();
            saveSessions();
            msgDiv.remove();
            return;
        }
        const errBubble = document.createElement('div');
        errBubble.classList.add('message', 'msg-senka');
        errBubble.innerHTML = `Waduh error: ${error.message.replace(/</g, '&lt;')} — <span class="retry-btn" onclick="retryLast()">coba lagi</span>`;
        msgDiv.replaceWith(errBubble);
        scrollToBottom(true);
    } finally {
        isStreaming = false;
    }
}

function parseFileRequest(reply) {
    const m = reply.match(/###SENKA_FILE###\s*(\{[\s\S]*?\})\s*$/);
    if (!m) return null;
    let meta = null;
    try { meta = JSON.parse(m[1]); } catch (e) { return null; }
    if (!meta || !meta.content || typeof meta.content !== 'string') return null;
    const displayText = reply.slice(0, m.index);
    return { meta, displayText };
}

function makeFileCard(meta) {
    const type = (meta.type || 'txt').toLowerCase();
    const name = (meta.name || 'file-senka').trim();
    const sizeKb = Math.max(1, Math.round((meta.content || '').length / 1024));
    const card = document.createElement('div');
    card.className = 'file-card';
    const iconMap = { txt: 'fa-file-lines', csv: 'fa-table', xlsx: 'fa-file-excel', doc: 'fa-file-word', pdf: 'fa-file-pdf' };
    card.innerHTML = `<div class="fc-icon"><i class="fa-solid ${iconMap[type] || 'fa-file'}"></i></div>
        <div class="fc-info">
            <div class="fc-name"></div>
            <div class="fc-meta">${type.toUpperCase()} · ${sizeKb} KB · siap diunduh</div>
        </div>
        <button class="fc-dl"><i class="fa-solid fa-download"></i></button>`;
    card.querySelector('.fc-name').innerText = name;
    card.querySelector('.fc-dl').onclick = () => downloadGeneratedFile(meta);
    return card;
}

function downloadGeneratedFile(meta) {
    const type = (meta.type || 'txt').toLowerCase();
    let name = (meta.name || 'file-senka').trim();
    const content = meta.content || '';
    const hasCJK = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(content);

    if (type === 'pdf' && !hasCJK) {
        if (!window.jspdf) return;
        const doc = new window.jspdf.jsPDF();
        const lines = doc.splitTextToSize(content, 185);
        let y = 14;
        lines.forEach((l, i) => {
            if (y > 282) { doc.addPage(); y = 14; }
            doc.setFontSize(i === 0 && content.includes('\n') ? 13 : 11);
            doc.text(l, 10, y);
            y += 6;
        });
        if (!name.includes('.')) name += '.pdf';
        doc.save(name);
        return;
    }

    if (type === 'xlsx' || type === 'excel' || type === 'csv') {
        const rows = content.split('\n').map(l => l.split(',')).filter(r => r.some(c => c.trim() !== ''));
        if (type === 'xlsx' || type === 'excel') {
            loadSheetJS(() => {
                const ws = XLSX.utils.aoa_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
                XLSX.writeFile(wb, name.includes('.') ? name : name + '.xlsx');
            });
            return;
        }
        const blob = new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
        saveBlob(blob, name.includes('.') ? name : name + '.csv');
        return;
    }

    if (type === 'doc' || type === 'docx' || hasCJK) {
        const safe = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = `<html><head><meta charset="utf-8"><title>${name}</title></head><body>${safe.split('\n').map(l => `<p>${l}</p>`).join('')}</body></html>`;
        const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
        saveBlob(blob, name.includes('.') ? name : name + '.doc');
        return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    saveBlob(blob, name.includes('.') ? name : name + '.txt');
}

function loadSheetJS(cb) {
    if (window.XLSX) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => cb();
    document.body.appendChild(s);
}

function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
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
    appendMessage('user', prompt);
    const loading = appendMessage('senka', 'Lagi bikin gambar, sebentar ya…');
    scrollToBottom(true);
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
            tag.innerText = data.model || 'Gambar AI';
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
            scrollToBottom(true);
        })
        .catch((e) => {
            loading.innerText = 'Gagal: ' + e.message;
            scrollToBottom(true);
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
    if (!window.jspdf) return;
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
        lines.forEach(l => {
            if (y > 282) { doc.addPage(); y = 14; }
            doc.text(l, 10, y);
            y += 6;
        });
        y += 3;
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
    saveBlob(blob, 'chat-senka.doc');
}

function appendMessage(role, text, isTypewriter = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', role === 'user' ? 'msg-user' : 'msg-senka');
    if (!isTypewriter) {
        msgDiv.innerText = text;
        chatHistoryDOM.appendChild(msgDiv);
        scrollToBottom(true);
    }
    return msgDiv;
}

function scrollToBottom(smooth = false) {
    chatHistoryDOM.scrollTo({ top: chatHistoryDOM.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendToSenka(); });
document.getElementById('image-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generateImage();
});

function initSakura() {
    const canvas = document.getElementById('sakura-canvas');
    const ctx = canvas.getContext('2d');
    let petals = [];
    let w, h, dpr;
    const COLORS = ['#ffd1dc', '#ffb7c5', '#ffc1cc', '#f9c8e2', '#ff9ec1'];

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const target = w < 600 ? 9 : w < 1200 ? 15 : 22;
        while (petals.length < target) petals.push(makePetal());
        petals.length = target;
    }

    function makePetal() {
        return {
            x: Math.random() * w,
            y: -30 - Math.random() * h * 0.6,
            size: 7 + Math.random() * 8,
            vy: 0.55 + Math.random() * 1.05,
            sway: Math.random() * Math.PI * 2,
            swaySpd: 0.006 + Math.random() * 0.014,
            swayAmp: 18 + Math.random() * 26,
            rot: Math.random() * Math.PI * 2,
            rotSpd: 0.005 + Math.random() * 0.018,
            alpha: 0.5 + Math.random() * 0.35,
            color: COLORS[Math.floor(Math.random() * COLORS.length)]
        };
    }

    function drawPetal(p) {
        const s = p.size;
        ctx.save();
        ctx.translate(p.x + Math.sin(p.sway) * p.swayAmp, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1 + 0.06 * Math.sin(p.sway * 1.7), 1);
        ctx.globalAlpha = p.alpha;
        const g = ctx.createLinearGradient(0, -s * 1.1, 0, s * 0.3);
        g.addColorStop(0, p.color);
        g.addColorStop(1, '#ffffff');
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-s * 0.9, -s * 0.35, -s * 0.5, -s * 1.15, 0, -s * 0.85);
        ctx.bezierCurveTo(s * 0.5, -s * 1.15, s * 0.9, -s * 0.35, 0, 0);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -s * 0.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.stroke();
        ctx.restore();
    }

    let last = performance.now();
    function tick(now) {
        const dt = Math.min((now - last) / 16.6667, 3);
        last = now;
        ctx.clearRect(0, 0, w, h);
        const wind = 0.12 + 0.08 * Math.sin(now / 4000);
        for (const p of petals) {
            p.sway += p.swaySpd * dt;
            p.rot += p.rotSpd * dt;
            p.y += p.vy * dt;
            p.x += wind * dt;
            if (p.y > h + 40) {
                Object.assign(p, makePetal(), { y: -30 });
            }
            drawPetal(p);
        }
        requestAnimationFrame(tick);
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(tick);
}
