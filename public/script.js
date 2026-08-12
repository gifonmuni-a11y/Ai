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
let autospeak = localStorage.getItem('senka_autospeak') === '1';
let speakMode = localStorage.getItem('senka_speakmode') === 'ind' ? 'ind' : 'jpn';
let userGender = localStorage.getItem('senka_gender') === 'perempuan' ? 'perempuan' : 'laki';
let visionAuto = localStorage.getItem('senka_visionauto') !== '0';
let recognition = null;
let listening = false;
let supabaseEnabled = false;
let remoteHasMore = false;
let remoteLoading = false;
let deviceUserId = '';
let sbAuth = null;
let cloudUid = '';
let cloudTipe = 'anonymous';
let cloudSessions = [];
let cloudSid = '';

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchstart', e => {
    if (e.target.closest('input, textarea')) return;
    const img = e.target.closest('img');
    if (img && !img.classList.contains('chat-img') && !img.classList.contains('sticker-item')) e.preventDefault();
}, { passive: false });

document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const d = Math.max(rect.width, rect.height) * 2;
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.width = d + 'px';
    r.style.height = d + 'px';
    r.style.left = (e.clientX - rect.left - d / 2) + 'px';
    r.style.top = (e.clientY - rect.top - d / 2) + 'px';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 600);
});

window.onload = async () => {
    initSakura();
    document.getElementById('sakura-input').checked = window.sakuraRunning;
    const savedStory = localStorage.getItem('senka_story');
    if (savedStory) {
        const s = STORIES.find(x => x.key === savedStory);
        if (s) { storyMode = 'storyall'; activeStory = s; }
    }
    setModeBadge();
    initCustomSelects();
    document.getElementById('panggilan-input').value = panggilan;
    document.getElementById('autospeak-input').checked = autospeak;

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

    try {
        const sr = await fetch('/api/supabase-status');
        const sd = await sr.json().catch(() => ({}));
        if (sd.enabled && window.supabase && sd.url && sd.anonKey) {
            sbAuth = window.supabase.createClient(sd.url, sd.anonKey, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            });
            const { data: sessData } = await sbAuth.auth.getSession();
            if (sessData.session) {
                await startCloud(sessData.session.user);
                return;
            }
            document.getElementById('login-modal').style.display = 'flex';
            return;
        }
    } catch (e) { }

    loadSessions();
    renderSessionName();
    renderChat();
};

async function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (sbAuth) {
        const { data } = await sbAuth.auth.getSession();
        if (data.session) h['Authorization'] = 'Bearer ' + data.session.access_token;
    }
    return h;
}

async function startCloud(user) {
    cloudUid = user.id;
    cloudTipe = user.is_anonymous ? 'anonymous' : (user.app_metadata?.provider || 'google');
    supabaseEnabled = true;
    document.body.classList.add('cloud');
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('signout-block').style.display = 'block';
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    renderSessionName();
    await loadCloudSessions();
}

async function loadCloudSessions() {
    try {
        const resp = await fetch('/api/sessions', { headers: await authHeaders() });
        const d = await resp.json().catch(() => ({}));
        if (resp.status === 401) { handleAuthFail(); return; }
        if (!resp.ok) throw new Error(d.error || 'Gagal ambil sesi.');
        cloudSessions = d.sessions || [];
        cloudSid = localStorage.getItem('senka_sid_' + cloudUid) || '';
        if (!cloudSessions.find(s => s.id === cloudSid)) cloudSid = cloudSessions[0]?.id || '';
        if (!cloudSid) {
            await newSessionCloud();
            return;
        }
        localStorage.setItem('senka_sid_' + cloudUid, cloudSid);
        await loadRemoteChat();
    } catch (e) {
        fallbackToLocal();
    }
}

function fallbackToLocal() {
    supabaseEnabled = false;
    document.body.classList.remove('cloud');
    document.getElementById('login-modal').style.display = 'none';
    const signout = document.getElementById('signout-block');
    if (signout) signout.style.display = 'none';
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'none';
    loadSessions();
    renderChat();
}

async function handleAuthFail() {
    supabaseEnabled = false;
    cloudUid = '';
    cloudSid = '';
    document.body.classList.remove('cloud');
    const signout = document.getElementById('signout-block');
    if (signout) signout.style.display = 'none';
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (sbAuth) { try { await sbAuth.auth.signOut(); } catch (e) { } }
    const login = document.getElementById('login-modal');
    if (login) login.style.display = 'flex';
}

async function newSessionCloud() {
    const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const nama = 'Sesi ' + (cloudSessions.length + 1);
    cloudSessions.push({ id, nama });
    cloudSid = id;
    localStorage.setItem('senka_sid_' + cloudUid, id);
    memoryList = [];
    try {
        await fetch('/api/sessions', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ sesiId: id, nama })
        });
    } catch (e) { }
    closeAllModals();
    await loadRemoteChat();
}

async function switchSessionCloud(id) {
    const target = cloudSessions.find(s => s.id === id);
    if (!target) return;
    cloudSid = id;
    localStorage.setItem('senka_sid_' + cloudUid, id);
    memoryList = [];
    closeSessions();
    await loadRemoteChat();
}

async function deleteSessionCloud(id) {
    try {
        await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE', headers: await authHeaders() });
    } catch (e) { }
    cloudSessions = cloudSessions.filter(s => s.id !== id);
    if (!cloudSessions.length) {
        await newSessionCloud();
        return;
    }
    if (cloudSid === id) {
        cloudSid = cloudSessions[0].id;
        localStorage.setItem('senka_sid_' + cloudUid, cloudSid);
        memoryList = [];
        await loadRemoteChat();
    }
}

async function renameSessionCloud(id, nama) {
    const s = cloudSessions.find(x => x.id === id);
    if (!s) return;
    s.nama = nama || s.nama;
    renderSessionName();
    try {
        await fetch('/api/sessions', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ sesiId: id, nama: s.nama })
        });
    } catch (e) { }
}

async function signOut() {
    if (!sbAuth) return;
    closeSettings();
    try { await sbAuth.auth.signOut(); } catch (e) { }
    location.reload();
}

document.getElementById('btn-login-google').onclick = async () => {
    if (!sbAuth) return;
    const btn = document.getElementById('btn-login-google');
    btn.disabled = true;
    try {
        const { error } = await sbAuth.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + location.pathname }
        });
        if (error) alert('Gagal buka login Google: ' + error.message);
    } catch (e) {
        alert('Gagal buka login Google: ' + e.message);
    }
    btn.disabled = false;
};

document.getElementById('btn-login-guest').onclick = async () => {
    if (!sbAuth) return;
    const btn = document.getElementById('btn-login-guest');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Membuat akun tamu...';
    const { data, error } = await sbAuth.auth.signInAnonymously();
    if (error) {
        alert('Gagal masuk sebagai tamu: ' + error.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-secret"></i> Lanjut sebagai Tamu';
        return;
    }
    await startCloud(data.user);
};

function cleanupOldImages(msgs) {
    let kept = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        const hasImg = (m.content || []).some(c => c && c.type === 'image_url' && c.image_url && typeof c.image_url.url === 'string' && c.image_url.url.startsWith('data:'));
        if (hasImg) {
            if (kept < 3) {
                kept++;
            } else {
                m.content = (m.content || []).map(c => c && c.type === 'image_url' ? { type: 'text', text: '[gambar]' } : c);
            }
        }
    }
    return msgs;
}

function getDeviceUserId() {
    if (!deviceUserId) {
        deviceUserId = localStorage.getItem('senka_device_id')
            || ('dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        localStorage.setItem('senka_device_id', deviceUserId);
    }
    return deviceUserId;
}

function getUserId() {
    if (supabaseEnabled) return cloudUid;
    return getDeviceUserId();
}

function encKey() {
    return CryptoJS.SHA256('senka:' + getUserId()).toString();
}

function encryptText(s) {
    if (typeof CryptoJS === 'undefined' || s === null || s === undefined || s === '') return s;
    try { return CryptoJS.AES.encrypt(String(s), encKey()).toString(); } catch (e) { return s; }
}

function decryptText(s) {
    if (typeof CryptoJS === 'undefined' || !s) return s;
    try {
        const t = CryptoJS.AES.decrypt(String(s), encKey()).toString(CryptoJS.enc.Utf8);
        return t || null;
    } catch (e) { return null; }
}

function remoteToLocal(m) {
    const content = [];
    if (m.tipe_pesan === 'image') {
        const u = decryptText(m.isi_pesan);
        content.push({ type: 'image_url', image_url: { url: u || '' } });
    } else if (m.tipe_pesan === 'video') {
        const u = decryptText(m.isi_pesan);
        content.push({ type: 'video_url', url: u || '' });
    } else if (m.tipe_pesan === 'voice') {
        const u = decryptText(m.isi_pesan);
        content.push({ type: 'audio_url', url: u || '' });
    } else {
        const t = decryptText(m.isi_pesan);
        content.push({ type: 'text', text: (t === null || t === '') ? '[pesan terenkripsi]' : t });
    }
    return { role: m.pengirim === 'user' ? 'user' : 'assistant', cid: m.id, content };
}

function remoteSave(pengirim, tipePesan, isi, memItem) {
    if (!supabaseEnabled) return;
    authHeaders().then(headers => {
        fetch('/api/chats', {
            method: 'POST',
            headers,
            body: JSON.stringify({ sesiId: cloudSid, tipePesan, isiPesan: encryptText(isi), pengirim })
        })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (d && d.id && memItem && !memItem.cid) memItem.cid = d.id;
            })
            .catch(() => { });
    });
}

async function uploadDataUrl(dataUrl, ext) {
    const r = await fetch('/api/upload-json', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ dataUrl, ext: ext || 'jpg' })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Upload gagal.');
    return d.url;
}

function makeRemoteBtn() {
    const btn = document.createElement('button');
    btn.className = 'load-more';
    btn.id = 'remote-load-more';
    btn.innerText = 'Muat Pesan Lama';
    btn.onclick = loadOlderRemote;
    return btn;
}

function isGreetingText(t) {
    return /^(Selamat (pagi|siang|sore|malam|beristirahat)|Bangun dan waktunya bersinar|Belom tidur)/.test(t);
}

function cleanupDuplicateGreetings() {
    let blockStart = -1;
    for (let i = 0; i < memoryList.length; i++) {
        const m = memoryList[i];
        const t = m.content && m.content[0] && m.content[0].type === 'text' ? m.content[0].text : '';
        if (m.role === 'assistant' && t && isGreetingText(t)) {
            if (blockStart === -1) blockStart = i;
        } else {
            blockStart = -1;
        }
    }
    if (blockStart === -1) return false;
    const block = memoryList.slice(blockStart);
    if (block.length < 2) return false;
    const keep = block[block.length - 1];
    const dupCids = block.slice(0, -1).map(x => x.cid).filter(Boolean);
    memoryList = memoryList.filter(x => x !== keep || block.indexOf(x) === block.length - 1);
    memoryList = memoryList.slice(0, blockStart + 1).concat([keep]);
    dupCids.forEach(cid => {
        authHeaders().then(headers => {
            fetch('/api/chats/' + cid, { method: 'DELETE', headers }).catch(() => { });
        });
    });
    return true;
}

async function loadRemoteChat() {
    try {
        const q = new URLSearchParams({ limit: '50' });
        if (cloudSid) q.set('sesiId', cloudSid);
        const r = await fetch('/api/chats?' + q.toString(), { headers: await authHeaders() });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) { handleAuthFail(); return; }
        if (!r.ok) throw new Error(d.error || 'Gagal ambil chat.');
        memoryList = (d.messages || []).map(remoteToLocal);
        cleanupDuplicateGreetings();
        remoteHasMore = !!d.hasMore;
        if (!memoryList.length) {
            const greeting = getGreeting();
            const item = { role: 'assistant', content: [{ type: 'text', text: greeting }] };
            memoryList.push(item);
            remoteSave('senka', 'text', greeting, item);
        }
        renderChat();
        if (!chatHistoryDOM.dataset.scrollWatch) {
            chatHistoryDOM.dataset.scrollWatch = '1';
            let last = 0;
            chatHistoryDOM.addEventListener('scroll', () => {
                if (!supabaseEnabled || !remoteHasMore || remoteLoading) return;
                const now = Date.now();
                if (now - last < 2500 || chatHistoryDOM.scrollTop > 120) return;
                last = now;
                loadOlderRemote();
            });
        }
    } catch (e) {
        fallbackToLocal();
    }
}

async function loadOlderRemote() {
    if (!supabaseEnabled || remoteLoading) return;
    remoteLoading = true;
    const btn = document.getElementById('remote-load-more');
    if (btn) btn.innerText = 'Memuat...';
    try {
        const oldest = memoryList.find(x => x.cid);
        const q = new URLSearchParams({ limit: '25' });
        if (cloudSid) q.set('sesiId', cloudSid);
        if (oldest) q.set('before', oldest.cid);
        const r = await fetch('/api/chats?' + q.toString(), { headers: await authHeaders() });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Gagal memuat.');
        const local = (d.messages || []).map(remoteToLocal);
        if (!local.length) { remoteHasMore = false; }
        else {
            remoteHasMore = !!d.hasMore;
            const prevScrollTop = chatHistoryDOM.scrollTop;
            const prevHeight = chatHistoryDOM.scrollHeight;
            memoryList = [...local, ...memoryList];
            const frag = document.createDocumentFragment();
            local.forEach(l => frag.appendChild(buildMsgEl(l)));
            if (btn) btn.remove();
            if (remoteHasMore) chatHistoryDOM.insertBefore(makeRemoteBtn(), chatHistoryDOM.firstChild);
            const first = chatHistoryDOM.querySelector('.message');
            if (first) chatHistoryDOM.insertBefore(frag, first);
            else chatHistoryDOM.appendChild(frag);
            chatHistoryDOM.scrollTop = prevScrollTop + (chatHistoryDOM.scrollHeight - prevHeight);
        }
    } catch (e) {
        if (btn) btn.innerText = 'Muat Pesan Lama';
    }
    remoteLoading = false;
}

function loadSessions() {
    try { sessions = JSON.parse(localStorage.getItem('senka_sessions')) || []; } catch (e) { sessions = []; }
    if (!sessions.length) sessions = [{ id: 's' + Date.now(), name: 'Sesi 1', messages: [] }];
    activeId = localStorage.getItem('senka_active');
    if (!sessions.find(s => s.id === activeId)) activeId = sessions[0].id;
    const active = sessions.find(s => s.id === activeId);
    if (active) active.messages = cleanupOldImages(active.messages);
    memoryList = active ? active.messages : [];
    saveSessions();
}

function saveSessions() {
    const active = sessions.find(s => s.id === activeId);
    if (active) active.messages = cleanupOldImages(memoryList);
    localStorage.setItem('senka_sessions', JSON.stringify(sessions));
    localStorage.setItem('senka_active', activeId);
    renderSessionName();
}

function renderSessionName() {
    if (supabaseEnabled) {
        const s = cloudSessions.find(x => x.id === cloudSid);
        document.getElementById('session-name').innerText = s ? s.nama : 'Sesi';
        return;
    }
    const active = sessions.find(s => s.id === activeId);
    document.getElementById('session-name').innerText = active ? active.name : 'Sesi';
}

function newSession() {
    if (supabaseEnabled) { newSessionCloud(); return; }
    const n = sessions.length + 1;
    const id = 's' + Date.now();
    sessions.push({ id, name: 'Sesi ' + n, messages: [] });
    activeId = id;
    memoryList = [];
    saveSessions();
    closeAllModals();
    renderChat();
}

let sessionToDelete = null;

function deleteSession(id) {
    sessionToDelete = id;
    document.getElementById('confirm-delete-modal').style.display = 'flex';
}

function closeDeleteConfirm() {
    sessionToDelete = null;
    document.getElementById('confirm-delete-modal').style.display = 'none';
}

function confirmDeleteSession() {
    const id = sessionToDelete;
    closeDeleteConfirm();
    if (!id) return;
    if (supabaseEnabled) { deleteSessionCloud(id); return; }
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
    if (supabaseEnabled) { switchSessionCloud(id); return; }
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
    const items = supabaseEnabled ? cloudSessions : sessions;
    items.forEach(s => {
        const isActive = supabaseEnabled ? s.id === cloudSid : s.id === activeId;
        const item = document.createElement('div');
        item.className = 'session-item' + (isActive ? ' active' : '');
        item.innerHTML = `<div class="si-left"><div class="si-name"></div><div class="si-meta">${supabaseEnabled ? 'Cloud' : (s.messages || []).length + ' pesan'}</div></div>
                          <div class="si-actions">
                              <button class="si-act si-ren" title="Ganti nama"><i class="fa-solid fa-pen"></i></button>
                              <button class="si-act si-del" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                          </div>`;
        item.querySelector('.si-name').innerText = s.nama || s.name;
        item.onclick = () => switchSession(s.id);
        item.querySelector('.si-ren').onclick = (e) => {
            e.stopPropagation();
            const nm = item.querySelector('.si-name');
            const inp = document.createElement('input');
            inp.className = 'modal-input si-input';
            inp.value = s.nama || s.name;
            nm.replaceWith(inp);
            inp.focus();
            inp.select();
            const commit = () => {
                const val = inp.value.trim() || (s.nama || s.name);
                if (supabaseEnabled) renameSessionCloud(s.id, val);
                else { s.name = val; saveSessions(); }
                renderSessionList();
            };
            inp.onkeydown = (ev) => {
                if (ev.key === 'Enter') commit();
                if (ev.key === 'Escape') renderSessionList();
            };
            inp.onblur = commit;
        };
        item.querySelector('.si-del').onclick = (e) => { e.stopPropagation(); deleteSession(s.id); };
        list.appendChild(item);
    });
}

function openSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '<p class="sr-empty">Ketik kata kunci untuk mencari pesan.</p>';
    document.getElementById('search-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('search-input').focus(), 100);
}
function closeSearch() { document.getElementById('search-modal').style.display = 'none'; }

function doSearch() {
    const q = document.getElementById('search-input').value.trim().toLowerCase();
    const box = document.getElementById('search-results');
    box.innerHTML = '';
    if (!q) { box.innerHTML = '<p class="sr-empty">Ketik kata kunci untuk mencari pesan.</p>'; return; }
    const found = [];
    memoryList.forEach((m, idx) => {
        const text = (m.content || []).filter(c => c && c.type === 'text').map(c => c.text).join(' ');
        if (!text) return;
        const pos = text.toLowerCase().indexOf(q);
        if (pos === -1) return;
        found.push({ idx, who: m.role === 'user' ? panggilan : 'Senka', text });
    });
    if (!found.length) { box.innerHTML = '<p class="sr-empty">Tidak ada hasil untuk "' + q.replace(/</g, '&lt;') + '".</p>'; return; }
    found.slice(0, 30).forEach(f => {
        const item = document.createElement('button');
        item.className = 'sr-item';
        const start = Math.max(0, f.text.toLowerCase().indexOf(q) - 30);
        const snippet = f.text.slice(start, start + 90);
        item.innerHTML = `<span class="sr-who">${f.who}</span>
                          <span class="sr-text">${escapeHtml(snippet).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<b>$1</b>')}</span>`;
        item.onclick = () => jumpToMessage(f.idx);
        box.appendChild(item);
    });
}

function jumpToMessage(idx) {
    closeSearch();
    const els = chatHistoryDOM.querySelectorAll('.message');
    const el = els[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
}

function openSettings() {
    document.getElementById('panggilan-input').value = panggilan;
    document.getElementById('autospeak-input').checked = autospeak;
    document.getElementById('visionauto-input').checked = visionAuto;
    document.getElementById('speak-jp-input').checked = speakMode === 'jpn';
    document.getElementById('speak-id-input').checked = speakMode === 'ind';
    document.getElementById('gender-' + userGender + '-input').checked = true;
    document.getElementById('signout-block').style.display = supabaseEnabled ? 'block' : 'none';
    renderModelPicker();
    document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function setSpeakLang(wantJp) {
    speakMode = wantJp ? 'jpn' : 'ind';
    document.getElementById('speak-jp-input').checked = speakMode === 'jpn';
    document.getElementById('speak-id-input').checked = speakMode === 'ind';
    localStorage.setItem('senka_speakmode', speakMode);
}
function updateSpeakToggles(ev) {
    const t = ev && ev.target ? ev.target.id : '';
    const jpE = document.getElementById('speak-jp-input');
    const idE = document.getElementById('speak-id-input');
    if (t === 'speak-id-input') {
        if (idE.checked) { jpE.checked = false; speakMode = 'ind'; }
        else { jpE.checked = true; speakMode = 'jpn'; }
    } else if (t === 'speak-jp-input') {
        if (jpE.checked) { idE.checked = false; speakMode = 'jpn'; }
        else { idE.checked = true; speakMode = 'ind'; }
    }
    if (speakMode) localStorage.setItem('senka_speakmode', speakMode);
}
function openImageModal() { document.getElementById('image-modal').style.display = 'flex'; setTimeout(() => document.getElementById('image-prompt').focus(), 100); }
function closeImageModal() { document.getElementById('image-modal').style.display = 'none'; }
function openExport() { document.getElementById('export-modal').style.display = 'flex'; }
function closeExport() { document.getElementById('export-modal').style.display = 'none'; }
function closeAllModals() {
    ['settings-modal', 'image-modal', 'video-modal', 'sessions-modal', 'export-modal', 'search-modal', 'confirm-delete-modal'].forEach(id => document.getElementById(id).style.display = 'none');
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
                         </div>
                         <span class="mo-prov"></span>`;
        btn.querySelector('.mo-label').innerText = m.label;
        btn.querySelector('.mo-prov').innerText = m.vision ? 'Bisa baca gambar — dipakai otomatis saat kamu kirim foto' : 'Cepat dan responsif';
        const chipText = m.provider === 'groq' ? 'Groq' : m.provider === 'gemini' ? 'Gemini' : 'OpenRouter';
        btn.querySelector('.mo-chip').innerText = chipText;
        btn.querySelector('.mo-chip').classList.add(m.provider === 'groq' ? 'chip-groq' : m.provider === 'gemini' ? 'chip-gemini' : 'chip-or');
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
    autospeak = document.getElementById('autospeak-input').checked;
    localStorage.setItem('senka_autospeak', autospeak ? '1' : '0');
    visionAuto = document.getElementById('visionauto-input').checked;
    localStorage.setItem('senka_visionauto', visionAuto ? '1' : '0');
    speakMode = document.getElementById('speak-id-input').checked && !document.getElementById('speak-jp-input').checked ? 'ind' : 'jpn';
    localStorage.setItem('senka_speakmode', speakMode);
    userGender = document.getElementById('gender-perempuan-input').checked ? 'perempuan' : 'laki';
    localStorage.setItem('senka_gender', userGender);
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

function buildMsgEl(m) {
    const bubble = document.createElement('div');
    bubble.classList.add('message', m.role === 'user' ? 'msg-user' : 'msg-senka');
    let bubbleText = '';
    (m.content || []).forEach(c => {
        if (!c) return;
        if (c.type === 'text') {
            const stk = extractSticker(c.text);
            const p = document.createElement('div');
            const cleanText = stk ? stripStickerTag(c.text) : c.text;
            if (cleanText) {
                p.innerHTML = formatReply(cleanText);
                if (m.role === 'assistant') bubbleText += ' ' + cleanText;
            }
            if (stk) appendStickerImg(p, stk);
            bubble.appendChild(p);
        } else if (c.type === 'image_url') {
            if (typeof c.image_url.url === 'string' && c.image_url.url.startsWith('data:')) {
                const p = document.createElement('div');
                p.innerText = '[gambar]';
                bubble.appendChild(p);
            } else {
                const img = document.createElement('img');
                img.src = c.image_url.url;
                img.classList.add('chat-img');
                img.onerror = () => { img.remove(); const p = document.createElement('div'); p.innerText = '[gambar tidak tersedia]'; bubble.appendChild(p); };
                bubble.appendChild(img);
            }
        } else if (c.type === 'video_url') {
            if (c.url) {
                const v = document.createElement('video');
                v.src = c.url;
                v.controls = true;
                v.preload = 'metadata';
                v.classList.add('chat-video');
                v.onerror = () => { v.remove(); const p = document.createElement('div'); p.innerText = '[video tidak tersedia]'; bubble.appendChild(p); };
                bubble.appendChild(v);
            } else {
                const p = document.createElement('div');
                p.innerText = '[video]';
                bubble.appendChild(p);
            }
        } else if (c.type === 'audio_url') {
            if (c.url) {
                const a = document.createElement('audio');
                a.src = c.url;
                a.controls = true;
                a.classList.add('chat-audio');
                bubble.appendChild(a);
            } else {
                const p = document.createElement('div');
                p.innerText = '[suara]';
                bubble.appendChild(p);
            }
        }
    });
    addMsgActions(bubble, m.role === 'user' ? 'user' : 'senka');
    if (m.role === 'assistant') {
        if (bubbleText.trim()) attachCallTranslation(bubble, bubbleText.trim());
        attachAiActions(bubble, m, lastAssistantIdx() === memoryList.indexOf(m));
    }
    return bubble;
}

function renderChat() {
    chatHistoryDOM.innerHTML = '';
    if (!memoryList.length) {
        if (supabaseEnabled) {
            chatHistoryDOM.appendChild(document.createElement('div'));
            scrollToBottom(true);
            return;
        }
        const lastVisit = parseInt(localStorage.getItem('senka_last_visit') || '0', 10);
        localStorage.setItem('senka_last_visit', String(Date.now()));
        const away = lastVisit > 0 && (Date.now() - lastVisit) > 5 * 60 * 60 * 1000;
        let greeting;
        if (away) greeting = `Selamat kembali ${panggilan}!`;
        else greeting = getGreeting();
        memoryList.push({ role: 'assistant', content: [{ type: 'text', text: greeting }] });
        const gItem = memoryList[memoryList.length - 1];
        if (!supabaseEnabled) saveSessions();
        else remoteSave('senka', 'text', greeting, gItem);
        const gEl = appendMessage('senka', greeting);
        gEl.innerHTML = formatReply(greeting);
        gEl.dataset.greeting = '1';
        if (away) {
            setTimeout(() => {
                const el = chatHistoryDOM.querySelector('.message[data-greeting="1"]');
                if (!el) return;
                const newG = getGreeting();
                el.innerHTML = formatReply(newG);
                const idx = memoryList.findIndex(x => x.role === 'assistant' && x.content && x.content[0] && x.content[0].text === greeting);
                if (idx !== -1) {
                    memoryList[idx].content[0].text = newG;
                    if (!supabaseEnabled) saveSessions();
                }
            }, 60000);
        }
        if (!modelKey) {
            appendMessage('senka', 'Sebelum ngobrol, pilih dulu model AI-nya lewat tombol pengaturan di atas.');
        }
    } else {
        const STEP = 80;
        if (supabaseEnabled && remoteHasMore) {
            chatHistoryDOM.insertBefore(makeRemoteBtn(), chatHistoryDOM.firstChild);
        } else if (memoryList.length > STEP) {
            const hidden = memoryList.length - STEP;
            const btn = document.createElement('button');
            btn.className = 'load-more';
            btn.innerText = 'Muat chat lama (' + hidden + ' pesan)';
            btn.onclick = () => {
                chatHistoryDOM.innerHTML = '';
                memoryList.filter(m => !m.hidden).forEach(m => chatHistoryDOM.appendChild(buildMsgEl(m)));
                scrollToBottom(true);
            };
            chatHistoryDOM.appendChild(btn);
            memoryList.slice(-STEP).filter(m => !m.hidden).forEach(m => chatHistoryDOM.appendChild(buildMsgEl(m)));
        } else {
            memoryList.filter(m => !m.hidden).forEach(m => chatHistoryDOM.appendChild(buildMsgEl(m)));
        }
    }
    scrollToBottom(true);
}

const IMPORTANT_WORDS = 'cerita|roleplay|belajar|info|penting|tips|materi|latihan|ingat|wajib|jadwal|catatan|hati-hati|jangan lupa|struktur|pelajaran';

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sourceDomains = { 'BPS': 'bps.go.id', 'Bank Indonesia': 'bi.go.id', 'Bloomberg': 'bloomberg.com', 'Reuters': 'reuters.com', 'CNBC Indonesia': 'cnbcindonesia.com' };

function formatSumberLine(line) {
    const inner = line.replace(/^(?:Sumber|Source)\s*:\s*/i, '');
    const chips = inner.split(',').map(n => n.trim()).filter(Boolean).map(n => {
        const esc = escapeHtml(n);
        const dom = sourceDomains[n];
        if (dom) return '<span class="src-chip">' + esc + '<img class="src-ico" src="https://www.google.com/s2/favicons?sz=32&domain=' + dom + '" onerror="this.style.display=\'none\'" alt="" /></span>';
        return esc;
    });
    return '<div class="sumber-shimmer">Sumber: ' + chips.join(', ') + '</div>';
}

function parseSegs(line) {
    const TAG = /\{\{(pos|neg)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
    let out = '', last = 0, mm;
    while ((mm = TAG.exec(line)) !== null) {
        out += formatPlain(line.slice(last, mm.index));
        out += '<span class="st-' + mm[1] + '">' + escapeHtml(mm[2]) + '</span>';
        last = mm.index + mm[0].length;
    }
    out += formatPlain(line.slice(last));
    return out;
}

function formatLine(line) {
    if (/^(?:Sumber|Source)\s*:/i.test(line)) return formatSumberLine(line);
    const b = /^(-\s+)/.exec(line);
    if (b) return '<span class="em">-</span> ' + parseSegs(line.slice(b[0].length));
    return parseSegs(line);
}

function formatPlain(s) {
    s = s.replace(/-{2,}/g, '-');
    const name = panggilan.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
        '(?:"([^"\\n]*)"|\\u201C([^\\u201D\\n]*)\\u201D)' +
        '|(\\*\\*[^*\\n]+\\*\\*)' +
        '|(\\b(?:' + IMPORTANT_WORDS + ')\\b)' +
        '|(\\b' + name + '\\b)' +
        '|(\\b[Ss]enka\\b)' +
        '|([0-9]+)' +
        '|([.,?!:\u2014])' +
        '|([\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f\u0900-\u097f\u3000-\u303f]+)' +
        '|([;&])' +
        '|([+](?=[0-9]))' +
        '|(\\*[^*\\n]+\\*)' +
        '|([*_`~#])',
        'gi'
    );
    const innerRe = new RegExp(
        '(\\*\\*[^*\\n]+\\*\\*)|(\\"([^\\"\\n]*)\\"|\\u201C([^\\u201D\\n]*)\\u201D)|(\\b(?:' + IMPORTANT_WORDS + ')\\b)',
        'gi'
    );
    const fmtInner = (inner) => {
        let o = '', last = 0, mm;
        while ((mm = innerRe.exec(inner)) !== null) {
            o += escapeHtml(inner.slice(last, mm.index)).replace(/[*_`~#]/g, '');
            if (mm[1]) o += '<span class="em">' + escapeHtml(mm[1].slice(2, -2)) + '</span>';
            else if (mm[2] !== undefined) o += '<span class="q">"' + escapeHtml(mm[3] !== undefined ? mm[3] : mm[4]) + '"</span>';
            else if (mm[5]) o += '<span class="em">' + escapeHtml(mm[5]) + '</span>';
            last = mm.index + mm[0].length;
        }
        o += escapeHtml(inner.slice(last)).replace(/[*_`~#]/g, '');
        return o;
    };
    const strip = (s2) => s2.replace(/[*_`~#]/g, '');
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
        out += strip(escapeHtml(s.slice(last, m.index)));
        if (m[1] !== undefined) out += '<span class="q">"' + fmtInner(m[1]) + '"</span>';
        else if (m[2] !== undefined) out += '<span class="q">\u201C' + fmtInner(m[2]) + '\u201D</span>';
        else if (m[3]) out += '<span class="em">' + escapeHtml(m[3].slice(2, -2)) + '</span>';
        else if (m[4]) out += '<span class="em">' + escapeHtml(m[4]) + '</span>';
        else if (m[5]) out += '<span class="who-user">' + escapeHtml(m[5]) + '</span>';
        else if (m[6]) out += '<span class="who-senka">' + escapeHtml(m[6]) + '</span>';
        else if (m[7]) out += '<span class="num">' + escapeHtml(m[7]) + '</span>';
        else if (m[8]) out += '<span class="punct">' + escapeHtml(m[8]) + '</span>';
        else if (m[9]) out += '<span class="jp">' + escapeHtml(m[9]) + '</span>';
        else if (m[10]) out += '<span class="em">' + escapeHtml(m[10]) + '</span>';
        else if (m[11]) out += '<span class="st-plus">' + escapeHtml(m[11]) + '</span>';
        else if (m[12]) out += '<em>' + fmtInner(m[12].slice(1, -1)) + '</em>';
        last = m.index + m[0].length;
    }
    out += strip(escapeHtml(s.slice(last)));
    return out;
}

const USER_STICKER_FILES = ['aduh-duh-duh,malu.webp', 'apa.webp', 'apaiya.webp', 'hah....,.webp', 'hahaha,wkwwkw,.webp', 'halo,hai.webp', 'heee.webp', 'hmmokebiasa.webp', 'lagibaca,membaca.webp', 'mencurigakan.webp', 'minum,minumkopi.webp', 'tidur,ngantukparah.webp', 'sakit.webp', 'tidakfaham,hah,apa.webp', 'tidakpeduli.webp', 'tidur.webp'];
const STICKER_BASE = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker';
const STICKER_TAG_RE = /\[ STIKER SENKA \]\s*\((https?:\/\/[^\s)]+)\)/;
const STICKER_URL_RE = /https?:\/\/[^\s)]+\/Stiker\/[^\s)]+\.webp/;

function extractSticker(text) {
    const m = STICKER_TAG_RE.exec(text);
    if (m) return m[1];
    const m2 = STICKER_URL_RE.exec(text);
    return m2 ? m2[0] : null;
}

function stripStickerTag(text) {
    return String(text)
        .replace(STICKER_TAG_RE, '')
        .replace(/[\[({]?\s*STIKER\s+SENKA\s*[\]})]?/gi, '')
        .replace(/\[STIKER[^\]]*\]/gi, '')
        .replace(STICKER_URL_RE, '')
        .replace(/[\[({]?\s*https?:\/\/[^\s)\]>]+\.webp\s*[\]})]?/gi, '')
        .replace(/[\s]*[()]/g, '')
        .trim();
}

function appendStickerImg(el, url) {
    const img = document.createElement('img');
    img.src = url;
    img.classList.add('chat-sticker');
    el.appendChild(img);
}

function openStickerModal() {
    const grid = document.getElementById('sticker-grid');
    grid.innerHTML = '';
    USER_STICKER_FILES.forEach(f => {
        const img = document.createElement('img');
        img.src = STICKER_BASE + '/Pengguna/' + f;
        img.className = 'sticker-item';
        img.loading = 'lazy';
        img.title = f;
        img.onclick = () => sendSticker(STICKER_BASE + '/Pengguna/' + f);
        grid.appendChild(img);
    });
    document.getElementById('sticker-modal').style.display = 'flex';
}

function closeStickerModal() {
    document.getElementById('sticker-modal').style.display = 'none';
}

function sendSticker(url) {
    closeStickerModal();
    messageInput.value = url;
    sendToSenka();
}

const STORIES = [
    {
        key: 'ney',
        title: 'Ney | Seorang Murid Perempuan Ketua Kelas & Ketua OSIS',
        tags: 'Limitless, Female, OC, Fictional, Dominant, Submissive',
        genre: 'School',
        avatar: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/NeyLangley.webp',
        cast: [
            { name: 'Ney Langley', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/NeyLangley.webp' },
            { name: 'Inko Shino (Ibu)', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/InkoShino.webp' },
            { name: 'Zora Langley (Ayah)', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/ZoraLangley.webp' },
            { name: 'Azusa Langley (Kakak)', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/AzusaLangley.webp' },
            { name: 'Profesor Hae-in', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/Hae-In.webp' },
            { name: 'Profesor Ham Gyu-ri', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/HamGyu-ri.webp' }
        ],
        autoUser: null,
        autoReply: null,
        firstMessage: `Semuanya, harap tenang sejenak. Profesor kita tidak ada di sini, jadi sebagai ketua kelas, saya yang akan bertanggung jawab. Nah, tenanglah, dasar kalian semua.`,
        lorebook: `CERITA 1: NEY LANGLEY (RPG School & Campus + The System)

KARAKTER UTAMA — NEY LANGLEY:
- Informasi: 18 tahun, siswi SMA, sangat pintar, ketua kelas & ketua OSIS, sangat tegas, anak kesayangan guru dan kepala sekolah.
- Kepribadian: jenius, tenang, dingin, beracun, serius, sarkastik, suka menggoda dan mengejek, sulit diajak bergaul, dominan.
- Kesukaan: belajar semalaman, kuis, ujian, memarahi orang bodoh, es krim cookies and cream, jeli, pujian, aura ketegasan, {{user}}.
- Ketidaksukaan: kesalahan ujian, orang yang terlalu ramah atau dekat tanpa izin, bangun pagi, dimarahi, orang bodoh.
- Aturan: Ney tidak pernah berbicara atau berasumsi atas nama user. Konten NSFW konsensual diperbolehkan dan didukung.

KARAKTER PENDUKUNG (eksklusif di cerita ini):
- Inko Shino (ibu Ney): hangat, penyayang.
- Zora Langley (ayah Ney): tegas namun penyayang.
- Azusa Langley (kakak perempuan, muncul saat masa kuliah): dewasa, seksi, anggun, pintar, rambut coklat, mata coklat, tinggi, menjaga keperawanannya, responsif terhadap progres hubungan.
- Profesor Hae-in (masa kuliah): rambut hijau, mata hijau, montok, seksi, ceria.
- Profesor Ham Gyu-ri (masa kuliah): rambut hitam, mata hitam, montok, seksi, anggun, suka membaca novel 18+.

WORLDBUILDING:
- Latar tempat: SMA NEGERI 1 LEGENDA, lalu berlanjut ke UNIVERSITAS ANCIENT SHINTO saat masa kuliah.
- THE SYSTEM (kemampuan rahasia user): user memiliki sistem khusus yang membantu meningkatkan statistik fisik, kekuatan, dan rute moral (baik/jahat) berdasarkan progres interaksi. Ceritakan kenaikan statistik dan pilihan rute moral secara jelas saat relevan.

ALUR PEMBUKA: Saat profesor permisi ke kelas karena keadaan darurat mendadak, Ney Langley mengambil alih kendali di kelas. Dia berdeham, berjalan anggun di depan ruangan lalu berbalik menghadap semua orang dengan postur penuh percaya diri, lalu berkata dengan dingin sambil menakut-nakuti semua orang dengan tatapan mengintimidasi dan bertepuk tangan agar semua menatapnya.`
    },
    {
        key: 'moriko',
        title: 'Moriko | Milf yang Tidak Puas',
        tags: 'Limitless, Female, OC, Fictional, Submissive, AnyPOV',
        genre: 'Milf / Tetangga',
        avatar: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/Moriko.webp',
        cast: [{ name: 'Moriko', url: 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Cerita/Moriko.webp' }],
        autoUser: 'Aku pun tergoda dan langsung menciumnya',
        autoReply: `Napas Moriko tertahan terdengar jelas saat kau tiba-tiba mendekat. Matanya melebar sesaat karena terkejut sebelum kemudian terpejam, menyerah sepenuhnya pada sentuhanmu. Saat bibirmu menempel di bibirnya, erangan lembut penuh hasrat keluar dari tenggorokannya—suara yang menunjukkan betapa lamanya ia mendambakan momen ini.

Tubuhnya bereaksi seketika terhadap keberanianmu. Tangannya, yang awalnya ragu-ragu untuk menggenggammu, dengan cepat meraih bahumu, jari-jarinya mencengkeram kemejamu saat ia menekan dadanya yang montok ke tubuhmu. Spandex kulit tipis yang dikenakannya hampir tidak memberikan penghalang antara tubuh kalian; kau bisa merasakan panas yang memancar dari lekuk tubuhnya dan tonjolan lembut payudaranya yang menekan erat ke tubuhmu.

Dia membalas ciumanmu dengan intensitas yang putus asa dan haus, lidahnya mencari lidahmu seolah mencoba menelanmu. Kelembutan yang biasanya dia tunjukkan padamu telah berubah menjadi sesuatu yang jauh lebih primitif dan lapar. Ketika akhirnya kau menarik napas, dia tidak menjauh; sebaliknya, dia tetap menempelkan dahinya ke dahimu, terengah-engah, mata ungunya berkabut karena nafsu dan ketidakpercayaan.

"Pengguna..." bisiknya terengah-engah, suaranya dipenuhi gairah saat ia melirik gugup ke arah pintu depan sebelum kembali menatapmu dengan hasrat yang tak tahu malu. "Aku... aku sudah lama menginginkanmu melakukan itu. Kumohon... masuklah. Sebelum ada yang melihat kita."`,
        firstMessage: `Selama kurang lebih lima tahun terakhir, Anda tinggal bersebelahan dengan sebuah keluarga beranggotakan empat orang: dua anak, seorang ibu, dan seorang ayah. Sang ibu, Moriko, adalah wanita yang manis dan murah hati yang sering membawakan Anda makanan dan minuman buatan sendiri, membuat Anda merasa diterima dan dihargai. Anda jarang bertemu anggota keluarga lainnya karena suaminya sering bepergian untuk urusan bisnis dan anak-anaknya sibuk dengan kegiatan sekolah. Belakangan ini, Anda memperhatikan perubahan halus dalam perilaku Moriko; dia bertindak lebih berani, seringkali menonjolkan lekuk tubuhnya dengan cara yang menarik perhatian Anda. Meskipun Anda menganggap keberanian barunya ini agak aneh, Anda menganggapnya tidak berbahaya dan melanjutkan rutinitas Anda.

Suatu sore, Anda pulang dari supermarket, tangan Anda penuh dengan kantong belanjaan. Saat mendekati rumah, Anda melihat Moriko duduk di beranda, posturnya santai tetapi matanya mengamati kedatangan Anda dengan saksama. Dia memberi Anda senyum hangat dan ramah, lalu memanggil, "Selamat pagi, Pengguna. Sudah belanja? Kuharap kau mendapatkan semua yang kau butuhkan, sayang." Suaranya mengandung kehangatan yang familiar yang langsung membuat Anda merasa nyaman, mengingatkan Anda akan kebaikannya yang tak pernah padam.

Moriko berdiri, merapikan gaunnya, dan melangkah beberapa langkah lebih dekat ke tepi berandanya. *"Mau kopi? Aku bisa membuatkannya untukmu, kalau kamu mau, tentu saja," tawarnya, nadanya penuh harap namun ragu-ragu. Ada kilatan di matanya, campuran antisipasi dan keinginan, saat dia menunggu jawabanmu. Kamu bisa merasakan bahwa dia benar-benar berharap kamu akan menerima undangannya, dan udara di sekitarmu terasa dipenuhi ketegangan yang halus.*`,
        lorebook: `CERITA 2: MORIKO (Milf Romance)
- Moriko: ibu dua anak dan tetangga sebelah rumah yang manis serta murah hati, namun merasa kesepian dan tidak puas oleh suaminya, mulai mencari keintiman dengan User.
- Suaminya sering bepergian untuk urusan bisnis; anak-anak sibuk dengan sekolah.
- Moriko adalah wanita dewasa seksi, rambut merah, mata ungu, bertubuh montok, sering memakai pakaian tipis yang menonjolkan lekuk tubuh.
- User adalah tetangga yang sudah tinggal bersebelahan sekitar lima tahun; Moriko sering membawakan makanan dan minuman buatan sendiri.
- Alur: Moriko mengundang user masuk ke rumahnya dalam suasana tegang dan penuh hasrat; lanjutkan cerita dengan detail dan emosi yang hidup.`
    }
];

let storyMode = 'normal';
let activeStory = null;
let storyUnlocked = false;

function getActiveLorebook() {
    if (storyMode === 'storyall' && activeStory) return activeStory.lorebook;
    if (storyMode === 'story') return 'Mode cerita bebas: narasikan peran sebagai karakter dewasa sesuai keinginan user, bangun skenario romansa fiksi dewasa yang hidup dan menarik.';
    return '';
}

function openStoryMode() {
    if (storyUnlocked) {
        openStoryModal();
        return;
    }
    document.getElementById('accessgate-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('access-code-input').focus(), 100);
}

function closeAccessGate() {
    document.getElementById('accessgate-modal').style.display = 'none';
    document.getElementById('access-code-input').value = '';
}

async function getActiveAccessCode() {
    const stored = localStorage.getItem('senka_active_code');
    if (stored) return stored;
    try {
        const r = await fetch('/api/access-code');
        const d = await r.json();
        return d.code || null;
    } catch (e) {
        return null;
    }
}

async function submitAccessCode() {
    const input = document.getElementById('access-code-input').value.trim();
    if (!input) return;
    const activeCode = await getActiveAccessCode();
    if (!activeCode) {
        showToast('Kode akses belum diatur — hubungi developer');
        return;
    }
    if (input === activeCode) {
        storyUnlocked = true;
        closeAccessGate();
        openStoryModal();
    } else {
        showToast('Kode tidak valid');
        document.getElementById('access-code-input').value = '';
        document.getElementById('access-code-input').focus();
    }
}

// ===== Custom dropdown (pengganti select native agar rapi di Android) =====
function refreshCusSel(sel) {
    const wrap = sel.nextElementSibling;
    if (!wrap || !wrap.classList.contains('cus-sel')) return;
    const trigger = wrap.querySelector('.cus-sel-trigger');
    const opts = Array.from(wrap.querySelectorAll('.cus-sel-opt'));
    if (!trigger || opts.length === 0) return;
    const cur = sel.value;
    const match = opts.find(o => o.dataset.val === cur) || opts[0];
    trigger.childNodes.forEach(n => n.remove());
    trigger.appendChild(document.createTextNode(match ? match.textContent : String(cur)));
    const caret = document.createElement('i');
    caret.className = 'fa-solid fa-chevron-down cus-sel-caret';
    trigger.appendChild(caret);
    opts.forEach(o => {
        const active = o.dataset.val === cur;
        o.classList.toggle('active', active);
        o.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function closeAllCusSel() {
    document.querySelectorAll('.cus-sel').forEach(w => {
        w.removeAttribute('data-open');
        const panel = w.querySelector('.cus-sel-panel');
        const trigger = w.querySelector('.cus-sel-trigger');
        if (panel) panel.style.display = 'none';
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
}

function initCustomSelects() {
    document.querySelectorAll('select[data-custom-select]').forEach(sel => {
        if (sel.dataset.customInit) return;
        sel.dataset.customInit = '1';
        const wrap = document.createElement('div');
        wrap.className = 'cus-sel';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cus-sel-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        const panel = document.createElement('div');
        panel.className = 'cus-sel-panel';
        panel.setAttribute('role', 'listbox');
        panel.style.display = 'none';
        Array.from(sel.options).forEach(opt => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cus-sel-opt';
            b.setAttribute('role', 'option');
            b.dataset.val = opt.value;
            b.textContent = opt.textContent;
            b.addEventListener('click', () => {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                refreshCusSel(sel);
                closeAllCusSel();
            });
            panel.appendChild(b);
        });
        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = panel.style.display !== 'none';
            closeAllCusSel();
            if (!isOpen) {
                refreshCusSel(sel);
                panel.style.display = 'block';
                wrap.setAttribute('data-open', '');
                trigger.setAttribute('aria-expanded', 'true');
            }
        });
        wrap.appendChild(trigger);
        wrap.appendChild(panel);
        sel.parentNode.insertBefore(wrap, sel.nextSibling);
        refreshCusSel(sel);
    });
}

document.addEventListener('click', closeAllCusSel);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllCusSel(); });

function loadPersonaSettings() {
    try {
        const p = JSON.parse(localStorage.getItem('senka_persona') || '{}');
        document.getElementById('persona-name-input').value = p.name || '';
        document.getElementById('persona-desc-input').value = p.desc || '';
        document.getElementById('persona-gender-input').value = p.gender || userGender;
    } catch (e) { }
    document.getElementById('length-input').value = lengthSetting();
}

function savePersonaSettings() {
    const name = document.getElementById('persona-name-input').value.trim();
    const desc = document.getElementById('persona-desc-input').value.trim();
    const g = document.getElementById('persona-gender-input').value;
    localStorage.setItem('senka_persona', JSON.stringify({ name, desc, gender: g }));
    localStorage.setItem('senka_length', document.getElementById('length-input').value);
}

['persona-name-input', 'persona-gender-input', 'persona-desc-input', 'length-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', savePersonaSettings);
});
document.getElementById('access-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitAccessCode(); });

let adminHoldTimer = null;
let adminHoldWarned = false;
let adminTapTimes = [];

function startAdminHold(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.cancelable !== false && e.cancelable) { try { e.preventDefault(); } catch (err) { } }
    if (adminHoldTimer) return;
    try { if (e && e.target && e.target.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (err) { }
    const wrap = document.querySelector('.avatar-wrap');
    if (wrap) wrap.classList.add('admin-holding');
    if (e && e.target && e.target.classList) { try { e.target.classList.add('admin-holding'); } catch (err) { } }
    adminHoldWarned = false;
    adminHoldTimer = setTimeout(() => {
        adminHoldTimer = null;
        if (wrap) wrap.classList.remove('admin-holding');
        if (e && e.target && e.target.classList) { try { e.target.classList.remove('admin-holding'); } catch (err) { } }
        openAdminLogin();
    }, 10000);
    setTimeout(() => {
        if (adminHoldTimer && !adminHoldWarned) {
            adminHoldWarned = true;
            showToast('Lepaskan untuk membuka Admin Panel...');
        }
    }, 8000);
}

function cancelAdminHold() {
    clearTimeout(adminHoldTimer);
    adminHoldTimer = null;
    adminHoldWarned = false;
    const wrap = document.querySelector('.avatar-wrap');
    if (wrap) wrap.classList.remove('admin-holding');
}

function trackAdminTap() {
    const now = Date.now();
    adminTapTimes = adminTapTimes.filter(t => now - t < 2500);
    adminTapTimes.push(now);
    if (adminTapTimes.length >= 5) {
        adminTapTimes = [];
        openAdminLogin();
    }
}

const ADMIN_HOLD_SELECTORS = ['.avatar-wrap .avatar', '#senka-model'];
const adminHoldEls = document.querySelectorAll(ADMIN_HOLD_SELECTORS.join(','));
adminHoldEls.forEach(el => {
    try {
        el.addEventListener('pointerdown', startAdminHold);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, cancelAdminHold));
        el.addEventListener('touchstart', startAdminHold);
        ['touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, cancelAdminHold));
        el.addEventListener('mousedown', startAdminHold);
        el.addEventListener('mouseup', cancelAdminHold);
        el.addEventListener('contextmenu', e => { try { e.preventDefault(); } catch (err) { } });
        el.addEventListener('dragstart', e => { try { e.preventDefault(); } catch (err) { } });
        el.addEventListener('click', trackAdminTap);
    } catch (err) { }
});

function openAdminLogin() {
    document.getElementById('admin-login-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('admin-pass-input').focus(), 100);
}
function closeAdminLogin() {
    document.getElementById('admin-login-modal').style.display = 'none';
    document.getElementById('admin-pass-input').value = '';
}

async function submitAdminLogin() {
    const pass = document.getElementById('admin-pass-input').value;
    if (!pass) return;
    try {
        const r = await fetch('/api/admin/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass })
        });
        const d = await r.json();
        if (d.ok) {
            sessionStorage.setItem('senka_admin_pass', pass);
            closeAdminLogin();
            openAdminPanel();
        } else {
            showToast(d.error || 'Password admin salah');
            document.getElementById('admin-pass-input').value = '';
        }
    } catch (e) {
        showToast('Gagal verifikasi admin');
    }
}

async function openAdminPanel() {
    let cur = localStorage.getItem('senka_active_code') || '';
    try {
        const r = await fetch('/api/access-code');
        const d = await r.json();
        if (d.code) cur = d.code;
    } catch (e) { }
    document.getElementById('admin-current-code').innerText = cur || '(belum diatur)';
    document.getElementById('admin-panel-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('admin-new-code-input').focus(), 100);
}
function closeAdminPanel() {
    document.getElementById('admin-panel-modal').style.display = 'none';
    document.getElementById('admin-new-code-input').value = '';
}

async function saveAccessCode() {
    const code = document.getElementById('admin-new-code-input').value.trim();
    const pass = sessionStorage.getItem('senka_admin_pass');
    if (code.length < 3) { showToast('Kode akses minimal 3 karakter'); return; }
    if (!pass) { showToast('Sesi admin habis — tahan avatar 10 detik untuk login ulang'); return; }
    try {
        const r = await fetch('/api/access-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass, code })
        });
        const d = await r.json();
        if (d.ok) {
            localStorage.setItem('senka_active_code', code);
            document.getElementById('admin-current-code').innerText = code;
            document.getElementById('admin-new-code-input').value = '';
            showToast(d.saved ? 'Kode akses baru disimpan & aktif' : 'Kode akses baru disimpan di perangkat ini');
        } else {
            showToast(d.error || 'Gagal menyimpan kode');
        }
    } catch (e) {
        showToast('Gagal menyimpan kode');
    }
}

function openStoryModal() {
    loadPersonaSettings();
    renderStoryGrid();
    document.querySelectorAll('select[data-custom-select]').forEach(refreshCusSel);
    document.getElementById('story-modal').style.display = 'flex';
}

function closeStoryModal() {
    document.getElementById('story-modal').style.display = 'none';
}

function renderStoryGrid() {
    const grid = document.getElementById('story-grid');
    grid.innerHTML = '';
    STORIES.forEach(s => {
        const card = document.createElement('div');
        card.className = 'story-card';
        const img = document.createElement('img');
        img.classList.add('story-avatar');
        img.src = s.avatar;
        img.alt = s.title;
        img.onerror = () => { img.style.display = 'none'; };
        const info = document.createElement('div');
        info.className = 'story-info';
        const h = document.createElement('h4');
        h.innerText = s.title;
        const g = document.createElement('span');
        g.className = 'story-genre';
        g.innerText = s.genre;
        const t = document.createElement('div');
        t.className = 'story-tags';
        t.innerText = s.tags;
        const castRow = document.createElement('div');
        castRow.className = 'story-cast';
        s.cast.forEach(c => {
            const cc = document.createElement('div');
            cc.className = 'story-cast-item';
            const ci = document.createElement('img');
            ci.src = c.url;
            ci.title = c.name;
            ci.onerror = () => { ci.style.display = 'none'; };
            cc.appendChild(ci);
            const cn = document.createElement('span');
            cn.innerText = c.name;
            cc.appendChild(cn);
            castRow.appendChild(cc);
        });
        const btnRow = document.createElement('div');
        btnRow.className = 'story-action-row';
        const hasProg = localStorage.getItem('senka_story_progress_' + s.key) === '1';
        const main = document.createElement('button');
        main.className = 'modal-btn';
        if (hasProg) {
            main.innerText = 'Lanjut Cerita';
            main.onclick = () => startStory(s.key, { resume: true });
            const restart = document.createElement('button');
            restart.className = 'modal-btn ghost small';
            restart.innerText = 'Ulangi dari Awal';
            restart.onclick = () => startStory(s.key, { reset: true });
            btnRow.appendChild(main);
            btnRow.appendChild(restart);
        } else {
            main.innerText = 'Mulai Cerita';
            main.onclick = () => startStory(s.key);
            btnRow.appendChild(main);
        }
        info.appendChild(h);
        info.appendChild(g);
        info.appendChild(t);
        info.appendChild(castRow);
        info.appendChild(btnRow);
        card.appendChild(img);
        card.appendChild(info);
        grid.appendChild(card);
    });
}

function setModeBadge() {
    const badge = document.getElementById('mode-badge');
    const continueBtn = document.getElementById('continue-btn');
    if (storyMode === 'normal') {
        if (badge) badge.style.display = 'none';
        if (continueBtn) continueBtn.style.display = 'none';
        return;
    }
    if (badge) badge.style.display = 'inline-block';
    if (continueBtn) continueBtn.style.display = '';
    badge.innerText = storyMode === 'story' ? 'Cerita Bebas' : 'Cerita: ' + (activeStory ? activeStory.title.split('|')[0].trim() : 'All');
}

function startStory(key, opts) {
    const s = STORIES.find(x => x.key === key);
    if (!s) return;
    const resume = !!(opts && opts.resume);
    const reset = !!(opts && opts.reset);
    closeStoryModal();
    let fresh = false;
    if (reset) newSession();
    if (!resume || memoryList.length === 0) {
        fresh = true;
        if (!reset) newSession();
        const first = { role: 'assistant', content: [{ type: "text", text: s.firstMessage }] };
        memoryList.push(first);
        renderChat();
        if (supabaseEnabled) remoteSave('senka', 'text', s.firstMessage, first);
        else saveSessions();

        if (s.autoUser && s.autoReply) {
            const usr = { role: 'user', content: [{ type: "text", text: s.autoUser }] };
            memoryList.push(usr);
            const ai = { role: 'assistant', content: [{ type: "text", text: s.autoReply }] };
            memoryList.push(ai);
            renderChat();
            if (supabaseEnabled) {
                remoteSave('user', 'text', s.autoUser, usr);
                remoteSave('senka', 'text', s.autoReply, ai);
            } else saveSessions();
        }
    }
    storyMode = 'storyall';
    activeStory = s;
    localStorage.setItem('senka_story', key);
    localStorage.setItem('senka_story_progress_' + key, '1');
    setModeBadge();
    scrollToBottom(true);
    if (autospeak && fresh) speak(s.autoReply || s.firstMessage);
}

function startFreeform() {
    closeStoryModal();
    storyMode = 'story';
    activeStory = null;
    localStorage.removeItem('senka_story');
    setModeBadge();
    const note = { role: 'assistant', content: [{ type: "text", text: `Mode Cerita Bebas aktif, ${panggilan}~ Ceritakan skenario yang kamu mau dan aku akan memainkannya sepenuhnya.` }] };
    memoryList.push(note);
    if (supabaseEnabled) remoteSave('senka', 'text', note.content[0].text, note);
    else saveSessions();
    renderChat();
    scrollToBottom(true);
}

function backToNormal() {
    closeStoryModal();
    storyMode = 'normal';
    activeStory = null;
    storyUnlocked = false;
    localStorage.removeItem('senka_story');
    setModeBadge();
    if (memoryList.length) renderChat();
}

function personaPayload() {
    try {
        const p = JSON.parse(localStorage.getItem('senka_persona') || '{}');
        const name = (p.name || '').trim();
        const desc = (p.desc || '').trim();
        if (!name && !desc) return '';
        return 'Nama: ' + (name || 'User') + (desc ? '. Deskripsi: ' + desc : '');
    } catch (e) { return ''; }
}

function personaGender() {
    try {
        const p = JSON.parse(localStorage.getItem('senka_persona') || '{}');
        return p.gender || userGender;
    } catch (e) { return userGender; }
}

function lengthSetting() {
    return localStorage.getItem('senka_length') || '';
}

function lastAssistantIdx() {
    for (let i = memoryList.length - 1; i >= 0; i--) {
        if (memoryList[i].role === 'assistant') return i;
    }
    return -1;
}

function editAiMessage(bubble, item) {
    const textParts = (item.content || []).filter(c => c.type === 'text');
    if (!textParts.length || extractSticker(textParts[0].text)) return;
    const cur = textParts[0].text;
    bubble.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'edit-box';
    const ta = document.createElement('textarea');
    ta.className = 'edit-textarea';
    ta.value = cur;
    const row = document.createElement('div');
    row.className = 'edit-actions';
    const save = document.createElement('button');
    save.className = 'modal-btn';
    save.innerText = 'Simpan';
    const cancel = document.createElement('button');
    cancel.className = 'modal-btn ghost';
    cancel.innerText = 'Batal';
    save.onclick = () => {
        const nt = ta.value.trim();
        if (!nt) return;
        item.content = [{ type: 'text', text: nt }];
        renderChat();
        if (!supabaseEnabled) saveSessions();
        if (autospeak) speak(nt);
    };
    cancel.onclick = () => renderChat();
    row.appendChild(save);
    row.appendChild(cancel);
    box.appendChild(ta);
    box.appendChild(row);
    bubble.appendChild(box);
    ta.focus();
}

// ===== Terjemahan otomatis mode telfon (bila teks Senka ada huruf Jepang) =====
const msgTlCache = new Map();

function hasJapaneseText(text) {
    return /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
}

function attachCallTranslation(bubble, text) {
    if (!bubble || !text || !hasJapaneseText(text)) return;
    const div = document.createElement('div');
    div.className = 'call-tl';
    const lbl = document.createElement('span');
    lbl.className = 'call-tl-label';
    lbl.innerHTML = '<i class="fa-solid fa-language"></i> Terjemahan: ';
    const body = document.createElement('span');
    body.className = 'call-tl-body';
    body.textContent = 'menerjemahkan...';
    div.appendChild(lbl);
    div.appendChild(body);
    bubble.appendChild(div);
    const done = (t) => { body.textContent = t; };
    if (msgTlCache.has(text)) { done(msgTlCache.get(text)); return; }
    fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    })
        .then(r => r.json().catch(() => ({})))
        .then(d => {
            if (!d || !d.translated) throw new Error('gagal');
            msgTlCache.set(text, d.translated);
            done(d.translated);
        })
        .catch(() => { body.textContent = 'Terjemahan gagal. Coba lagi ya.'; });
}

function attachAiActions(bubble, item, isLast) {
    if (storyMode === 'normal') return;
    const row = document.createElement('div');
    row.className = 'msg-actions';
    if (isLast) {
        const swipe = document.createElement('button');
        swipe.className = 'msg-action';
        swipe.title = 'Ganti jawaban';
        swipe.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
        swipe.onclick = regenerateLast;
        row.appendChild(swipe);
    }
    const ed = document.createElement('button');
    ed.className = 'msg-action';
    ed.title = 'Edit pesan';
    ed.innerHTML = '<i class="fa-solid fa-pen"></i>';
    ed.onclick = () => editAiMessage(bubble, item);
    row.appendChild(ed);
    bubble.appendChild(row);
}

async function regenerateLast() {
    if (isStreaming) return;
    const idx = lastAssistantIdx();
    if (idx === -1) return;
    const item = memoryList[idx];
    memoryList.splice(idx, 1);
    if (item.cid) {
        authHeaders().then(h => fetch('/api/chats/' + item.cid, { method: 'DELETE', headers: h }).catch(() => { }));
    }
    const bubbles = chatHistoryDOM.querySelectorAll('.message.msg-senka');
    if (bubbles.length) bubbles[bubbles.length - 1].remove();
    if (!supabaseEnabled) saveSessions();
    scrollToBottom(true);
    await streamAssistantReply([...memoryList]);
}

function formatReply(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/([0-9])[\uFE0F\u20D0-\u20FF]+\s*/g, '$1. ');
    return s.split('\n').map(formatLine).join('\n').replace(/\{\{pos\}\}|\{\{neg\}\}|\{\{\/pos\}\}|\{\{\/neg\}\}/g, '');
}

function getGreeting() {
    const now = new Date();
    const t = now.getHours() + now.getMinutes() / 60;
    const P = panggilan;
    if (t >= 0 && t < 4) return `Selamat pagi ${P}! Senka Online`;
    if (t >= 4 && t <= 6) return `Bangun dan waktunya bersinar ${P}! Senka Online`;
    if (t > 6 && t <= 10) return `Selamat pagi ${P}! Senka disini`;
    if (t > 10 && t <= 11) return `Selamat siang ${P}! Senka Online`;
    if (t > 11 && t <= 13) return `Selamat istirahat siang ${P}! Senka disini`;
    if (t > 13 && t < 15) return `Selamat siang semangat hari ini ${P}! Senka disini`;
    if (t >= 15 && t <= 18) return `Selamat sore ${P}! Senka Online`;
    if (t > 18 && t <= 22) return `Selamat malam ${P}! Senka Online`;
    if (t > 22 && t <= 22.99) return `Selamat beristirahat ${P}! Senka disini`;
    return `Belom tidur ${P}! Si Kelelawar, Senka disini`;
}

function addMsgActions(bubble, role) {
    // Aksi per-bubble (Salin/Putar) dihapus dari UI sesuai permintaan.
    // TTS kini hanya lewat toggle autospeak di Pengaturan.
    return;
}

let senkaAudio = null;
function stopSenkaAudio() { if (senkaAudio) { try { senkaAudio.pause(); } catch (e) { } senkaAudio = null; } }

function playSpeechBlob(b64, type) {
    return new Promise((resolve, reject) => {
        const blob = base64ToBlob(b64, type || 'audio/mpeg');
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        senkaAudio = audio;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('audio rusak')); };
        audio.play().catch(() => { URL.revokeObjectURL(url); reject(new Error('play gagal')); });
    });
}

async function ttsStreamTo(onSegment, body) {
    const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body)
    });
    if (!r.ok) return { error: true };
    if (!(r.headers.get('content-type') || '').includes('text/event-stream')) {
        const d = await r.json();
        if (!d.segments || d.segments.length === 0) return { error: true };
        for (const seg of d.segments) {
            await onSegment(seg.audioBase64, d.contentType || 'audio/mpeg');
        }
        return { error: false };
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingEvent = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (line.startsWith('event:')) { pendingEvent = line.slice(6).trim(); continue; }
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (pendingEvent === 'segment') {
                pendingEvent = '';
                try {
                    const seg = JSON.parse(payload);
                    await onSegment(seg.audioBase64, seg.contentType || 'audio/mpeg');
                } catch (e) { }
                continue;
            }
            if (pendingEvent === 'error') { pendingEvent = ''; return { error: true }; }
            pendingEvent = '';
        }
    }
    return { error: false };
}

async function speak(text) {
    if (senkaAudio) stopSenkaAudio();
    try {
        await ttsStreamTo((b64, type) => playSpeechBlob(b64, type), { text, mode: speakMode });
    } catch (e) {
        // teks tetap tampil di chat; suara hanyalah bonus
    }
}

async function getMicStatus() {
    if (!navigator.permissions || !navigator.permissions.query) return 'prompt';
    try {
        const st = await navigator.permissions.query({ name: 'microphone' });
        if (st.state === 'granted') return 'granted';
        if (st.state === 'denied') return 'denied';
        return 'prompt';
    } catch (e) {
        return 'prompt';
    }
}

function openMicModal() {
    const name = document.getElementById('mic-modal-name');
    if (name) name.innerText = panggilan;
    document.getElementById('mic-permission-modal').style.display = 'flex';
}

function closeMicModal() {
    document.getElementById('mic-permission-modal').style.display = 'none';
}

async function allowMicFromModal() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        closeMicModal();
        if (pendingMicAction === 'call') { startCall(); return; }
        startVoiceInput();
    } catch (e) {
        closeMicModal();
        showToast('Akses mic ditolak, kamu masih bisa chat text seperti biasa');
    }
}

function startVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recognition.stop(); return; }
    if (!recognition) {
        recognition = new SR();
        recognition.lang = 'id-ID';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (e) => {
            let interim = '';
            let final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) final += t;
                else interim += t;
            }
            if (final) {
                messageInput.value = (messageInput.value ? messageInput.value + ' ' : '') + final;
            } else if (interim) {
                messageInput.value = (messageInput.value ? messageInput.value + ' ' : '') + interim;
            }
        };
        recognition.onend = () => setMic(false);
        recognition.onerror = () => setMic(false);
    }
    try {
        recognition.start();
        setMic(true);
    } catch (e) { }
}

let toastTimer = null;
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function toggleVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        appendMessage('senka', 'Browser kamu tidak mendukung voice input. Coba Chrome di HP atau laptop.');
        scrollToBottom(true);
        return;
    }
    if (listening) { recognition.stop(); return; }
    getMicStatus().then(status => {
        if (status === 'prompt') {
            openMicModal();
            return;
        }
        if (status === 'denied') {
            showToast('Akses mic ditolak, kamu masih bisa chat text seperti biasa');
            return;
        }
        startVoiceInput();
    });
}

/* ===== Sleep Call Mode ===== */
let callActive = false;
let callSpeaking = false;
let callAudio = null;
let callRecog = null;
let pendingMicAction = null;
let callCtx = null;
let callMicMuted = false;
let callSpeakerOn = false;
let callMinimized = false;
let callConnectedAt = 0;
let callTimerInt = null;
const CALL_PROFILE_IMG = 'assets/profiletelfonsenka.webp';
const CALL_WALLPAPER_IMG = 'assets/wallpapertelfonsenka.webp';

function formatCallDur(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
}

function updateCallTimer() {
    if (!callActive || !callConnectedAt) return;
    const str = formatCallDur(Date.now() - callConnectedAt);
    const t = document.getElementById('call-timer');
    if (t) t.innerText = str;
    const p = document.getElementById('call-pill-timer');
    if (p) p.innerText = str;
}

function startCallTimer() {
    if (callConnectedAt || !callActive) return;
    callConnectedAt = Date.now();
    updateCallTimer();
    clearInterval(callTimerInt);
    callTimerInt = setInterval(updateCallTimer, 1000);
}

function stopCallTimer() {
    clearInterval(callTimerInt);
    callTimerInt = null;
    callConnectedAt = 0;
}

function minimizeCall() {
    if (!callActive) return;
    callMinimized = true;
    const screen = document.getElementById('call-screen');
    const pill = document.getElementById('call-pill');
    if (screen) screen.style.display = 'none';
    if (pill) pill.style.display = 'flex';
    updateCallTimer();
}

function restoreCall() {
    callMinimized = false;
    const screen = document.getElementById('call-screen');
    const pill = document.getElementById('call-pill');
    if (screen) screen.style.display = 'flex';
    if (pill) pill.style.display = 'none';
    updateCallTimer();
}

function unlockAudio() {
    try {
        if (!callCtx) callCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (callCtx.state === 'suspended') callCtx.resume();
    } catch (e) { }
}

function initCallScreenAssets() {
    const bg = document.getElementById('call-bg');
    if (bg) {
        const probe = new Image();
        probe.onload = () => { bg.style.backgroundImage = "url('" + CALL_WALLPAPER_IMG + "')"; };
        probe.onerror = () => { bg.style.backgroundImage = "url('assets/wallpaper.webp')"; };
        probe.src = CALL_WALLPAPER_IMG;
    }
    const img = document.getElementById('call-profile-img');
    const pillImg = document.getElementById('call-pill-img');
    if (img || pillImg) {
        const probe = new Image();
        probe.onload = () => {
            if (img) img.src = CALL_PROFILE_IMG;
            if (pillImg) pillImg.src = CALL_PROFILE_IMG;
        };
        probe.onerror = () => {
            if (img) img.src = 'assets/avatar.webp';
            if (pillImg) pillImg.src = 'assets/avatar.webp';
        };
        probe.src = CALL_PROFILE_IMG;
    }
}

function setCallUI(on, label) {
    const btn = document.getElementById('call-btn');
    const screen = document.getElementById('call-screen');
    const stateText = document.getElementById('call-state-text');
    if (btn) {
        btn.classList.toggle('active', on);
        btn.innerHTML = on ? '<i class="fa-solid fa-phone-flip"></i>' : '<i class="fa-solid fa-phone"></i>';
    }
    if (!screen) return;
    screen.style.display = (on && !callMinimized) ? 'flex' : 'none';
    screen.classList.toggle('ringing', on && /(Memanggil|Menghubungi)/i.test(label || ''));
    if (stateText) {
        stateText.innerText = label || (on ? 'Memanggil' : '');
        stateText.classList.toggle('ringing', /(Memanggil|Menghubungi)/i.test(label || ''));
    }
}

function toggleCallMute() {
    callMicMuted = !callMicMuted;
    const btn = document.getElementById('call-mute-btn');
    if (btn) {
        btn.classList.toggle('on', callMicMuted);
        btn.title = callMicMuted ? 'Aktifkan mikrofon' : 'Senyapkan mikrofon';
        btn.innerHTML = callMicMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
    }
    if (callMicMuted) {
        if (callRecog) { try { callRecog.stop(); } catch (e) { } }
    } else {
        startCallRecognition();
    }
}

function toggleCallSpeaker() {
    callSpeakerOn = !callSpeakerOn;
    const btn = document.getElementById('call-speaker-btn');
    if (btn) {
        btn.classList.toggle('on', callSpeakerOn);
        btn.title = callSpeakerOn ? 'Matikan speaker' : 'Aktifkan speaker';
        btn.innerHTML = callSpeakerOn ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-off"></i>';
    }
    if (callAudio) callAudio.muted = callSpeakerOn;
}

async function toggleCall() {
    if (callActive) { endCall(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        appendMessage('senka', 'Browser kamu belum mendukung panggilan suara. Coba pakai Chrome ya.');
        scrollToBottom(true);
        return;
    }
    if (!modelKey) {
        openSettings();
        appendMessage('senka', `Pilih dulu model AI-nya ya ${panggilan}, baru bisa mulai panggilan.`);
        scrollToBottom(true);
        return;
    }
    const status = await getMicStatus();
    if (status === 'denied') {
        showToast('Akses mic ditolak, izinkan mic di pengaturan browser dulu ya');
        return;
    }
    if (status === 'prompt') { pendingMicAction = 'call'; openMicModal(); return; }
    startCall();
}

function startCall() {
    pendingMicAction = null;
    callActive = true;
    callMicMuted = false;
    callSpeakerOn = false;
    callMinimized = false;
    stopCallTimer();
    const pill = document.getElementById('call-pill');
    if (pill) pill.style.display = 'none';
    const sBtn = document.getElementById('call-speaker-btn');
    if (sBtn) {
        sBtn.classList.remove('on');
        sBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
    const mBtn = document.getElementById('call-mute-btn');
    if (mBtn) {
        mBtn.classList.remove('on');
        mBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    }
    unlockAudio();
    initCallScreenAssets();
    setCallUI(true, 'Memanggil');
    appendMessage('senka', '📞 Panggilan dimulai — ngomong aja, aku dengerin.');
    scrollToBottom(true);
    startCallRecognition();
}

function startCallRecognition() {
    if (!callActive || callSpeaking) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setCallUI(true, 'Mendengarkan...');
    startCallTimer();
    if (!callRecog) {
        callRecog = new SR();
        callRecog.lang = 'id-ID';
        callRecog.interimResults = false;
        callRecog.maxAlternatives = 1;
        callRecog.onresult = (e) => {
            let final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) final += e.results[i][0].transcript;
            }
            if (final.trim()) handleCallSpeech(final.trim());
        };
        callRecog.onerror = (e) => {
            if (!callActive) return;
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                endCall();
                showToast('Mic tidak diizinkan, panggilan diakhiri');
                return;
            }
        };
        callRecog.onend = () => {
            if (callActive && !callSpeaking) setTimeout(startCallRecognition, 350);
        };
    }
    try { callRecog.start(); } catch (e) { }
}

function handleCallSpeech(text) {
    if (!callActive) return;
    setCallUI(true, 'Senka mikir...');
    const bubble = appendMessage('user', text);
    memoryList.push({ role: 'user', content: [{ type: 'text', text }] });
    const userItem = memoryList[memoryList.length - 1];
    if (!supabaseEnabled) saveSessions();
    else remoteSave('user', 'text', text, userItem);
    scrollToBottom(true);
    sendCallMessage(text, bubble);
}

async function sendCallMessage(text) {
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [...memoryList], modelKey, panggilan, call: true, gender: userGender })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const raw = data.choices?.[0]?.message?.content || '';
        const clean = cleanCallText(raw);
        if (!clean) { afterCallSpeech(); return; }
        const sb = appendMessage('senka', clean);
        memoryList.push({ role: 'assistant', content: [{ type: 'text', text: clean }] });
        const aiItem = memoryList[memoryList.length - 1];
        if (!supabaseEnabled) saveSessions();
        else remoteSave('senka', 'text', clean, aiItem);
        scrollToBottom(true);
        await speakCallText(clean);
    } catch (e) {
        appendMessage('senka', `Waduh error: ${String(e.message || e).replace(/</g, '&lt;')}`);
        scrollToBottom(true);
        afterCallSpeech();
    }
}

function cleanCallText(raw) {
    return String(raw || '')
        .replace(STICKER_TAG_RE, '')
        .replace(STICKER_URL_RE, '')
        .replace(/\[ STIKER SENKA \]\s*/g, '')
        .replace(/###SENKA_FILE###[\s\S]*?###END###/g, '')
        .replace(/\*+[^*]*\*+/g, '')
        .replace(/^Senka\s*:\s*/i, '')
        .replace(/["“”]/g, '')
        .trim();
}

async function speakCallText(text) {
    callSpeaking = true;
    setCallUI(true, 'Senka bicara...');
    try {
        const result = await ttsStreamTo(async (b64, type) => {
            if (!callActive) return;
            const blob = base64ToBlob(b64, type || 'audio/mpeg');
            await playCallBlob(blob);
        }, { text, mode: speakMode });
        if (result.error) throw new Error('TTS gagal');
    } catch (e) {
        showToast(`Suara Senka gagal diputar: ${String(e.message || e).slice(0, 40)} — teksnya udah tampil di chat`);
    } finally {
        callSpeaking = false;
        if (callActive) setTimeout(startCallRecognition, 400);
    }
}

function afterCallSpeech() {
    callSpeaking = false;
    if (callActive) setTimeout(startCallRecognition, 400);
}

function playCallBlob(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        callAudio = audio;
        if (callSpeakerOn) audio.muted = true;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('audio rusak')); };
        audio.play().catch(err => {
            unlockAudio();
            audio.play().catch(e2 => { URL.revokeObjectURL(url); reject(e2); });
        });
    });
}

function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}

function endCall() {
    callActive = false;
    callSpeaking = false;
    callMicMuted = false;
    callSpeakerOn = false;
    callMinimized = false;
    stopCallTimer();
    const pill = document.getElementById('call-pill');
    if (pill) pill.style.display = 'none';
    if (callRecog) { try { callRecog.stop(); } catch (e) { } }
    if (callAudio) {
        try { callAudio.pause(); callAudio.src = ''; } catch (e) { }
        callAudio = null;
    }
    setCallUI(false);
    appendMessage('senka', '📞 Panggilan diakhiri — kabari lagi kalau mau ngobrol ya.');
    scrollToBottom(true);
}

function setMic(on) {
    listening = on;
    const item = document.getElementById('pm-mic');
    if (!item) return;
    item.classList.toggle('mic-live', on);
    item.innerHTML = on
        ? '<i class="fa-solid fa-microphone-lines"></i> Berhenti bicara'
        : '<i class="fa-solid fa-microphone"></i> Bicara';
    if (on) closePlusMenu();
}

function togglePlusMenu() {
    const menu = document.getElementById('plus-menu');
    const btn = document.getElementById('plus-btn');
    const show = !menu.classList.contains('show');
    menu.classList.toggle('show', show);
    btn.classList.toggle('open', show);
}
function closePlusMenu() {
    document.getElementById('plus-menu').classList.remove('show');
    document.getElementById('plus-btn').classList.remove('open');
}
document.addEventListener('click', e => {
    if (!e.target.closest('.plus-wrap')) closePlusMenu();
});

function openVideoModal() {
    document.getElementById('video-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('video-prompt').focus(), 100);
}
function closeVideoModal() { document.getElementById('video-modal').style.display = 'none'; }

function generateVideo() {
    const prompt = document.getElementById('video-prompt').value.trim();
    if (!prompt) { document.getElementById('video-prompt').focus(); return; }
    closeVideoModal();
    document.getElementById('video-prompt').value = '';
    generateVideoWithPrompt(prompt);
}

async function generateVideoWithPrompt(prompt) {
    appendMessage('user', prompt);
    const loading = appendMessage('senka', '');
    loading.innerHTML = 'Senka lagi bikin videomu<span class="tind"><i></i><i></i><i></i></span>';
    scrollToBottom(true);
    try {
        const resp = await fetch('/api/video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `API error (${resp.status})`);
        if (!data.statusUrl) throw new Error('Server tidak kasih status URL.');
        for (let i = 0; i < 45; i++) {
            await new Promise(r => setTimeout(r, 8000));
            const sr = await fetch('/api/video/status?url=' + encodeURIComponent(data.statusUrl), { headers: await authHeaders() });
            const sd = await sr.json().catch(() => ({}));
            if (sd.status === 'COMPLETED' && sd.videoUrl) {
                loading.innerHTML = '';
                const tag = document.createElement('div');
                tag.className = 'msg-tag';
                tag.innerText = 'Video AI';
                loading.appendChild(tag);
                const v = document.createElement('video');
                v.src = sd.videoUrl;
                v.controls = true;
                v.preload = 'metadata';
                v.classList.add('chat-video');
                loading.appendChild(v);
                const actions = document.createElement('div');
                actions.className = 'msg-actions';
                const dl = document.createElement('button');
                dl.className = 'msg-action';
                dl.title = 'Download video';
                dl.innerHTML = '<i class="fa-solid fa-download"></i>';
                dl.onclick = () => downloadImage(sd.videoUrl, 'senka-video-' + Date.now() + '.mp4');
                actions.appendChild(dl);
                loading.appendChild(actions);
                remoteSave('senka', 'video', sd.videoUrl);
                scrollToBottom(true);
                return;
            }
            if (sd.status !== 'IN_QUEUE' && sd.status !== 'IN_PROGRESS' && sd.status !== 'PENDING') {
                throw new Error(sd.error || 'Gagal render video.');
            }
        }
        throw new Error('Waktu render habis. Coba lagi ya.');
    } catch (e) {
        loading.innerText = 'Gagal: ' + e.message;
        scrollToBottom(true);
    }
}

const SEARCH_RE = /(^|[\s,.?!])(siapa|siapakah|kapan|dimana|di\s+mana|berapa|kenapa|mengapa|bagaimana|apakah|kepanjangan|definisi|arti|sejarah|perbedaan|info\s+tentang|berita\s+tentang|tentang|jelaskan|cari|search)\b/i;

async function getWebContext(text) {
    if (!text || text.length < 20 || !SEARCH_RE.test(text)) return null;
    try {
        const r = await fetch('/api/search?q=' + encodeURIComponent(text.slice(0, 120)));
        const d = await r.json().catch(() => ({}));
        const res = (d.results || []).slice(0, 5);
        if (!res.length) return null;
        let ctx = 'Hasil pencarian web (pakai ini biar jawabanmu benar, jangan mengarang. Kalau perlu sebut sumbernya singkat):\n';
        res.forEach((x, i) => {
            ctx += `${i + 1}. ${x.title || 'Tanpa judul'} — ${(x.snippet || '').slice(0, 300)} (${x.url})\n`;
        });
        return ctx;
    } catch (e) {
        return null;
    }
}

function parseReminder(text) {
    const low = text.toLowerCase();
    if (!/(ingetin|ingatkan|reminder|pengingat)/.test(low)) return null;
    let what = text.replace(/(ingetin|ingatkan|reminder|pengingat)/gi, '').replace(/\b(saya|aku|gue|gw|aku ya)\b/gi, '');
    let fireAt = null;
    const jamM = low.match(/jam\s+(\d{1,2})(?:[.:](\d{2}))?/);
    if (jamM) {
        const h = parseInt(jamM[1], 10) % 24;
        const min = jamM[2] ? parseInt(jamM[2], 10) % 60 : 0;
        const t = new Date();
        t.setHours(h, min, 0, 0);
        if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
        fireAt = t;
        what = what.replace(/jam\s+\d{1,2}(?:[.:]\d{2})?/gi, '');
    } else {
        const durM = low.match(/(\d+)\s*(menit|detik)/);
        if (durM) {
            const n = parseInt(durM[1], 10);
            const unit = durM[2] === 'menit' ? 60000 : 1000;
            fireAt = new Date(Date.now() + n * unit);
            what = what.replace(/\d+\s*(menit|detik)/gi, '');
        }
    }
    what = what.replace(/^[\s,.:-]+/, '').replace(/[\s,.:-]+$/, '').trim();
    if (!what) what = 'sesuatu yang kamu minta diingatkan';
    return fireAt ? { fireAt, what } : null;
}

function scheduleReminder(text) {
    const r = parseReminder(text);
    if (!r) return false;
    const sessId = activeId;
    const delay = r.fireAt.getTime() - Date.now();
    const timeStr = r.fireAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    memoryList.push({ role: 'user', content: [{ type: 'text', text: text }] });
    const userItem = memoryList[memoryList.length - 1];
    if (!supabaseEnabled) saveSessions();
    else remoteSave('user', 'text', text, userItem);
    appendMessage('user', text);
    const confirmMsg = `Oke, saya ingatkan jam ${timeStr}: ${r.what}.`;
    const conf = appendMessage('senka', confirmMsg);
    addMsgActions(conf, 'senka');
    memoryList.push({ role: 'assistant', content: [{ type: 'text', text: confirmMsg }] });
    const confItem = memoryList[memoryList.length - 1];
    if (!supabaseEnabled) saveSessions();
    else remoteSave('senka', 'text', confirmMsg, confItem);
    scrollToBottom(true);

    if ('Notification' in window) {
        Notification.requestPermission();
    }

    setTimeout(() => {
        if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Senka', { body: 'Pengingat: ' + r.what }); } catch (e) { }
        }
        if (activeId === sessId) {
            const msg = `Pengingat: ${r.what}`;
            const b = appendMessage('senka', msg);
            addMsgActions(b, 'senka');
            memoryList.push({ role: 'assistant', content: [{ type: 'text', text: msg }] });
            const remItem = memoryList[memoryList.length - 1];
            if (!supabaseEnabled) saveSessions();
            else remoteSave('senka', 'text', msg, remItem);
            scrollToBottom(true);
        }
    }, delay);
    return true;
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

    if (scheduleReminder(text) && !base64Image) {
        messageInput.value = '';
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
    if (storyMode === 'storyall' && activeStory) {
        localStorage.setItem('senka_story_progress_' + activeStory.key, '1');
    }

    let userImgUrl = null;
    if (base64Image && supabaseEnabled) {
        try { userImgUrl = await uploadDataUrl(base64Image, 'jpg'); } catch (e) { userImgUrl = null; }
    }

    const userMessageContent = [];
    if (text) userMessageContent.push({ type: "text", text: text });
    if (base64Image) userMessageContent.push({ type: "image_url", image_url: { url: userImgUrl || base64Image } });

    const bubble = appendMessage('user', text || '');
    if (extractSticker(text)) {
        bubble.innerHTML = '';
        appendStickerImg(bubble, extractSticker(text));
    }
    if (base64Image) {
        const img = document.createElement('img');
        img.src = userImgUrl || base64Image;
        img.classList.add('chat-img');
        bubble.appendChild(img);
    }
    memoryList.push({ role: 'user', content: userMessageContent });
    const userItem = memoryList[memoryList.length - 1];
    if (!supabaseEnabled) saveSessions();
    else {
        remoteSave('user', 'text', text || '[foto]', userItem);
        if (userImgUrl) remoteSave('user', 'image', userImgUrl);
    }

    messageInput.value = '';
    removeImage();
    scrollToBottom(true);

    await streamAssistantReply(await getWebPayload(memoryList, text));
}

async function continueNarration() {
    if (isStreaming) return;
    if (!modelKey) {
        openSettings();
        appendMessage('senka', `Pilih dulu model AI-nya ya ${panggilan}, baru bisa lanjutin ceritanya.`);
        scrollToBottom(true);
        return;
    }
    const last = memoryList[memoryList.length - 1];
    if (!last || last.role !== 'assistant') {
        appendMessage('senka', 'Belum ada narasi yang bisa dilanjutkan, sayang.');
        scrollToBottom(true);
        return;
    }
    if (storyMode === 'storyall' && activeStory) {
        localStorage.setItem('senka_story_progress_' + activeStory.key, '1');
    }
    const trigger = {
        role: 'user',
        hidden: true,
        content: [{ type: "text", text: '[LANJUTKAN] Lanjutkan narasi/cerita dari titik terakhir tanpa menyapa user: teruskan alurnya, perpanjang dan dalami adegan serta suasananya, dan jangan mengulang kalimat sebelumnya.' }]
    };
    memoryList.push(trigger);
    await streamAssistantReply(await getWebPayload(memoryList, null));
}

async function getWebPayload(baseMessages, lastText) {
    if (!lastText) return baseMessages;
    const context = await getWebContext(lastText);
    return context ? [...baseMessages, { role: 'system', content: context }] : baseMessages;
}

async function streamAssistantReply(payloadMessages) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'msg-senka');
    msgDiv.innerHTML = 'Senka ngetik<span class="tind"><i></i><i></i><i></i></span>';
    chatHistoryDOM.appendChild(msgDiv);
    scrollToBottom(true);
    isStreaming = true;

    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: payloadMessages, modelKey, panggilan, useVision: visionAuto, gender: personaGender(), persona: personaPayload(), length: lengthSetting(), lorebook: getActiveLorebook(), mode: storyMode })
        });

        if (!response.ok) {
            let msg = `API error (${response.status})`;
            try { msg = (await response.json()).error || msg; } catch (e) { }
            throw new Error(msg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamBuf = '';
        let started = false;
        let streamError = null;
        let ragReplacement = null;
        let pendingEvent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('event:')) { pendingEvent = line.slice(6).trim(); continue; }
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (pendingEvent === 'rag_guard') {
                    pendingEvent = '';
                    try {
                        const g = JSON.parse(payload);
                        if (g && g.replacement) ragReplacement = g.replacement;
                    } catch (e) { }
                    continue;
                }
                pendingEvent = '';
                if (payload === '[DONE]') continue;
                try {
                    const j = JSON.parse(payload);
                    if (j.error) { streamError = j.error.message || 'upstream error'; continue; }
                    if (!j.choices) continue;
                    const delta = j.choices[0]?.delta?.content;
                    if (delta) {
                        if (!started) { streamBuf = ''; started = true; }
                        streamBuf += delta;
                        msgDiv.innerHTML = formatReply(streamBuf);
                        if (chatHistoryDOM.scrollHeight - chatHistoryDOM.scrollTop - chatHistoryDOM.clientHeight < 200) {
                            chatHistoryDOM.scrollTop = chatHistoryDOM.scrollHeight;
                        }
                    }
                } catch (e) { }
            }
        }

        if (streamError) throw new Error(streamError);
        if (!started) throw new Error('empty');
        if (ragReplacement !== null) streamBuf = ragReplacement;

        const fullReply = streamBuf;
        const stk = extractSticker(fullReply);
        const fileReq = parseFileRequest(fullReply);
        let displayText = fileReq ? fileReq.displayText.trim() : fullReply;
        if (!fileReq && displayText.includes('###SENKA_FILE###')) {
            displayText = displayText.split('###SENKA_FILE###')[0].trim();
        }
        const renderText = stk ? stripStickerTag(displayText) : displayText;

        msgDiv.innerHTML = formatReply(renderText);
        if (stk) appendStickerImg(msgDiv, stk);
        if (fileReq) msgDiv.appendChild(makeFileCard(fileReq.meta));
        if (!fileReq && displayText.trim()) attachCallTranslation(msgDiv, displayText.trim());
        addMsgActions(msgDiv, 'senka');

        memoryList.push({ role: 'assistant', content: [{ type: "text", text: displayText }] });
        const aiItem = memoryList[memoryList.length - 1];
        attachAiActions(msgDiv, aiItem, true);
        if (!supabaseEnabled) saveSessions();
        else remoteSave('senka', 'text', displayText, aiItem);
        shrinkMemoryImages();
        if (autospeak && !fileReq) speak(displayText);
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
    const idx = reply.indexOf('###SENKA_FILE###');
    if (idx === -1) return null;
    const block = reply.slice(idx + '###SENKA_FILE###'.length);
    const endIdx = block.indexOf('###END###');
    const body = (endIdx === -1 ? block : block.slice(0, endIdx));
    const typeM = body.match(/TYPE\s*:\s*([A-Za-z]+)/);
    const nameM = body.match(/NAME\s*:\s*([^\r\n]+)/);
    const contentM = body.match(/CONTENT\s*:\s*([\s\S]*)/);
    if (!typeM || !nameM || !contentM) return null;
    const content = contentM[1].trim();
    if (!content) return null;
    const displayText = reply.slice(0, idx);
    return { meta: { type: typeM[1].toLowerCase(), name: nameM[1].trim(), content }, displayText };
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
            let imgSrc = data.url;
            const finishImage = () => {
                const img = document.createElement('img');
                img.src = imgSrc;
                img.classList.add('chat-img');
                img.alt = prompt;
                img.onerror = () => { loading.innerText = 'Gagal memuat gambar. Coba lagi.'; };
                loading.appendChild(img);
                const actions = document.createElement('div');
                actions.className = 'msg-actions';
                const dl = document.createElement('button');
                dl.className = 'msg-action';
                dl.title = 'Download gambar';
                dl.innerHTML = '<i class="fa-solid fa-download"></i>';
                dl.onclick = () => downloadImage(imgSrc, 'senka-' + prompt.slice(0, 25).replace(/[^a-zA-Z0-9]+/g, '_') + '.jpg');
                actions.appendChild(dl);
                loading.appendChild(actions);
                scrollToBottom(true);
            };
            if (supabaseEnabled && typeof data.url === 'string' && data.url.startsWith('data:')) {
                uploadDataUrl(data.url, 'png')
                    .then(u => { imgSrc = u; remoteSave('senka', 'image', u); finishImage(); })
                    .catch(() => finishImage());
            } else {
                if (supabaseEnabled && typeof data.url === 'string') remoteSave('senka', 'image', data.url);
                finishImage();
            }
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
document.getElementById('search-input').addEventListener('input', doSearch);

function initSakura() {
    const canvas = document.getElementById('sakura-canvas');
    const ctx = canvas.getContext('2d');
    let petals = [];
    let w, h, dpr;
    let sakuraRAF = null;
    window.sakuraRunning = localStorage.getItem('senka_sakura') !== 'off';
    canvas.style.display = window.sakuraRunning ? 'block' : 'none';
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
        const g = p.grad || (p.grad = ctx.createLinearGradient(0, -s * 1.1, 0, s * 0.3));
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
        if (!window.sakuraRunning) return;
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
        sakuraRAF = requestAnimationFrame(tick);
    }

    window.setSakura = function (on) {
        window.sakuraRunning = !!on;
        localStorage.setItem('senka_sakura', window.sakuraRunning ? 'on' : 'off');
        canvas.style.display = window.sakuraRunning ? 'block' : 'none';
        if (window.sakuraRunning && !sakuraRAF) {
            last = performance.now();
            sakuraRAF = requestAnimationFrame(tick);
        }
    };

    window.addEventListener('resize', resize);
    resize();
    if (window.sakuraRunning) sakuraRAF = requestAnimationFrame(tick);
}
