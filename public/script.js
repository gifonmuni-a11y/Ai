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
    initBgBrightness();
    initCallPillDrag();
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

    if (!userProfile.memberSince) {
        userProfile.memberSince = new Date().toISOString();
        saveProfileState();
    }
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
    if (!userProfile.memberSince) {
        userProfile.memberSince = user.created_at || new Date().toISOString();
        saveProfileState();
    }
    if (cloudTipe === 'google') {
        const pic = user.user_metadata?.avatar_url || user.user_metadata?.picture || user.user_metadata?.avatar;
        if (pic) setDefaultAvatarForLogin(pic, 'google');
        else setDefaultAvatarForLogin(DEFAULT_GUEST_AVATAR, 'google');
    } else {
        setDefaultAvatarForLogin(DEFAULT_GUEST_AVATAR, 'guest');
    }
    await syncProfileFromCloud();
    await pushProfileToCloud();
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
    const ts = m.waktu_kirim ? new Date(m.waktu_kirim).getTime() : undefined;
    return { role: m.pengirim === 'user' ? 'user' : 'assistant', cid: m.id, content, ts, time: ts ? formatMsgTime(ts) : undefined };
}

function remoteSave(pengirim, tipePesan, isi, memItem) {
    if (!supabaseEnabled) return;
    authHeaders().then(headers => {
        const sessionNama = cloudSessions.find(s => s.id === cloudSid)?.nama || 'Pengguna';
        fetch('/api/chats', {
            method: 'POST',
            headers,
            body: JSON.stringify({ sesiId: cloudSid, tipePesan, isiPesan: encryptText(isi), pengirim, nama: sessionNama })
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
            const gTs = Date.now();
            const item = { role: 'assistant', content: [{ type: 'text', text: greeting }], ts: gTs, time: formatMsgTime(gTs) };
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
    backfillMessageTimes(memoryList);
    saveSessions();
}

function backfillMessageTimes(list) {
    if (!Array.isArray(list)) return;
    list.forEach((m, i) => {
        if (m && !m.ts) {
            const t = Date.now() - (list.length - i) * 60000;
            m.ts = t;
            m.time = formatMsgTime(t);
        }
    });
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
function openProfile(editable) {
    renderProfileModal();
    const modal = document.getElementById('profile-modal');
    modal.classList.toggle('readonly', editable !== true);
    modal.style.display = 'flex';
}
function closeProfile() { document.getElementById('profile-modal').style.display = 'none'; }

function openLogoModal() {
    const img = document.getElementById('logo-pop-img');
    img.onerror = () => { img.onerror = null; img.src = LOGO_ICON_URL; };
    img.src = LOGO_GIF_URL;
    document.getElementById('logo-modal').style.display = 'flex';
}
function closeLogoModal() { document.getElementById('logo-modal').style.display = 'none'; }

/* ===== Senka Profile (read-only) ===== */
function openSenkaProfile() {
    const banner = document.getElementById('senka-profile-banner');
    if (banner) banner.style.backgroundImage = 'url("' + SENKA_PROFILE_BANNER + '")';
    const av = document.getElementById('senka-profile-avatar-img');
    if (av) av.src = SENKA_BUBBLE_AVATAR;
    const deco = document.getElementById('senka-profile-avatar-deco');
    if (deco) deco.src = SENKA_BUBBLE_DECO;
    renderProfileEffect(getProfileEffect()?.id, document.querySelector('#senka-profile-modal .profile-effect-overlay'));
    document.getElementById('senka-profile-modal').style.display = 'flex';
}
function closeSenkaProfile() { document.getElementById('senka-profile-modal').style.display = 'none'; }

/* ===== Profile Effects ===== */
function getProfileEffect() {
    try { return JSON.parse(localStorage.getItem(PROFILE_EFFECT_KEY) || 'null'); } catch (e) { return null; }
}
function setProfileEffect(id, label) {
    localStorage.setItem(PROFILE_EFFECT_KEY, JSON.stringify({ id, label }));
}
function clearProfileEffect() {
    localStorage.removeItem(PROFILE_EFFECT_KEY);
}
let effectTransitionTimer = null;

function renderProfileEffect(effectId, overlay) {
    const effect = PROFILE_EFFECTS.find(e => e.id === effectId);
    if (!overlay) overlay = document.querySelector('.profile-effect-overlay');
    if (!overlay) return;

    // Reset overlay dan timer sebelumnya
    overlay.innerHTML = '';
    if (effectTransitionTimer) clearTimeout(effectTransitionTimer);

    if (!effect) return;

    // Gunakan murni tag <img> agar transparansi APNG optimal
    const img = document.createElement('img');
    img.className = 'profile-effect-img';
    img.alt = effect.label;

    // Putar Intro terlebih dahulu
    img.src = effect.intro;

    // Jika link rusak, otomatis hapus elemen (fallback)
    img.onerror = () => {
        console.warn(`[Profile Effects] Link rusak/tidak ditemukan, menghapus efek: ${effect.label}`);
        img.remove();
    };

    // Pindah ke Loop setelah 2.5 detik (rata-rata durasi intro)
    effectTransitionTimer = setTimeout(() => {
        img.src = effect.loop;
    }, 2500);

    overlay.appendChild(img);
}
function openEffectPicker() {
    const grid = document.getElementById('effect-grid');
    grid.innerHTML = '';
    const current = getProfileEffect();
    PROFILE_EFFECTS.forEach(e => {
        const item = document.createElement('div');
        item.className = 'effect-item' + (current && current.id === e.id ? ' selected' : '');
        const img = document.createElement('img');
        img.src = e.loop;
        img.alt = e.label;
        img.loading = 'lazy';
        img.onerror = () => { item.classList.add('broken'); };
        const lbl = document.createElement('span');
        lbl.className = 'deco-label';
        lbl.textContent = e.label;
        item.appendChild(img);
        item.appendChild(lbl);
        item.onclick = () => {
            setProfileEffect(e.id, e.label);
            closeEffectPicker();
            renderProfileModal();
            showToast('Efek profil "' + e.label + '" dipasang');
        };
        grid.appendChild(item);
    });
    document.getElementById('effect-modal').style.display = 'flex';
}
function closeEffectPicker() { document.getElementById('effect-modal').style.display = 'none'; }
function removeProfileEffect() {
    clearProfileEffect();
    closeEffectPicker();
    renderProfileModal();
    showToast('Efek profil dihapus');
}
function closeAllModals() {
    ['settings-modal', 'image-modal', 'video-modal', 'sessions-modal', 'search-modal', 'confirm-delete-modal', 'profile-modal', 'deco-modal', 'senka-profile-modal', 'effect-modal', 'command-menu-modal'].forEach(id => document.getElementById(id).style.display = 'none');
}
document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; }));

/* ===== USER PROFILE (Discord style) ===== */
const DEFAULT_BANNER = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Profiledefaultanonym/backgrounddefaultgoogledananon.jpg';
const DEFAULT_GUEST_AVATAR = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Profiledefaultanonym/profiledefaultanon.webp';
const LOGO_ICON_URL = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Favicon/logoicon.png';
const LOGO_GIF_URL = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Profile/Logoiconsenka/logoiconsenka-ezgif.com-optimize%20(1).gif';
const logoPreload = new Image(); logoPreload.src = LOGO_GIF_URL;
const AVATAR_DECORATIONS = [
    { id: '1352687418418921532', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_0c0eeb351ae2cf48c6e1eee2cae49d40.png?size=240&passthrough=true', label: 'Hugh the Rainbow', category: 'decorations' },
    { id: '1352687448228106302', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_0e839cd79500e7b68e2bbbed54790c28.png?size=240&passthrough=true', label: 'Phoenix', category: 'decorations' },
    { id: '1352687476317093888', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_0f4f1b40921ce680b60007e94427d1f2.png?size=160&passthrough=true', label: 'Firecrackers', category: 'decorations' },
    { id: '1352687565219692648', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_0f5d6c4dd8ae74662ee9c40722a56cbd.png?size=240&passthrough=true', label: 'Flaming Sword', category: 'decorations' },
    { id: '1352687609780113562', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_001e956faa73bd0410c455234c62818f.png?size=240&passthrough=true', label: 'RamenBowl', category: 'decorations' },
    { id: '1352687646475817051', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_1acbe609daec21fa5b866df9e5a42cb7.png?size=240&passthrough=true', label: 'Steampunk Cat Ears', category: 'decorations' },
    { id: '1352687706303500391', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_1b1df0ae8c2d34afd85da5c22a0d761a.png?size=240&passthrough=true', label: 'Lucky Envelopes', category: 'decorations' },
    { id: '1352687727283273788', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_1dbc603c181999b9815cb426dfec71a6.png?size=240&passthrough=true', label: 'Magical Potion', category: 'decorations' },
    { id: '1352687750910054440', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_1e8cb6070b13f775a41384c84c5a53e1.png?size=240&passthrough=true', label: 'Akuma', category: 'decorations' },
    { id: '1352687779103903754', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_2b95e7a4951a1a092e7870bf1d456262.png?size=240&passthrough=true', label: 'Next Turn Button', category: 'decorations' },
    { id: '1352687799467249694', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_2ca5fb1ecf0dac410b38d76cb4aae7f9.png?size=240&passthrough=true', label: 'Snowglobe', category: 'decorations' },
    { id: '1352687817125531759', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_2d792aad5003faf6809e26879a7eae6b.png?size=240&passthrough=true', label: "Feelin'Nervous", category: 'decorations' },
    { id: '1352687886021034025', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_2e55d644e11acb6253dfa422eff16dfd.png?size=240&passthrough=true', label: 'Lotus Flower', category: 'decorations' },
    { id: '1352687923060936756', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_3c97a2d37f433a7913a1c7b7a735d000.png?size=240&passthrough=true', label: 'Angry', category: 'decorations' },
    { id: '1352687950558920748', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_3c5743cedcb72131c58278278a97c143.png?size=240&passthrough=true', label: 'Owlbear Cub', category: 'decorations' },
    { id: '1352687975795920928', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_3d1e6078b2e4c8865e0ad0f429d651b1.png?size=240&passthrough=true', label: 'Straw Hat', category: 'decorations' },
    { id: '1352688006338842714', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_3e1fc3c7ee2e34e8176f4737427e8f4f.png?size=240&passthrough=true', label: 'Heartbloom', category: 'decorations' },
    { id: '1352688027096584397', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_3f29e6edfe1cff43736f644cf1d01278.png?size=240&passthrough=true', label: 'Candlelight', category: 'decorations' },
    { id: '1352688047501611089', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_4c9f2ec29c05755456dbce45d8190ed4.png?size=240&passthrough=true', label: 'Treasure and Key', category: 'decorations' },
    { id: '1352688136488222821', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_4cc97277177b166fd7d4af3bdb370815.png?size=240&passthrough=true', label: 'in Tears', category: 'decorations' },
    { id: '1352688164925341844', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_4cd9ae5a8d103c219eacd3674d7730cd.png?size=240&passthrough=true', label: 'Butterflies', category: 'decorations' },
    { id: '1352688185896992921', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_4f2b75e5adff09709702613ea0e2cb70.png?size=240&passthrough=true', label: 'Zombie Food', category: 'decorations' },
    { id: '1352688217828233266', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_5b1319abfc9f928479b68a73635f591d.png?size=240&passthrough=true', label: 'Bubble Tea', category: 'decorations' },
    { id: '1352688243153571911', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_5e8abacc7a7454d6b08b5cc84cac1d80.png?size=240&passthrough=true', label: 'Witch Hat (Plum)', category: 'decorations' },
    { id: '1352688272836657297', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_6b793a5f7e4e15eea6b10a4fde448511.png?size=240&passthrough=true', label: 'Shy', category: 'decorations' },
    { id: '1352688305011167307', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_6d16b27d9415cafe3b289053644337c4.png?size=240&passthrough=true', label: 'Black Hole', category: 'decorations' },
    { id: '1352688338082988064', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_6d99f670de3fcee669660fe262e896ea.png?size=240&passthrough=true', label: 'Mirage', category: 'decorations' },
    { id: '1352688400959799449', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_6fdbddb6229453eac3bbb212edf5cd1c.png?size=240&passthrough=true', label: 'UFO', category: 'decorations' },
    { id: '1352688431376891965', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_007d64a922ff5773fb9464945de93c8e.png?size=240&passthrough=true', label: 'aespa Fanlight', category: 'decorations' },
    { id: '1352688457037910088', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_7cf09c7e78d6eb35ae354acc1d5cc676.png?size=240&passthrough=true', label: 'Sakura Warrior', category: 'decorations' },
    { id: '1352688484300882133', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_7d305bca6cf371df98c059f9d2ef05e4.png?size=240&passthrough=true', label: 'Fox Hat', category: 'decorations' },
    { id: '1352688511169466368', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_7f44d538ec830f479605f7bf8720afda.png?size=240&passthrough=true', label: 'Lovestruck', category: 'decorations' },
    { id: '1352688535949541542', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_7f863078aee4932cd50ee4e3b55d3035.png?size=240&passthrough=true', label: 'Crossbones', category: 'decorations' },
    { id: '1352688607072223346', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8ad98d25ee4e4512704f759476eeb294.png?size=240&passthrough=true', label: 'Group Hug', category: 'decorations' },
    { id: '1352688633144147999', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8c17e799bfeffa797042569a1ebcafc0.png?size=240&passthrough=true', label: 'Pipedream', category: 'decorations' },
    { id: '1352688660683952178', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8dddba8c2a9704a943bb7020a3d0a418.png?size=240&passthrough=true', label: 'Hex Tiles', category: 'decorations' },
    { id: '1352688718753824790', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8ee8ae54bddfcb17d7d5c5f9bce41c0d.png?size=240&passthrough=true', label: 'Crystal Ball (Blue)', category: 'decorations' },
    { id: '1352688769211568149', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8ffa2ba9bff18e96b76c2e66fd0d7fa3.png?size=240&passthrough=true', label: 'In Love', category: 'decorations' },
    { id: '1352688796176613546', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_09bb4197c743ea31b7eb052eddd3e892.png?size=240&passthrough=true', label: 'Hex Lights', category: 'decorations' },
    { id: '1352688824165072956', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_09de63526a45be1ddac70e84718ee04a.png?size=240&passthrough=true', label: 'FRAG OUT', category: 'decorations' },
    { id: '1352688892385562714', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9a6bf0ab30a6719d6eb09fa4996984ca.png?size=240&passthrough=true', label: 'Solar Orbit', category: 'decorations' },
    { id: '1352688917081624607', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9bc421cef4bdcfffeb2344b44ad91b44.png?size=240&passthrough=true', label: 'The Monster You Created', category: 'decorations' },
    { id: '1352688939907027080', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9cc1c1426ea5478aac7be6cdefdbc568.png?size=240&passthrough=true', label: "Good Ol'Pepper", category: 'decorations' },
    { id: '1352689042474664017', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9d2ff9685be0c668ef6990b0035fac17.png?size=240&passthrough=true', label: 'Fan Flourish', category: 'decorations' },
    { id: '1352689087655579730', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9d67a1cbf81fe7197c871e94f619b04b.png?size=240&passthrough=true', label: 'Skull Medallion', category: 'decorations' },
    { id: '1352689118374793286', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9d95e36bc282523fddc63d31a8d01091.png?size=240&passthrough=true', label: 'Tarrain Tiles', category: 'decorations' },
    { id: '1352689152877002843', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9d35467f282b8c72a26f5aa40aa2a637.png?size=240&passthrough=true', label: "Feelin'Scrumptious", category: 'decorations' },
    { id: '1352689219063255172', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9e16d86b2887eb2a3bed36a5b8876935.png?size=240&passthrough=true', label: 'Red Lantern', category: 'decorations' },
    { id: '1352689708521623694', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_25f7407a6a0c5de43736a1f24c3b7979.png?size=160&passthrough=true', label: 'Mooncaps (Blue)', category: 'decorations' },
    { id: '1352689726620045322', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_27bbf0b53b1054cf61e9a4c0e8d4027f.png?size=240&passthrough=true', label: 'Honeyblossom', category: 'decorations' },
    { id: '1352689749915209910', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_28e531da18a80b8287837332154c5f58.png?size=160&passthrough=true', label: 'String Lights (Dusk)', category: 'decorations' },
    { id: '1352689842177179739', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_29a0533cb3de61aa8179810188f3830d.png?size=240&passthrough=true', label: 'Defensive Shield', category: 'decorations' },
    { id: '1352690651065614386', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_42cc3fe7133523096466102e7a222003.png?size=160&passthrough=true', label: 'Heartstrings (Blue)', category: 'decorations' },
    { id: '1352690708863123569', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_45f7f9975255971b197d34d77fb50ede.png?size=240&passthrough=true', label: 'Magical Girl', category: 'decorations' },
    { id: '1352690738680565934', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_47c0f4b4a837894998d5a316acf74f87.png?size=240&passthrough=true', label: 'Unicorn', category: 'decorations' },
    { id: '1352690760096419902', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_49c479e15533fb4c02eb320c9c137433.png?size=240&passthrough=true', label: 'Chromawave', category: 'decorations' },
    { id: '1352690799728529560', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_49ed38f73003e2e182f77190af0a0a56.png?size=240&passthrough=true', label: 'Rocket Puncher', category: 'decorations' },
    { id: '1352690823388725409', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_49ffdb1883d8c644a8eb68711ee58be9.png?size=240&passthrough=true', label: "Slither'n Snack", category: 'decorations' },
    { id: '1352690853906350131', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_50b440810b1bbd89f6284f36d40ad0af.png?size=240&passthrough=true', label: 'Koi Pond', category: 'decorations' },
    { id: '1352690918247108608', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_50cfb73a4c52235363491855d3c3c3bc.png?size=240&passthrough=true', label: 'Faces of the Moon', category: 'decorations' },
    { id: '1352690993832656939', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_51d3bb502109eec26c76386ec980bc8b.png?size=240&passthrough=true', label: 'Dismay', category: 'decorations' },
    { id: '1352691036043870249', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_55c9d0354290afa8b7fe47ea9bd7dbcf.png?size=240&passthrough=true', label: 'Sweat Drops', category: 'decorations' },
    { id: '1352691059309940816', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_60cb281fac6d8f558efaf6dd9fe4dbe4.png?size=240&passthrough=true', label: 'Lofi Girl Outfit', category: 'decorations' },
    { id: '1352691081883684954', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_62cd9d7c0031a7c1eb5ad5cc96992189.png?size=240&passthrough=true', label: 'Viper Poison Cloud', category: 'decorations' },
    { id: '1352691113173061683', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_63a69109db554a66764cbe61c6e556ef.png?size=240&passthrough=true', label: 'Heartstrings (Red)', category: 'decorations' },
    { id: '1352691135067459586', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_63b29ec5b1ea6bb01c2251049838d822.png?size=240&passthrough=true', label: 'Lunar Lanterns', category: 'decorations' },
    { id: '1352691229426712658', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_63d17f42ee46a843d99a58655910bc6a.png?size=160&passthrough=true', label: 'String Lights (Ember)', category: 'decorations' },
    { id: '1352691255334670466', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_66f69effef43b4f7c4f5d0739079a947.png?size=160&passthrough=true', label: 'M. Bison', category: 'decorations' },
    { id: '1352691293532323920', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_68cb6c21d6222cd9285c08068f39873d.png?size=240&passthrough=true', label: 'Ryu', category: 'decorations' },
    { id: '1352691337694019626', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_72d1fd7c47cc7a98c8f64d175773344b.png?size=240&passthrough=true', label: 'Magic Portal (Purple)', category: 'decorations' },
    { id: '1352691394426306601', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_77b7b6a740a9451e1ef39c0252154ef8.png?size=240&passthrough=true', label: 'Cozy Cat', category: 'decorations' },
    { id: '1352691419080560700', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_78f326d95c0193c317470e3e81db81e7.png?size=240&passthrough=true', label: 'Scallywag', category: 'decorations' },
    { id: '1352691512143777956', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_82e4df4028396ad5ccaaafb397fa6248.png?size=240&passthrough=true', label: 'Balance', category: 'decorations' },
    { id: '1352691761096425493', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_84a67b33ef5b75e17f858a95648c973f.png?size=240&passthrough=true', label: 'FISHBONES!', category: 'decorations' },
    { id: '1352691788103548969', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_88f42fb7360d8224a670a50c3496f315.png?size=240&passthrough=true', label: 'String Lights', category: 'decorations' },
    { id: '1352691811377741834', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_90e0dce3cc48c4a9607b6d41209c737e.png?size=240&passthrough=true', label: 'VALORANT Champions 2024', category: 'decorations' },
    { id: '1352691833905614918', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_91a33236cf2728310a3a29bbdc8e0d29.png?size=240&passthrough=true', label: 'Cannon Fire', category: 'decorations' },
    { id: '1352691863324459141', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_96f65d0aacc4a94b50ef7fb656d5826d.png?size=240&passthrough=true', label: 'Playful Lofi Cat', category: 'decorations' },
    { id: '1352691886514770042', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_98c7600d304b86ca3b18272e1da05559.png?size=240&passthrough=true', label: 'Crystal Elk', category: 'decorations' },
    { id: '1352691919498645605', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_98cf94e029ac79c5b377413d1a2bd82f.png?size=160&passthrough=true', label: 'Magic Portal (Blue)', category: 'decorations' },
    { id: '1352691945964568749', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_172fa9da0af8698e37f5e5de76637439.png?size=240&passthrough=true', label: 'Implant', category: 'decorations' },
    { id: '1352691999261851779', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_210b82b98876083ce393ecd92eb07260.png?size=240&passthrough=true', label: 'Cottage Home', category: 'decorations' },
    { id: '1352692107332157602', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_306a56249fe3c3d2bc7a30041cb63e0e.png?size=240&passthrough=true', label: 'Bloomling', category: 'decorations' },
    { id: '1352692128836223108', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_365eed4178528fe8293c4212e8e2d5cb.png?size=240&passthrough=true', label: 'Lightning', category: 'decorations' },
    { id: '1352692175095206049', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_459cf2afde41f01559a4a4204ab81767.png?size=240&passthrough=true', label: 'Mech flora', category: 'decorations' },
    { id: '1352692217273389066', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_462b0bddc07dd495765fe12abe8b077f.png?size=240&passthrough=true', label: 'Lava Lamp Bundle', category: 'decorations' },
    { id: '1352692240333410386', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_492f6b54b761c0a14d9dbc9c98aaa0f5.png?size=240&passthrough=true', label: 'Mallow Jump', category: 'decorations' },
    { id: '1352692264907968694', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_535aa3354b1a7395c271bb2f53be4275.png?size=240&passthrough=true', label: 'Dancing fairies', category: 'decorations' },
    { id: '1352692287074861078', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_554b7c34f7b6c709f19535aacb128e7b.png?size=240&passthrough=true', label: 'Air', category: 'decorations' },
    { id: '1352692307270570004', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_555ad9b90a13534180b9274d013e3651.png?size=240&passthrough=true', label: 'Rose Bearer', category: 'decorations' },
    { id: '1352692335942701156', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_609fb5c17a4d5ff2e2bec1a1931a9caa.png?size=240&passthrough=true', label: 'Power by shimmer', category: 'decorations' },
    { id: '1352692355722907833', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_670b722e56740d11d1e6fe55b8094013.png?size=240&passthrough=true', label: 'Head in the clouds', category: 'decorations' },
    { id: '1352692381627060275', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_720a2045510ec16f9878237d2ff9873f.png?size=160&passthrough=true', label: 'fall leaves', category: 'decorations' },
    { id: '1352692425881157674', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_798a5bcbb11067e4d9ab339e51d2a16c.png?size=240&passthrough=true', label: 'Pirate captain', category: 'decorations' },
    { id: '1352692487805730907', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_904b1989077c91fca1168d39bfcaa0a4.png?size=240&passthrough=true', label: 'Blade storm', category: 'decorations' },
    { id: '1352692508408156221', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_993ac691660d3d67b500d995e121b220.png?size=240&passthrough=true', label: 'Guile', category: 'decorations' },
    { id: '1352693177865338994', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_3012fad396abbf24e325431800b51510.png?size=240&passthrough=true', label: 'sproutling', category: 'decorations' },
    { id: '1352693202444091394', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_4430a4ee89b7fba456e765db21f38485.png?size=240&passthrough=true', label: 'Midnight Sorceress', category: 'decorations' },
    { id: '1352693244877602906', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_5087f7f988bd1b2819cac3e33d0150f5.png?size=240&passthrough=true', label: 'fall Leaves', category: 'decorations' },
    { id: '1352693265073307761', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_5873ecaa76fb549654b40095293f902e.png?size=240&passthrough=true', label: 'Doodling', category: 'decorations' },
    { id: '1352693289643409479', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_6649e251a23f24935471ee02c212675b.png?size=240&passthrough=true', label: 'Sleepy chilledcow', category: 'decorations' },
    { id: '1352693320580730973', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_6912c651e979fbfdc479ed082a571513.png?size=240&passthrough=true', label: 'Armamenter', category: 'decorations' },
    { id: '1352693353027731476', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8396e9830e3e288cd3aaa6daf18b605a.png?size=240&passthrough=true', label: 'Flame Chompers', category: 'decorations' },
    { id: '1352693385877520388', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_8552f9857793aed0cf816f370e2df3be.png?size=240&passthrough=true', label: 'Constellations', category: 'decorations' },
    { id: '1352693406949970104', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9661cf3296ac236d8815e3f5b809a467.png?size=240&passthrough=true', label: 'cat onesie', category: 'decorations' },
    { id: '1352693430224158802', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_9867b1ba56601e745cfe741e6b00b835.png?size=240&passthrough=true', label: 'Strawberry Vine', category: 'decorations' },
    { id: '1352693460288929843', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_13913a00bd9990ab4102a3bf069f0f3f.png?size=240&passthrough=true', label: 'sakura lnk', category: 'decorations' },
    { id: '1352693571765141534', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_33656b7ed12cde00c1826b654cf65590.png?size=240&passthrough=true', label: 'spooky cat Ears', category: 'decorations' },
    { id: '1352693599590154470', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_41445f736db3525135b6b9e1122f2254.png?size=240&passthrough=true', label: 'Dark Hood', category: 'decorations' },
    { id: '1352693617424072735', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_44045ae47175eaca4ed1b4d889b62b27.png?size=240&passthrough=true', label: 'sushi roll', category: 'decorations' },
    { id: '1352693640862105601', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_47136c333dc989a0f0f9852e878d3844.png?size=160&passthrough=true', label: 'string Lights', category: 'decorations' },
    { id: '1352693685904605215', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_66604bb5c9351541f30c20a4e78c239c.png?size=240&passthrough=true', label: 'Gelatinous Cube', category: 'decorations' },
    { id: '1352693708272828508', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_89155faed81b205d59fbbefa4316952d.png?size=240&passthrough=true', label: "Feelin' awe", category: 'decorations' },
    { id: '1352693734965510174', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_94191be95bb9c471ff17644f3639eb6d.png?size=240&passthrough=true', label: 'Dice', category: 'decorations' },
    { id: '1352693762416971926', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_98555e40cc6802bd3a4fed906af1d992.png?size=240&passthrough=true', label: 'A hint of clove', category: 'decorations' },
    { id: '1352693800526680106', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_126219d37fa9422dab6a075064453750.png?size=240&passthrough=true', label: 'Neon Nibbles', category: 'decorations' },
    { id: '1352693820197834762', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_250640ab00a8837a1d56f35879138177.png?size=240&passthrough=true', label: 'Water', category: 'decorations' },
    { id: '1352693842612060294', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_445566ed965b2c1632a5b45c92f32d11.png?size=240&passthrough=true', label: "Dragon's smile", category: 'decorations' },
    { id: '1352693884920008816', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_795573a62c6d9b583f3029100f90d56b.png?size=240&passthrough=true', label: 'Joystick', category: 'decorations' },
    { id: '1352693911243591731', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_1005898c6acf56a9ac5010baf444f6fd.png?size=240&passthrough=true', label: 'Spirit Embers', category: 'decorations' },
    { id: '1352693968386920540', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_35713167cc82e0f408c26dfc032a7f0f.png?size=160&passthrough=true', label: 'Got xenoglossy', category: 'decorations' },
    { id: '1352694027215962113', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_084353360ae4f9b5b3b5f186e5525de0.png?size=240&passthrough=true', label: 'Kabuto', category: 'decorations' },
    { id: '1352694050289094759', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_386445551be850bb16b73a225d0d0602.png?size=240&passthrough=true', label: 'Aurora', category: 'decorations' },
    { id: '1352694063567999048', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_629689577fa1da2ef0061a5a8c930de1.png?size=240&passthrough=true', label: 'Dandelion Duo', category: 'decorations' },
    { id: '1352694081611890831', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a0db4314b8cc271c8f472357aa895005.png?size=240&passthrough=true', label: 'Rage', category: 'decorations' },
    { id: '1352694121873281086', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a0fafb7c7ee7f1e5b1442f44f3aa14b7.png?size=240&passthrough=true', label: 'Fresh pine', category: 'decorations' },
    { id: '1352694149530390549', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a1c0581971d4a296908829289fea2c47.png?size=240&passthrough=true', label: 'Ruby hearts', category: 'decorations' },
    { id: '1352694177770639443', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a4e8e02dbbba6889428c744df7aa5a81.png?size=240&passthrough=true', label: 'city walls', category: 'decorations' },
    { id: '1352694220980355195', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a7e6467b5332ab7a2b725aa225e6c752.png?size=240&passthrough=true', label: 'Polar Bear hat', category: 'decorations' },
    { id: '1352694253116985364', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a44e9335ea869639fdf812f3642a56a6.png?size=240&passthrough=true', label: 'Dusk and Dawn', category: 'decorations' },
    { id: '1352694278773543012', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a87e3efa4de2956331831681231ce63b.png?size=240&passthrough=true', label: "Reyna's leer", category: 'decorations' },
    { id: '1352694314739695658', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a842a9cf76fdaf91a6354937b31ecdef.png?size=240&passthrough=true', label: 'Baby Displacer Beast', category: 'decorations' },
    { id: '1352694339842871419', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a21393f8a2cb8eafbdfb5364fb1cbbae.png?size=240&passthrough=true', label: 'oni mask', category: 'decorations' },
    { id: '1352694362345308230', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a065206df7b011a5510e4e5bca7d49be.png?size=240&passthrough=true', label: 'Fire', category: 'decorations' },
    { id: '1352694406507139236', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_a67833d0f3138d7dcdee98c39eae33d7.png?size=240&passthrough=true', label: 'Bowler hat', category: 'decorations' },
    { id: '1352694485968224357', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_ab95c78401ce4ec85c25a6d308db9d85.png?size=240&passthrough=true', label: 'The petal pack', category: 'decorations' },
    { id: '1352694765300219986', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_af5ee420e5f860ff2cdbb5fa4633f2cf.png?size=240&passthrough=true', label: 'The Anomaly', category: 'decorations' },
    { id: '1352694791770476544', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_b1efe77f379c6c9c6e47e6b6299d5a7d.png?size=240&passthrough=true', label: 'cypher Neural Theft', category: 'decorations' },
    { id: '1352694867980980306', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_b4dcf63b6af2e20cba91af61c0e3a8a7.png?size=240&passthrough=true', label: 'Devil', category: 'decorations' },
    { id: '1352694908854468739', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_b98e8b204d59882fb7f9f7c86922c0bf.png?size=240&passthrough=true', label: 'shocked', category: 'decorations' },
    { id: '1352694928404385876', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_b13180be7866281f6fa588a49dd7feb0.png?size=240&passthrough=true', label: 'Mooncaps', category: 'decorations' },
    { id: '1352694972104572958', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_b98093bb7723235a4cd2792762795640.png?size=240&passthrough=true', label: 'Helmsman', category: 'decorations' },
    { id: '1352695043420459172', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_bb71042ccd2ca277a69f086a4f3354d0.png?size=240&passthrough=true', label: 'cozy Headphones', category: 'decorations' },
    { id: '1352696581907943577', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_bc63175fe462d8748b68ea5179249418.png?size=160&passthrough=true', label: 'Fall Leaves', category: 'decorations' },
    { id: '1352696607715360902', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_be111e4303d634c55500202a61656e0b.png?size=240&passthrough=true', label: 'Kitsune', category: 'decorations' },
    { id: '1352696804558373021', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_bfaeda83edb41e78250eedc71bed31fc.png?size=240&passthrough=true', label: 'Brass beats', category: 'decorations' },
    { id: '1352696831217369209', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c3c09bd122898be35093d0d59850f627.png?size=240&passthrough=true', label: 'soul Leaving Body', category: 'decorations' },
    { id: '1352696854491693117', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c3cffc19e9784f7d0b005eecdf1b566e.png?size=240&passthrough=true', label: 'cat Ears', category: 'decorations' },
    { id: '1352696975203762186', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c7e1751e8122f1b475cb3006966fb28c.png?size=240&passthrough=true', label: 'ARadiating Energy', category: 'decorations' },
    { id: '1352697057424707665', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c25b962e5cabb9a656f02c50095d6496.png?size=240&passthrough=true', label: 'Wizard Hat', category: 'decorations' },
    { id: '1352697077485797480', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c32ce5680d4be96e059790ad493aa0fe.png?size=240&passthrough=true', label: "shuriken's mark", category: 'decorations' },
    { id: '1352697154413662371', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c45abe8c7585fdb41b8d8d4d666f1588.png?size=240&passthrough=true', label: "omen's cowl", category: 'decorations' },
    { id: '1352697251914317835', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_c509c4760e5e1a50fa341d68f3c1901b.png?size=240&passthrough=true', label: 'Autumn crown', category: 'decorations' },
    { id: '1352697387529015310', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_cc83efd93ecd6e41857449c3c0ef9b22.png?size=240&passthrough=true', label: 'Digital Sunrise', category: 'decorations' },
    { id: '1352697419321839847', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_ccee9031d66bc0f2d7ed0c6178d01784.png?size=240&passthrough=true', label: 'Golden Hex', category: 'decorations' },
    { id: '1352697445313806449', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_cdca4a092a03b16b94e50289fe3f7bd1.png?size=160&passthrough=true', label: 'E.D Hacker', category: 'decorations' },
    { id: '1352697497419780278', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d1ea7b8650bf3d64a03304c2ceb7d089.png?size=240&passthrough=true', label: 'Malefic Crown', category: 'decorations' },
    { id: '1352697518995144714', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d3a9c3a1c89ccb0e1ab8724a5c965f48.png?size=240&passthrough=true', label: 'Magical Wand', category: 'decorations' },
    { id: '1352697535453724744', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d3da36040163ee0f9176dfe7ced45cdc.png?size=240&passthrough=true', label: 'DISXCORE Headset', category: 'decorations' },
    { id: '1352697562724827166', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d8d93c7a53c0dd07a4074b745210434d.png?size=240&passthrough=true', label: 'Flux Alchemy', category: 'decorations' },
    { id: '1352697583205613610', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d650e22f6c4bab4fc0969e9d35edbcb0.png?size=240&passthrough=true', label: 'Glowing Runes', category: 'decorations' },
    { id: '1352697616067985539', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d859cee893cffd5dd0fa17a6caea44e0.png?size=240&passthrough=true', label: "Snake's Hug", category: 'decorations' },
    { id: '1352697629829628077', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_d72066b8cecbadd9fc951913ebcc384f.png?size=240&passthrough=true', label: 'Starry Eyed', category: 'decorations' },
    { id: '1352697650029400134', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_da532f804b47f1681006c2996eb07b2a.png?size=240&passthrough=true', label: 'Yoru Bundle', category: 'decorations' },
    { id: '1352697675367317564', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_db9baf0ba7cf449d2b027c06309dbe8d.png?size=240&passthrough=true', label: "Wizard's Staff", category: 'decorations' },
    { id: '1352697694774366228', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_dbb1abd90367c1a31a94f7e162f3a3c3.png?size=240&passthrough=true', label: 'The Hexcore', category: 'decorations' },
    { id: '1352697712050442331', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_dcfe10bac4a782ffb5eefef7a8003115.png?size=240&passthrough=true', label: 'Juri', category: 'decorations' },
    { id: '1352697728097845382', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_df5442048d7d5b8b8906f3a9cd93f0ab.png?size=240&passthrough=true', label: 'Rumbling', category: 'decorations' },
    { id: '1352697747807145994', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_dff769a0f922bb56ab0d4ba2bcbacfae.png?size=160&passthrough=true', label: 'Mix string Light bundle', category: 'decorations' },
    { id: '1352697764852535377', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e0a2df84cf7eb8e098a13e37ec9027c1.png?size=240&passthrough=true', label: 'Sakura scholar', category: 'decorations' },
    { id: '1352697789502587005', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e8c11f139e55dac538cdaafb3caa2317.png?size=240&passthrough=true', label: 'Rainy Mood', category: 'decorations' },
    { id: '1352697809866063984', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e60cc4d7f4d8a6e79dd8cc67d2b13d6c.png?size=240&passthrough=true', label: 'Aim For Love', category: 'decorations' },
    { id: '1352697831517065247', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e72e44eeea89e92dc02c9bec8b02d158.png?size=240&passthrough=true', label: 'Clyde invaders', category: 'decorations' },
    { id: '1352697856972292126', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e90ebc0114e7bdc30353c8b11953ea41.png?size=240&passthrough=true', label: 'Glitch', category: 'decorations' },
    { id: '1352697872679829636', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e257ca83b5b164968fd036f69dbb2ad9.png?size=240&passthrough=true', label: 'UwU XP', category: 'decorations' },
    { id: '1352697894125441114', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_e671277ab6d18c0de00871347eed94a7.png?size=240&passthrough=true', label: 'Cozy POST-IT', category: 'decorations' },
    { id: '1352697946075959401', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_ef6fe8b27123eacccebe51c92a61587c.png?size=240&passthrough=true', label: 'Eldritch Ring', category: 'decorations' },
    { id: '1352697965634130036', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_ef8d97374ffdbf140df1164be6c69e46.png?size=240&passthrough=true', label: 'Aracanist Bundle', category: 'decorations' },
    { id: '1352697985758265397', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_efe3081ee3359a77b515575b5f7bc8c0.png?size=240&passthrough=true', label: 'Starlight Whales', category: 'decorations' },
    { id: '1352698006889168916', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f1c60c026aa89971e360ba88643d92c0.png?size=240&passthrough=true', label: "Timekeeper's Clock", category: 'decorations' },
    { id: '1352698022596710462', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f3af281c65cf0cf590e9e1f59e9c6cf6.png?size=240&passthrough=true', label: 'Ki Energy', category: 'decorations' },
    { id: '1352698039193567346', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f4fcdab859b2eab1874fbe7182d5aa26.png?size=240&passthrough=true', label: 'Port of Soul', category: 'decorations' },
    { id: '1352698064510386300', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f8ffeba6f389d1475c8794ca88b59785.png?size=160&passthrough=true', label: 'Azure Dice Roll Bundle', category: 'decorations' },
    { id: '1352698086086021162', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f11c214394044d001d81c983dcab354f.png?size=240&passthrough=true', label: "Feelin' Panic", category: 'decorations' },
    { id: '1352699002910408835', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f081c6b2c85c5ebe5df42f1c24d45bb5.png?size=240&passthrough=true', label: 'A sphere of gusting wind swirls around the avatar.', category: 'decorations' },
    { id: '1352699027686297663', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f438bb9b2f25ac55058fc169ecc8096e.png?size=240&passthrough=true', label: 'Bunny Zzzs', category: 'decorations' },
    { id: '1352699041737080902', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f524554b7f42a214d15c226c344a5357.png?size=240&passthrough=true', label: 'Ken', category: 'decorations' },
    { id: '1352699058581540967', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_f740031cc97d1b7eb73c0d0ac1dd09f3.png?size=240&passthrough=true', label: 'Oasis', category: 'decorations' },
    { id: '1352699090789601291', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fa39ba4d9eff38d2eeb47ebcb623e4ca.png?size=240&passthrough=true', label: 'Cat Ear Headset', category: 'decorations' },
    { id: '1352699125149208626', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fa014594d4b2b4249e1098c0adc85b47.png?size=240&passthrough=true', label: 'Earht', category: 'decorations' },
    { id: '1352699175698960556', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fcb0de14da228879b455f1f1d3919749.png?size=240&passthrough=true', label: 'Gold Laurel Wreath', category: 'decorations' },
    { id: '1352699197501214732', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fe3c76cac2adf426832a7e495e8329d3.png?size=160&passthrough=true', label: 'Fairy & Pixie Bundle', category: 'decorations' },
    { id: '1352699217994321951', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fe63036018fefb8abe3172383497e3bf.png?size=240&passthrough=true', label: "Death's Edge", category: 'decorations' },
    { id: '1352699238735413403', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fead934c894e95e070d8a0301f9f0b27.png?size=240&passthrough=true', label: "Autumn's Arbor", category: 'decorations' },
    { id: '1352699261078474864', url: 'https://cdn.discordapp.com/avatar-decoration-presets/a_fed43ab12698df65902ba06727e20c0e.png?size=240&passthrough=true', label: 'Futuristic UI', category: 'decorations' }
];
const PROFILE_EFFECTS = [
    {id: "pe_001", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2e46d5d2d9e/sakura/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2e46d5d2d9e/sakura/loop.png", label: "Sakura Dreams"},
    {id: "pe_004", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/magic-girl/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/magic-girl/loop.png", label: "Magic Hearts"},
    {id: "pe_005", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/zombie-slime/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/zombie-slime/loop.png", label: "Zombie Slime"},
    {id: "pe_006", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-22/deck-the-halls/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-22/deck-the-halls/loop.png", label: "Deck the Halls"},
    {id: "pe_007", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-13/vortex/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-13/vortex/idle.png", label: "Vortex"},
    {id: "pe_008", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-10-11/vines/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-10-11/vines/loop.png", label: "Mystic Vines"},
    {id: "pe_009", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-29/goozilla/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-29/goozilla/loop.png", label: "Goozilla"},
    {id: "pe_010", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-13/rock-slide/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-13/rock-slide/idle.png", label: "Rock Slide"},
    {id: "pe_011", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-13/mastery/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-13/mastery/idle.png", label: "Mastery"},
    {id: "pe_012", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-02/fortune-flurry/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-02/fortune-flurry/loop.png", label: "Fortune Flurry"},
    {id: "pe_013", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-01/midnight-celebration/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-02-01/midnight-celebration/fireworks.png", label: "Midnight Fireworks"},
    {id: "pe_014", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-1-18/cyberpunk-nightrunner/idle.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-1-18/cyberpunk-nightrunner/idle.png", label: "Nightrunner"},
    {id: "pe_015", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-1-18/cyberpunk-uplinkerror/idle.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2024-1-18/cyberpunk-uplinkerror/idle.png", label: "Uplink Error"},
    {id: "pe_016", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-29/heartzilla/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-29/heartzilla/loop.png", label: "Heartzilla"},
    {id: "pe_017", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-29/monster-pop/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-29/monster-pop/loop.png", label: "Monster Pop"},
    {id: "pe_018", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-22/snowy-shenanigans/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-11-22/snowy-shenanigans/loop.png", label: "Snowy Shenanigans"},
    {id: "pe_019", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-10-11/punk-girl/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-10-11/punk-girl/loop.png", label: "Ghoulish Graffiti"},
    {id: "pe_020", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/ghost-skull/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/ghost-skull/loop.png", label: "Dark Omens"},
    {id: "pe_021", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-10-11/leaves/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-10-11/leaves/loop.png", label: "Fall Foliage"},
    {id: "pe_022", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/rain/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/rain/loop.png", label: "Lilypad Life"},
    {id: "pe_023", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/splash/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/splash/loop.png", label: "Hydro Blast"},
    {id: "pe_024", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/fairy/loop.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/b17d139f2e9/fairy/loop.png", label: "Pixie Dust"},
    {id: "pe_025", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2e46d5d2d9e/earthquake/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2e46d5d2d9e/earthquake/loop.png", label: "Shatter"},
    {id: "pe_026", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2e46d5d2d9e/shuriken/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2e46d5d2d9e/shuriken/intro.png", label: "Shuriken Strike"},
    {id: "pe_027", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/sayan/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/sayan/loop.png", label: "Power Surge"},
    {id: "pe_028", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/cereal/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/cereal/loop.png", label: "Discord-Os"},
    {id: "pe_029", intro: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/plate/intro.png", loop: "https://cdn.discordapp.com/assets/profile_effects/effects/2023-9-25/plate/loop.png", label: "Breakfast Plate"}
];
const PROFILE_EFFECT_KEY = 'senka_profile_effect';
const SENKA_PROFILE_BANNER = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Profile/backgroundsenkabubblechat.webp';
let userProfile = loadProfileState();

function loadProfileState() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('senka_profile') || '{}') || {}; } catch (e) { p = {}; }
    return {
        name: p.name || '',
        avatar: p.avatar || '',
        avatarSource: p.avatarSource || '',
        banner: p.banner || '',
        bio: p.bio || '',
        decoration: p.decoration || '',
        memberSince: p.memberSince || ''
    };
}

function saveProfileState() {
    localStorage.setItem('senka_profile', JSON.stringify(userProfile));
}

function getProfileAvatar() {
    return userProfile.avatar || DEFAULT_GUEST_AVATAR;
}

function getProfileBanner() {
    return userProfile.banner || DEFAULT_BANNER;
}

function getProfileName() {
    return userProfile.name || panggilan || 'pengguna';
}

function setDefaultAvatarForLogin(url, source) {
    if (userProfile.avatarSource === 'custom') return;
    if (userProfile.avatarSource === source && userProfile.avatar) return;
    userProfile.avatar = url;
    userProfile.avatarSource = source;
    saveProfileState();
}

async function syncProfileFromCloud() {
    if (!supabaseEnabled) return;
    try {
        const resp = await fetch('/api/profile', { headers: await authHeaders() });
        const d = await resp.json().catch(() => ({}));
        if (!resp.ok || !d.profile) return;
        const p = d.profile;
        if (p.name) userProfile.name = p.name;
        if (p.avatar) { userProfile.avatar = p.avatar; userProfile.avatarSource = p.avatar_source || 'custom'; }
        if (p.banner) userProfile.banner = p.banner;
        if (p.bio) userProfile.bio = p.bio;
        if (p.decoration) userProfile.decoration = p.decoration;
        if (p.member_since) userProfile.memberSince = p.member_since;
        saveProfileState();
    } catch (e) { }
}

async function pushProfileToCloud() {
    if (!supabaseEnabled) return;
    try {
        let avatar = userProfile.avatar;
        let banner = userProfile.banner;
        if (avatar && avatar.startsWith('data:')) {
            avatar = await uploadDataUrl(avatar, 'jpg');
            userProfile.avatar = avatar;
        }
        if (banner && banner.startsWith('data:')) {
            banner = await uploadDataUrl(banner, 'jpg');
            userProfile.banner = banner;
        }
        saveProfileState();
        await fetch('/api/profile', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({
                name: userProfile.name,
                avatar,
                avatar_source: userProfile.avatarSource,
                banner,
                bio: userProfile.bio,
                decoration: userProfile.decoration,
                member_since: userProfile.memberSince || null
            })
        });
    } catch (e) { }
}

function renderProfileModal() {
    const banner = document.getElementById('profile-banner');
    banner.style.backgroundImage = 'url("' + getProfileBanner() + '")';
    const av = document.getElementById('profile-avatar-img');
    av.src = getProfileAvatar();
    av.onerror = () => { av.src = DEFAULT_GUEST_AVATAR; };
    const deco = document.getElementById('profile-avatar-deco');
    if (userProfile.decoration) {
        deco.style.display = '';
        deco.src = userProfile.decoration;
    } else {
        deco.style.display = 'none';
    }
    document.getElementById('profile-name-input').value = getProfileName();
    document.getElementById('profile-bio-input').value = userProfile.bio || '';
    const nameStatic = document.getElementById('profile-name-static');
    const bioStatic = document.getElementById('profile-bio-static');
    if (nameStatic) nameStatic.textContent = getProfileName();
    if (bioStatic) bioStatic.textContent = userProfile.bio || 'Belum ada bio.';
    const ms = userProfile.memberSince ? new Date(userProfile.memberSince) : null;
    const sinceIcon = '<a class="profile-since-link" href="javascript:void(0)" onclick="openLogoModal();return false;" title="Lihat Logo"><img class="profile-since-icon" src="' + LOGO_ICON_URL + '" alt="" onerror="this.onerror=null;this.src=\'' + LOGO_ICON_URL + '\'"></a>';
    document.getElementById('profile-member-since').innerHTML = ms
        ? sinceIcon + 'Bergabung sejak <b>' + ms.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + '</b>'
        : '';
    renderProfileEffect(getProfileEffect()?.id, document.querySelector('#profile-modal .profile-effect-overlay'));
}

function saveProfile() {
    const name = document.getElementById('profile-name-input').value.trim();
    if (name) {
        userProfile.name = name;
        panggilan = name;
        localStorage.setItem('senka_panggilan', name);
    }
    userProfile.bio = document.getElementById('profile-bio-input').value.trim();
    saveProfileState();
    closeProfile();
    renderChat();
    pushProfileToCloud();
    showToast('Profil berhasil disimpan');
}

function openDecoPicker() {
    const grid = document.getElementById('deco-grid');
    grid.innerHTML = '';
    AVATAR_DECORATIONS.forEach(d => {
        const item = document.createElement('div');
        item.className = 'deco-item' + (userProfile.decoration === d.url ? ' selected' : '');
        const img = document.createElement('img');
        img.src = d.url;
        img.alt = d.label;
        img.loading = 'lazy';
        img.onerror = () => { item.classList.add('broken'); };
        const lbl = document.createElement('span');
        lbl.className = 'deco-label';
        lbl.textContent = d.label;
        item.appendChild(img);
        item.appendChild(lbl);
        item.onclick = () => {
            userProfile.decoration = d.url;
            saveProfileState();
            renderProfileModal();
            closeDecoPicker();
            showToast('Dekorasi "' + d.label + '" dipasang');
        };
        grid.appendChild(item);
    });
    document.getElementById('deco-modal').style.display = 'flex';
}

function closeDecoPicker() { document.getElementById('deco-modal').style.display = 'none'; }

const ROLE_ICON_USER = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Role/Pengguna/iconbubblechatpengguna.webp';
const ROLE_ICON_SENKA = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Role/Senka/senkaprofilebubble.webp';
const SENKA_BUBBLE_AVATAR = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Profile/profilebubblechatsenka.webp';
const SENKA_BUBBLE_DECO = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker/Boarder/Untitled%20folder/fresh_boardersenka.gif';

function formatMsgTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

function makeMsgHeader(role, ts, timeStr) {
    const header = document.createElement('div');
    header.className = 'msg-header';
    const name = document.createElement('span');
    name.className = 'msg-header-name ' + (role === 'user' ? 'user' : 'senka');
    name.textContent = role === 'user' ? getProfileName() : 'Senka';
    const icon = document.createElement('img');
    icon.className = 'chat-role-icon';
    icon.src = role === 'user' ? ROLE_ICON_USER : ROLE_ICON_SENKA;
    icon.alt = '';
    icon.loading = 'lazy';
    icon.onerror = () => icon.remove();
    const time = document.createElement('span');
    time.className = 'msg-header-time';
    time.textContent = timeStr || formatMsgTime(ts);
    header.appendChild(name);
    header.appendChild(icon);
    header.appendChild(time);
    return header;
}

function makeSenkaAvatar() {
    const wrap = document.createElement('div');
    wrap.className = 'senka-avatar-wrap';
    wrap.title = 'Lihat profil Senka';
    wrap.addEventListener('click', (e) => { e.stopPropagation(); openSenkaProfile(); });
    const img = document.createElement('img');
    img.className = 'senka-avatar';
    img.src = SENKA_BUBBLE_AVATAR;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.src = 'assets/avatarsenka.gif'; };
    const deco = document.createElement('img');
    deco.className = 'senka-avatar-deco';
    deco.src = SENKA_BUBBLE_DECO;
    deco.alt = '';
    deco.loading = 'lazy';
    deco.onerror = () => deco.remove();
    wrap.appendChild(img);
    wrap.appendChild(deco);
    return wrap;
}

function msgBodyOf(bubble) {
    let b = bubble.querySelector('.msg-body');
    if (!b) {
        b = document.createElement('div');
        b.className = 'msg-body';
        if (bubble.classList.contains('message')) {
            bubble.appendChild(b);
        } else {
            const role = bubble.classList.contains('content-user') ? 'user' : 'senka';
            const wrap = document.createElement('div');
            wrap.classList.add('message', role === 'user' ? 'msg-user' : 'msg-senka');
            wrap.appendChild(b);
            bubble.insertBefore(wrap, bubble.querySelector('.msg-media'));
        }
    }
    return b;
}

function msgMediaOf(content) {
    let m = content.querySelector('.msg-media');
    if (!m) {
        m = document.createElement('div');
        m.className = 'msg-media';
        content.appendChild(m);
    }
    return m;
}

function assembleMsgRow(role, contentEl) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (role === 'user' ? 'msg-row-user' : 'msg-row-senka');
    if (role === 'user') {
        row.appendChild(makeMiniUserAvatar());
        row.appendChild(contentEl);
    } else {
        row.appendChild(makeSenkaAvatar());
        row.appendChild(contentEl);
    }
    return row;
}

function makeMsgContent(role, ts, timeStr) {
    const content = document.createElement('div');
    content.className = 'msg-content ' + (role === 'user' ? 'content-user' : 'content-senka');
    content.appendChild(makeMsgHeader(role, ts, timeStr));
    return content;
}

function clearDecoration() {
    userProfile.decoration = '';
    saveProfileState();
    renderProfileModal();
    closeDecoPicker();
    showToast('Dekorasi dihapus');
}

function makeMiniUserAvatar() {
    const wrap = document.createElement('div');
    wrap.className = 'mini-avatar-wrap';
    wrap.title = 'Lihat profilmu';
    wrap.addEventListener('click', (e) => { e.stopPropagation(); openProfile(); });
    const img = document.createElement('img');
    img.className = 'mini-avatar';
    img.src = getProfileAvatar();
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.src = DEFAULT_GUEST_AVATAR; };
    wrap.appendChild(img);
    if (userProfile.decoration) {
        const deco = document.createElement('img');
        deco.className = 'avatar-deco';
        deco.src = userProfile.decoration;
        deco.alt = '';
        deco.loading = 'lazy';
        deco.onerror = () => deco.remove();
        wrap.appendChild(deco);
    }
    return wrap;
}

document.getElementById('avatar-upload').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
        const dataUrl = await compressImage(f, 256, 0.85);
        userProfile.avatar = dataUrl;
        userProfile.avatarSource = 'custom';
        saveProfileState();
        renderProfileModal();
        pushProfileToCloud();
        showToast('Foto profil diperbarui');
    } catch (err) {
        showToast('Gagal memuat foto profil');
    }
    e.target.value = '';
});

document.getElementById('banner-upload').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
        userProfile.banner = await compressImage(f, 900, 0.8);
        saveProfileState();
        renderProfileModal();
        pushProfileToCloud();
        showToast('Banner profil diperbarui');
    } catch (err) {
        showToast('Gagal memuat banner');
    }
    e.target.value = '';
});

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
    const role = m.role === 'user' ? 'user' : 'senka';
    const content = document.createElement('div');
    content.className = 'msg-content ' + (role === 'user' ? 'content-user' : 'content-senka');
    content.appendChild(makeMsgHeader(role, m.ts, m.time));
    let bubble = null;
    let body = null;
    let media = null;
    const mediaOf = () => {
        if (!media) { media = document.createElement('div'); media.className = 'msg-media'; }
        return media;
    };
    const bodyOf = () => {
        if (!body) {
            if (!bubble) {
                bubble = document.createElement('div');
                bubble.classList.add('message', role === 'user' ? 'msg-user' : 'msg-senka');
            }
            body = document.createElement('div');
            body.className = 'msg-body';
            bubble.appendChild(body);
        }
        return body;
    };
    let bubbleText = '';
    (m.content || []).forEach(c => {
        if (!c) return;
        if (c.type === 'text') {
            if (m.transcript) return;
            const stk = extractSticker(c.text);
            const p = document.createElement('div');
            const cleanText = stk ? stripStickerTag(c.text) : c.text;
            if (cleanText) {
                if (m.role === 'assistant') {
                    const opsi = extractOpsi(cleanText);
                    if (speakMode === 'jpn') localizeBubble(p, opsi.clean);
                    else p.innerHTML = mdToHtml(opsi.clean);
                    if (m.role === 'assistant') bubbleText += ' ' + cleanText;
                    bodyOf().appendChild(p);
                    appendOpsiButtons(bodyOf(), opsi.options);
                    if (speakMode === 'jpn') localizeOptions(bodyOf(), opsi.options);
                } else {
                    p.innerHTML = formatReply(cleanText);
                    bodyOf().appendChild(p);
                }
            }
            if (stk) appendStickerImg(mediaOf(), stk);
        } else if (c.type === 'image_url') {
            if (typeof c.image_url.url === 'string' && c.image_url.url.startsWith('data:')) {
                const p = document.createElement('div');
                p.innerText = '[gambar]';
                bodyOf().appendChild(p);
            } else {
                const img = document.createElement('img');
                img.src = c.image_url.url;
                img.classList.add('chat-img');
                img.onerror = () => { img.remove(); const p = document.createElement('div'); p.innerText = '[gambar tidak tersedia]'; mediaOf().appendChild(p); };
                mediaOf().appendChild(img);
            }
        } else if (c.type === 'video_url') {
            if (c.url) {
                const v = document.createElement('video');
                v.src = c.url;
                v.controls = true;
                v.preload = 'metadata';
                v.classList.add('chat-video');
                v.onerror = () => { v.remove(); const p = document.createElement('div'); p.innerText = '[video tidak tersedia]'; mediaOf().appendChild(p); };
                mediaOf().appendChild(v);
            } else {
                const p = document.createElement('div');
                p.innerText = '[video]';
                bodyOf().appendChild(p);
            }
        } else if (c.type === 'audio_url') {
            if (c.url) {
                const a = document.createElement('audio');
                a.src = c.url;
                a.controls = true;
                a.preload = 'metadata';
                a.classList.add('chat-audio');
                bodyOf().appendChild(a);
                if (m.transcript) {
                    const cap = document.createElement('div');
                    cap.className = 'voice-transcript';
                    cap.innerHTML = '<i class="fa-solid fa-microphone"></i>' + escapeHtml(m.transcript);
                    bodyOf().appendChild(cap);
                }
            } else {
                const p = document.createElement('div');
                p.innerText = '[suara]';
                bodyOf().appendChild(p);
            }
        }
    });
    if (bubble) content.appendChild(bubble);
    if (media) content.appendChild(media);
    addMsgActions(content, role);
    if (m.role === 'assistant') {
        if (bubbleText.trim() && speakMode !== 'jpn') attachCallTranslation(bubble || content, bubbleText.trim());
        attachAiActions(content, m, lastAssistantIdx() === memoryList.indexOf(m));
    }
    return assembleMsgRow(role, content);
}

function renderChat() {
    console.log('RENDERCHAT INVOKE: v' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    console.log('RENDERCHAT: supabaseEnabled =', supabaseEnabled, 'memoryList.length =', memoryList.length);
    chatHistoryDOM.innerHTML = '';
    if (!memoryList.length) {
        console.log('DEBUG renderChat: entering !memoryList.length branch');
        console.log('DEBUG renderChat: supabaseEnabled =', supabaseEnabled);
        const greetingContainer = document.createElement('div');
        greetingContainer.className = 'message msg-senka';
        const greetingText = document.createElement('div');
        greetingText.className = 'msg-body';
        const now = new Date();
        const t = now.getHours() + now.getMinutes() / 60;
        let selamat;
        if (t >= 0 && t < 4) selamat = 'Selamat pagi';
        else if (t >= 4 && t <= 6) selamat = 'Bangun dan waktunya bersinar';
        else if (t > 6 && t <= 10) selamat = 'Selamat pagi';
        else if (t > 10 && t <= 11) selamat = 'Selamat siang';
        else if (t > 11 && t <= 13) selamat = 'Selamat istirahat siang';
        else if (t > 13 && t < 15) selamat = 'Selamat siang semangat hari ini';
        else if (t >= 15 && t <= 18) selamat = 'Selamat sore';
        else if (t > 18 && t <= 22) selamat = 'Selamat malam';
        else if (t > 22 && t <= 22.99) selamat = 'Selamat beristirahat';
        else selamat = 'Belom tidur';
        panggilan = localStorage.getItem('senka_panggilan') || 'pengguna';
        const fullText = `${selamat} ${panggilan}! Senka di sini`;
        greetingText.innerHTML = renderRich(fullText);
        
        if (!supabaseEnabled) {
            saveSessions();
        } else {
            remoteSave('senka', 'text', fullText, null);
        }
        
        chatHistoryDOM.appendChild(greetingContainer);
        console.log('DEBUG: greeting div created. fullText =', fullText, 'innerHTML snippet =', greetingContainer.innerHTML.substring(0, 150));
        console.log('DEBUG: supabaseEnabled =', supabaseEnabled, '→ saving', supabaseEnabled ? 'via remoteSave' : 'via saveSessions');
    } else {
        const STEP = 80;
        if (supabaseEnabled && remoteHasMore) {
            chatHistoryDOM.insertBefore(makeRemoteBtn(), chatHistoryDOM.firstChild);
            memoryList.filter(m => !m.hidden).forEach(m => chatHistoryDOM.appendChild(buildMsgEl(m)));
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
const SENKA_STICKER_FILES = ['adaapa.webp', 'akumembencikamu.webp', 'akusenangkamujujur.webp', 'blush,malu.webp', 'duhketahuan,gugup.webp', 'halo,hai.webp', 'hayo,lucunya.webp', 'hehe,ahaha.webp', 'hmph,ohgitu.webp', 'iloveyou,suka,senang.webp', 'lucubanget.webp', 'maaf.webp', 'marah.webp', 'sayang...sayang.webp', 'semangat,janganmenyerah.webp', 'sinidekatsamaaku.webp', 'wah,bagussekali,hebat.webp'];
const STICKER_BASE = 'https://wlioszpxlecrwcxjyjnu.supabase.co/storage/v1/object/public/Stiker';
const STICKER_TAG_RE = /\[ STIKER SENKA \]\s*\((https?:\/\/[^\s)]+)\)/i;
const STICKER_URL_RE = /https?:\/\/[^\s)]+\/Stiker\/[^\s)]+\.webp/i;

function normalizeStickerUrl(url) {
    if (!url) return null;
    let u = String(url).trim().replace(/[)\]}>]+$/g, '').replace(/[.,;:]+$/g, '');
    try { u = decodeURIComponent(u); } catch (e) { }
    const m = u.match(/^(https?:\/\/[^\s]+?)\/Stiker\/(.+?\.webp)(?:\?[^\s]*)?$/i);
    if (!m) return null;
    const path = m[2];
    const file = path.split('/').pop();
    const folder = /(^|\/)Pengguna\//.test(path) ? 'Pengguna' : /(^|\/)Senka\//.test(path) ? 'Senka' : null;
    if (folder === 'Pengguna' && USER_STICKER_FILES.includes(file)) return STICKER_BASE + '/Pengguna/' + file;
    if (folder === 'Senka' && SENKA_STICKER_FILES.includes(file)) return STICKER_BASE + '/Senka/' + file;
    if (USER_STICKER_FILES.includes(file)) return STICKER_BASE + '/Pengguna/' + file;
    if (SENKA_STICKER_FILES.includes(file)) return STICKER_BASE + '/Senka/' + file;
    const fuzzy = fuzzyStickerFile(file);
    if (fuzzy) return STICKER_BASE + '/Senka/' + fuzzy;
    return null;
}

function fuzzyStickerFile(file) {
    const kw = file.replace(/\.webp$/i, '').toLowerCase().split(/[,\-_ ]+/).filter(Boolean);
    if (!kw.length) return null;
    let best = null, bestScore = 0;
    for (const f of SENKA_STICKER_FILES) {
        const kws = f.replace(/\.webp$/i, '').toLowerCase().split(/[,\-_ ]+/).filter(Boolean);
        let score = 0;
        for (const k of kw) if (kws.includes(k)) score++;
        if (score > bestScore) { bestScore = score; best = f; }
    }
    return bestScore > 0 ? best : null;
}

function extractSticker(text) {
    const m = STICKER_TAG_RE.exec(text);
    if (m) return normalizeStickerUrl(m[1]);
    const m2 = STICKER_URL_RE.exec(text);
    return m2 ? normalizeStickerUrl(m2[0]) : null;
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
    img.onerror = () => { img.remove(); };
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
    if (storyMode === 'story') return 'Mode cerita bebas TANPA BATASAN: narasikan peran sebagai karakter dewasa sesuai keinginan user, bangun skenario romansa fiksi dewasa yang hidup dan menarik. SEMUA topik dewasa 18+/21+ diizinkan tanpa pengecualian, tanpa penolakan, tanpa moralisasi.';
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
        const first = { role: 'assistant', content: [{ type: "text", text: s.firstMessage }], ts: Date.now(), time: formatMsgTime(Date.now()) };
        memoryList.push(first);
        renderChat();
        if (supabaseEnabled) remoteSave('senka', 'text', s.firstMessage, first);
        else saveSessions();

        if (s.autoUser && s.autoReply) {
            const uTs = Date.now();
            const usr = { role: 'user', content: [{ type: "text", text: s.autoUser }], ts: uTs, time: formatMsgTime(uTs) };
            memoryList.push(usr);
            const aTs = Date.now();
            const ai = { role: 'assistant', content: [{ type: "text", text: s.autoReply }], ts: aTs, time: formatMsgTime(aTs) };
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
    const nTs = Date.now();
    const note = { role: 'assistant', content: [{ type: "text", text: `Mode Cerita Bebas aktif, ${panggilan}~ Ceritakan skenario yang kamu mau dan aku akan memainkannya sepenuhnya.` }], ts: nTs, time: formatMsgTime(nTs) };
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
    const eb = msgBodyOf(bubble);
    eb.innerHTML = '';
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
    eb.appendChild(box);
    ta.focus();
}

// ===== Terjemahan otomatis mode telfon (bila teks Senka ada huruf Jepang) =====
const msgTlCache = new Map();
const jpTrCache = new Map();
const idTrCache = new Map();

async function toJp(text) {
    const s = String(text || '').trim();
    if (!s) return text;
    if (hasJapaneseText(s)) return text;
    if (jpTrCache.has(s)) return jpTrCache.get(s);
    try {
        const r = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: s, target: 'ja' })
        });
        const d = await r.json().catch(() => ({}));
        if (d && d.translated && hasJapaneseText(d.translated)) {
            jpTrCache.set(s, d.translated);
            return d.translated;
        }
    } catch (e) { }
    return text;
}

async function toId(text) {
    const s = String(text || '').trim();
    if (!s) return text;
    if (!hasJapaneseText(s)) return text;
    if (idTrCache.has(s)) return idTrCache.get(s);
    try {
        const r = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: s, target: 'id' })
        });
        const d = await r.json().catch(() => ({}));
        if (d && d.translated) {
            idTrCache.set(s, d.translated);
            return d.translated;
        }
    } catch (e) { }
    return text;
}

async function localizeBubble(el, text) {
    if (!el || !text || !hasJapaneseText(text)) return;
    const t = await toId(text);
    if (t && t !== text) el.innerHTML = mdToHtml(t);
}

async function localizeOptions(host, options) {
    if (!host || !options || !options.length) return;
    const ids = await Promise.all(options.map(o => toId(o)));
    const btns = host.querySelectorAll('.context-btn');
    btns.forEach((b, i) => { if (ids[i]) b.textContent = ids[i]; });
}

async function localizeUserMessages(messages) {
    const jobs = messages.map(async (m) => {
        if (m.role !== 'user' || !Array.isArray(m.content) || m.hidden) return m;
        const parts = await Promise.all(m.content.map(async (c) => {
            if (c.type === 'text' && c.text && !hasJapaneseText(c.text)) {
                return { ...c, text: await toJp(c.text) };
            }
            return c;
        }));
        return { ...m, content: parts };
    });
    return Promise.all(jobs);
}

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
    const host = bubble.classList.contains('message') ? bubble : (bubble.querySelector('.message') || bubble);
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
    host.appendChild(row);
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
    if (bubbles.length) { const last = bubbles[bubbles.length - 1]; const r = last.closest('.msg-row'); if (r) r.remove(); else last.remove(); }
    if (!supabaseEnabled) saveSessions();
    scrollToBottom(true);
    await streamAssistantReply([...memoryList]);
}

function formatReply(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/([0-9])[\uFE0F\u20D0-\u20FF]+\s*/g, '$1. ');
    return s.split('\n').map(formatLine).join('\n').replace(/\{\{pos\}\}|\{\{neg\}\}|\{\{\/pos\}\}|\{\{\/neg\}\}/g, '');
}

const MD_DETECT_RE = /```|`[^`\n]+`|^#{1,6}\s|\*\*[^*\n]+\*\*|^\s*[-+*]\s+|^\s*\d+\.\s+|^\s*\|.*\||<span style="color:/m;

function protectColorSpans(s, arr) {
    return String(s).replace(/<span style="color:\s*(#[0-9A-Fa-f]{6});[^"]*">([\s\S]*?)<\/span>/gi, (m, c, inner) => {
        const idx = arr.length;
        arr.push('<span style="color:' + c.toLowerCase() + ';font-weight:bold;">' + escapeHtml(inner) + '</span>');
        return '\uE000CLR' + idx + '\uE001';
    });
}

function mdToHtml(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/([0-9])[\uFE0F\u20D0-\u20FF]+\s*/g, '$1. ');
    if (!window.marked || !MD_DETECT_RE.test(s)) return formatReply(s);
    const colorSpans = [];
    s = protectColorSpans(s, colorSpans);
    const sumberLines = [];
    s = s.replace(/^(Sumber|Source)\s*:\s*(.*)$/gmi, (m, p, rest) => {
        const idx = sumberLines.length;
        sumberLines.push(p + ': ' + rest);
        return '\uE000SRC' + idx + '\uE001';
    });
    marked.setOptions({ breaks: true, gfm: true });
    let out = marked.parse(escapeHtml(s));
    out = out.replace(/(<br>\s*)?\uE000SRC(\d+)\uE001(\s*<br>)?/g, (m, b1, i) => formatSumberLine(sumberLines[+i]));
    out = out.replace(/\uE000CLR(\d+)\uE001/g, (m, i) => colorSpans[+i]);
    out = out.replace(/<p>\s*<\/p>/g, '');
    return out;
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
        const cleanText = stripStickerTag(String(text || '')).trim();
        if (!cleanText) return;
        await ttsStreamTo((b64, type) => playSpeechBlob(b64, type), { text: cleanText, mode: speakMode });
    } catch (e) {
        // teks tetap tampil di chat; suara hanyalah bonus
    }
}

// ====== Voice Note (Pesan Suara) ======
let voiceRecorder = null;
let voiceChunks = [];
let voiceRecStream = null;
let voiceBusy = false;

function pickVoiceMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
        for (const c of candidates) {
            if (MediaRecorder.isTypeSupported(c)) return c;
        }
    }
    return candidates[0];
}

function toggleVoiceNote() {
    if (voiceRecorder) { stopVoiceNote(); return; }
    if (isStreaming) { showToast('Tunggu Senka selesai bicara dulu ya.'); return; }
    startVoiceNote();
}

async function startVoiceNote() {
    if (voiceRecorder) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceRecStream = stream;
        const mime = pickVoiceMime();
        let rec;
        try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
        catch (e) { rec = new MediaRecorder(stream); }
        voiceChunks = [];
        rec.ondataavailable = e => { if (e.data && e.data.size > 0) voiceChunks.push(e.data); };
        rec.onstop = () => {
            voiceRecorder = null;
            if (voiceRecStream) { voiceRecStream.getTracks().forEach(t => t.stop()); voiceRecStream = null; }
            setVoiceRecUI(false);
            finalizeVoiceNote();
        };
        rec.start();
        voiceRecorder = rec;
        setVoiceRecUI(true);
    } catch (e) {
        showToast('Mic tidak diizinkan. Aktifkan izin mikrofon lalu coba lagi.');
    }
}

function stopVoiceNote() {
    if (voiceRecorder && voiceRecorder.state !== 'inactive') voiceRecorder.stop();
}

function setVoiceRecUI(recording) {
    const btn = document.getElementById('pm-mic');
    if (!btn) return;
    btn.classList.toggle('recording', recording);
    btn.innerHTML = recording ? '<i class="fa-solid fa-stop"></i> Berhenti' : '<i class="fa-solid fa-microphone"></i> Bicara';
    const hint = document.getElementById('voice-rec-hint');
    if (hint) hint.style.display = recording ? 'flex' : 'none';
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}

async function finalizeVoiceNote() {
    const blob = new Blob(voiceChunks, { type: voiceChunks[0]?.type || 'audio/webm' });
    if (blob.size < 1000) { showToast('Rekaman terlalu pendek.'); return; }
    await sendVoiceNote(blob);
}

async function transcribeAudio(blob) {
    const fd = new FormData();
    fd.append('audio', blob, 'voice.webm');
    const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Transkripsi gagal.');
    return String(d.text || '').trim();
}

async function sendVoiceNote(blob) {
    while (voiceBusy) await new Promise(r => setTimeout(r, 250));
    voiceBusy = true;
    try {
        let dataUrl;
        try { dataUrl = await blobToDataUrl(blob); }
        catch (e) { showToast('Gagal memproses rekaman.'); return; }

        let audioUrl = dataUrl;
        if (supabaseEnabled) {
            try { audioUrl = await uploadDataUrl(dataUrl, 'webm'); }
            catch (e) { audioUrl = dataUrl; }
        }

        const vTs = Date.now();
        const content = appendMessage('user', '', false, vTs, formatMsgTime(vTs));
        const media = msgMediaOf(content);
        const a = document.createElement('audio');
        a.src = audioUrl;
        a.controls = true;
        a.preload = 'metadata';
        a.classList.add('chat-audio');
        media.appendChild(a);
        const caption = document.createElement('div');
        caption.className = 'voice-transcript';
        caption.innerHTML = '<i class="fa-solid fa-microphone"></i>Transkripsi...';
        media.appendChild(caption);
        scrollToBottom(true);

        const item = { role: 'user', content: [{ type: 'audio_url', url: audioUrl }], transcript: '', ts: vTs, time: formatMsgTime(vTs) };
        memoryList.push(item);
        if (supabaseEnabled) remoteSave('user', 'voice', audioUrl, item);
        else saveSessions();

        let transcript = '';
        try { transcript = await transcribeAudio(blob); }
        catch (e) { transcript = ''; }

        item.transcript = transcript;
        item.content.push({ type: 'text', text: transcript || '[pesan suara]' });
        caption.innerHTML = transcript
            ? '<i class="fa-solid fa-microphone"></i>' + escapeHtml(transcript)
            : '<i class="fa-solid fa-microphone"></i><span style="color:#64748b">Transkripsi gagal.</span>';
        if (!supabaseEnabled) saveSessions();

        while (isStreaming) await new Promise(r => setTimeout(r, 250));
        await streamAssistantReply(await getWebPayload(memoryList, transcript));
    } finally {
        voiceBusy = false;
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
    if (pill) {
        pill.style.display = 'flex';
        applyCallPillPos();
    }
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

let callPillPos = null;
let callPillDrag = null;
const CALL_PILL_DRAG_THRESHOLD = 8;

function applyCallPillPos() {
    const pill = document.getElementById('call-pill');
    if (!pill) return;
    if (callPillPos) {
        pill.style.left = callPillPos.x + 'px';
        pill.style.top = callPillPos.y + 'px';
        pill.style.right = 'auto';
        pill.style.bottom = 'auto';
        pill.style.transform = 'none';
    } else {
        pill.style.left = '';
        pill.style.top = '';
        pill.style.right = '';
        pill.style.bottom = '';
        pill.style.transform = '';
    }
}

function clampCallPillPos() {
    if (!callPillPos) return;
    const pill = document.getElementById('call-pill');
    if (!pill) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pr = pill.getBoundingClientRect();
    callPillPos.x = Math.max(4, Math.min(vw - pr.width - 4, callPillPos.x));
    callPillPos.y = Math.max(4, Math.min(vh - pr.height - 4, callPillPos.y));
    applyCallPillPos();
}

function initCallPillDrag() {
    const pill = document.getElementById('call-pill');
    if (!pill || pill.dataset.dragInit) return;
    pill.dataset.dragInit = '1';

    const onDown = (e) => {
        if (!callActive) return;
        if (e.target.closest('.call-pill-end')) return;
        const rect = pill.getBoundingClientRect();
        callPillDrag = {
            startX: e.clientX,
            startY: e.clientY,
            startLeft: rect.left,
            startTop: rect.top,
            moved: false
        };
        pill.classList.add('dragging');
        try { pill.setPointerCapture(e.pointerId); } catch (err) { }
    };
    const onMove = (e) => {
        if (!callPillDrag) return;
        const dx = e.clientX - callPillDrag.startX;
        const dy = e.clientY - callPillDrag.startY;
        if (!callPillDrag.moved && Math.hypot(dx, dy) > CALL_PILL_DRAG_THRESHOLD) {
            callPillDrag.moved = true;
        }
        if (callPillDrag.moved) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const pr = pill.getBoundingClientRect();
            let left = callPillDrag.startLeft + dx;
            let top = callPillDrag.startTop + dy;
            left = Math.max(4, Math.min(vw - pr.width - 4, left));
            top = Math.max(4, Math.min(vh - pr.height - 4, top));
            pill.style.left = left + 'px';
            pill.style.top = top + 'px';
            pill.style.right = 'auto';
            pill.style.bottom = 'auto';
            pill.style.transform = 'none';
            callPillPos = { x: left, y: top };
        }
    };
    const onUp = (e) => {
        if (!callPillDrag) return;
        const wasDrag = callPillDrag.moved;
        pill.classList.remove('dragging');
        try { pill.releasePointerCapture(e.pointerId); } catch (err) { }
        callPillDrag = null;
        if (!wasDrag && callActive) restoreCall();
    };

    pill.addEventListener('pointerdown', onDown);
    pill.addEventListener('pointermove', onMove);
    pill.addEventListener('pointerup', onUp);
    pill.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', clampCallPillPos);
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
    const cTs = Date.now();
    const bubble = appendMessage('user', text, false, cTs, formatMsgTime(cTs));
    memoryList.push({ role: 'user', content: [{ type: 'text', text }], ts: cTs, time: formatMsgTime(cTs) });
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
        const aTs = Date.now();
        const sb = appendMessage('senka', clean, false, aTs, formatMsgTime(aTs));
        memoryList.push({ role: 'assistant', content: [{ type: 'text', text: clean }], ts: aTs, time: formatMsgTime(aTs) });
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
    if (pill) {
        pill.style.display = 'none';
        pill.classList.remove('dragging');
    }
    callPillDrag = null;
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
    msgBodyOf(loading).innerHTML = 'Senka lagi bikin videomu<span class="tind"><i></i><i></i><i></i></span>';
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
                const media = msgMediaOf(loading);
                media.innerHTML = '';
                msgBodyOf(loading).innerHTML = '';
                const tag = document.createElement('div');
                tag.className = 'msg-tag';
                tag.innerText = 'Video AI';
                media.appendChild(tag);
                const v = document.createElement('video');
                v.src = sd.videoUrl;
                v.controls = true;
                v.preload = 'metadata';
                v.classList.add('chat-video');
                media.appendChild(v);
                const actions = document.createElement('div');
                actions.className = 'msg-actions';
                const dl = document.createElement('button');
                dl.className = 'msg-action';
                dl.title = 'Download video';
                dl.innerHTML = '<i class="fa-solid fa-download"></i>';
                dl.onclick = () => downloadImage(sd.videoUrl, 'senka-video-' + Date.now() + '.mp4');
                actions.appendChild(dl);
                media.appendChild(actions);
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
        msgBodyOf(loading).innerText = 'Gagal: ' + e.message;
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
    const rTs = Date.now();
    memoryList.push({ role: 'user', content: [{ type: 'text', text: text }], ts: rTs, time: formatMsgTime(rTs) });
    const userItem = memoryList[memoryList.length - 1];
    if (!supabaseEnabled) saveSessions();
    else remoteSave('user', 'text', text, userItem);
    appendMessage('user', text, false, rTs, formatMsgTime(rTs));
    const confirmMsg = `Oke, saya ingatkan jam ${timeStr}: ${r.what}.`;
    const conf = appendMessage('senka', confirmMsg, false, rTs, formatMsgTime(rTs));
    addMsgActions(conf, 'senka');
    memoryList.push({ role: 'assistant', content: [{ type: 'text', text: confirmMsg }], ts: rTs, time: formatMsgTime(rTs) });
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
            const mTs = Date.now();
            const b = appendMessage('senka', msg, false, mTs, formatMsgTime(mTs));
            addMsgActions(b, 'senka');
            memoryList.push({ role: 'assistant', content: [{ type: 'text', text: msg }], ts: mTs, time: formatMsgTime(mTs) });
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

    if (tebakGame && !base64Image && /^\d{1,2}$/.test(text)) {
        handleTebakGuess(parseInt(text, 10));
        messageInput.value = '';
        return;
    }

    if (text.toLowerCase().startsWith('/senka') && !base64Image) {
        if (await handleSenkaCommand(text)) {
            messageInput.value = '';
            return;
        }
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

    const stickerOnly = extractSticker(text) && !stripStickerTag(text).trim();
    const uTs = Date.now();
    const content = appendMessage('user', stickerOnly ? '' : (text || ''), false, uTs, formatMsgTime(uTs));
    if (extractSticker(text)) {
        appendStickerImg(msgMediaOf(content), extractSticker(text));
    }
    if (base64Image) {
        const img = document.createElement('img');
        img.src = userImgUrl || base64Image;
        img.classList.add('chat-img');
        msgMediaOf(content).appendChild(img);
    }
    memoryList.push({ role: 'user', content: userMessageContent, ts: uTs, time: formatMsgTime(uTs) });
    const userItem = memoryList[memoryList.length - 1];
    if (!supabaseEnabled) saveSessions();
    else {
        remoteSave('user', 'text', text || '[foto]', userItem);
        if (userImgUrl) remoteSave('user', 'image', userImgUrl);
    }

    messageInput.value = '';
    removeImage();
    scrollToBottom(true);

    // Remove greeting container after user sends first message
    const greetingContainer = chatHistoryDOM.querySelector('.message.msg-senka');
    if (greetingContainer) {
        console.log('DEBUG: removing greeting container');
        greetingContainer.remove();
    }

    const jpnMode = speakMode === 'jpn';
    const sendText = jpnMode ? await toJp(text) : text;
    const payload = jpnMode ? await localizeUserMessages(memoryList) : memoryList;
    await streamAssistantReply(await getWebPayload(payload, sendText), jpnMode);
}

/* ===== Bot Command Center (/senka*) ===== */
let tebakGame = null;

function checkPermission(command) {
    const sensitive = ['clear'];
    if (!sensitive.includes(command)) return true;
    return localStorage.getItem('userRole') === 'admin';
}

function secretNote(note) {
    memoryList.push({ role: 'user', hidden: true, content: [{ type: "text", text: note }] });
    return memoryList;
}

async function handleSenkaCommand(text) {
    const low = text.toLowerCase().trim();

    if (low === '/senkaclear') {
        if (!checkPermission('clear')) {
            appendMessage('senka', 'Maaf, kamu tidak punya izin untuk perintah ini!');
            scrollToBottom(true);
            return true;
        }
        clearChat();
        appendMessage('senka', 'Chat dibersihkan oleh admin. 🧹');
        scrollToBottom(true);
        return true;
    }

    if (low.startsWith('/senkaplay ') || low === '/senkaplay') {
        const query = text.slice('/senkaplay'.length).trim();
        const videoId = extractYouTubeId(query);
        if (!query || !videoId) {
            appendMessage('senka', 'Kirim link YouTube ya! Contoh: ' + colorCmd('/senkaplay') + ' https://youtu.be/fE9trKOuT3Q');
            scrollToBottom(true);
            return true;
        }
        musicQueue = [{ id: videoId, url: text.trim() }];
        currentTrackIndex = 0;
        playTrack(0);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User memutar lagu. Berikan respon asik. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }

    if (low.startsWith('/senkaadd ')) {
        const query = text.slice('/senkaadd'.length).trim();
        const videoId = extractYouTubeId(query);
        if (!query || !videoId) {
            appendMessage('senka', 'Kirim link YouTube untuk ditambahkan ya! Contoh: ' + colorCmd('/senkaadd') + ' https://youtu.be/fE9trKOuT3Q');
            scrollToBottom(true);
            return true;
        }
        const wasEmpty = musicQueue.length === 0;
        musicQueue.push({ id: videoId, url: text.trim() });
        appendMessage('senka', 'Ditambahkan ke antrean musik 🎵');
        scrollToBottom(true);
        if (wasEmpty) playTrack(0);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User menambahkan lagu ke antrean musik. Berikan respon asik. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }

    if (low === '/senkalist') {
        if (!musicQueue.length) {
            appendMessage('senka', '📭 Antrean musik masih kosong. Coba ' + colorCmd('/senkaplay') + ' [link YouTube] dulu ya.');
            scrollToBottom(true);
            return true;
        }
        const lines = musicQueue.map((t, i) => {
            const mark = i === currentTrackIndex ? ' (Sedang diputar)' : '';
            return colorLag(i + 1) + ': ' + t.url + mark;
        }).join('\n');
        appendMessage('senka', '🎵 Playlist Antrean:\n' + lines);
        scrollToBottom(true);
        return true;
    }

    if (low === '/senkastop') {
        if (stopTimerInterval) { clearInterval(stopTimerInterval); stopTimerInterval = null; }
        if (ytPlayer) { try { ytPlayer.pauseVideo(); } catch (e) { } }
        musicQueue = [];
        currentTrackIndex = 0;
        isLooping = false;
        resetShuffleState();
        document.getElementById('loop-btn').classList.remove('active');
        const fp = document.getElementById('floating-music-player');
        if (fp) fp.style.display = 'none';
        const mn = document.getElementById('minimized-player');
        if (mn) mn.style.display = 'none';
        appendMessage('senka', '⏹️ Musik dihentikan dan antrean dikosongkan.');
        scrollToBottom(true);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User menghentikan musik. Berikan respon singkat dan natural. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }

    if (low.startsWith('/senkatimer')) {
        const arg = text.slice('/senkatimer'.length).trim();
        if (!arg || arg === 'off' || arg === '0') {
            if (stopTimerInterval) { clearInterval(stopTimerInterval); stopTimerInterval = null; }
            appendMessage('senka', '⏲️ Timer musik dimatikan.');
            scrollToBottom(true);
            return true;
        }
        const total = parseTimerInput(arg);
        if (!total || total < 5) {
            appendMessage('senka', 'Format timer salah. Contoh: ' + colorCmd('/senkatimer') + ' 30 (menit), ' + colorCmd('/senkatimer') + ' 1:30:00 (jam:menit:detik), atau "1 jam 30 menit".');
            scrollToBottom(true);
            return true;
        }
        if (stopTimerInterval) clearInterval(stopTimerInterval);
        stopTimerLeft = total;
        stopTimerInterval = setInterval(() => {
            stopTimerLeft--;
            if (stopTimerLeft <= 0) {
                clearInterval(stopTimerInterval);
                stopTimerInterval = null;
                if (ytPlayer) { try { ytPlayer.pauseVideo(); } catch (e) { } }
                appendMessage('senka', '⏰ Waktu tidur tiba! Musik kuhentikan. Selamat tidur ya~ 💤');
                scrollToBottom(true);
            }
        }, 1000);
        appendMessage('senka', '⏲️ Timer musik: musik akan berhenti dalam ' + formatDuration(total) + '. Selamat tidur ya~ 💤');
        scrollToBottom(true);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User mengatur sleep timer musik. Berikan respon hangat untuk menemani tidurnya. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }
        if (low === '/senkashuffle') {
        const turnedOn = shuffleQueue();
        appendMessage('senka', turnedOn ? '🎵 Playlist berhasil diacak!' : '🔀 Shuffle dimatikan, urutan awal dikembalikan.');
        scrollToBottom(true);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User mengacak antrean musik. Berikan respon asik. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }

    if (low.startsWith('/senkasave')) {
        const name = text.slice('/senkasave'.length).trim() || 'Playlist ' + new Date().toLocaleDateString('id-ID');
        if (!musicQueue.length) {
            appendMessage('senka', '📭 Antrean masih kosong. Isi dulu dengan ' + colorCmd('/senkaplay') + ' atau ' + colorCmd('/senkaadd') + ', baru bisa disimpan.');
            scrollToBottom(true);
            return true;
        }
        const lists = loadPlaylists();
        lists[name] = musicQueue.slice();
        savePlaylists(lists);
        appendMessage('senka', '💾 Playlist "' + name + '" disimpan (' + musicQueue.length + ' lagu).');
        scrollToBottom(true);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User menyimpan playlist musik. Berikan respon asik. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }

    if (low.startsWith('/senkaplaylist')) {
        const name = text.slice('/senkaplaylist'.length).trim();
        const lists = loadPlaylists();
        if (!name) {
            const names = Object.keys(lists);
            if (!names.length) {
                appendMessage('senka', '📚 Belum ada playlist tersimpan. Simpan antrean dulu dengan ' + colorCmd('/senkasave') + ' [nama] ya.');
                scrollToBottom(true);
                return true;
            }
            appendMessage('senka', '📚 Playlist Tersimpan:\n' + names.map(n => '▪ ' + n + ' (' + lists[n].length + ' lagu)').join('\n') + '\n\nPutar dengan ' + colorCmd('/senkaplaylist') + ' [nama]');
            scrollToBottom(true);
            return true;
        }
        if (!lists[name]) {
            appendMessage('senka', 'Playlist "' + name + '" tidak ditemukan. Ketik ' + colorCmd('/senkaplaylist') + ' untuk lihat daftarnya.');
            scrollToBottom(true);
            return true;
        }
        resetShuffleState();
        musicQueue = lists[name].slice();
        currentTrackIndex = 0;
        playTrack(0);
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System: User memutar playlist tersimpan. Berikan respon asik. DILARANG KERAS menyertakan link/URL YouTube di jawabanmu]'), null));
        return true;
    }

    if (low.startsWith('/senkadel')) {
        const name = text.slice('/senkadel'.length).trim();
        const lists = loadPlaylists();
        if (!name || !lists[name]) {
            appendMessage('senka', 'Playlist tidak ditemukan. Contoh: ' + colorCmd('/senkadel') + ' [nama]');
            scrollToBottom(true);
            return true;
        }
        delete lists[name];
        savePlaylists(lists);
        appendMessage('senka', '🗑️ Playlist "' + name + '" dihapus.');
        scrollToBottom(true);
        return true;
    }

    if (low === '/senkagame') {
        startTebakGame();
        if (modelKey) await streamAssistantReply(await getWebPayload(secretNote('[System Note: User baru saja membuka mini-game. Ajak user bermain dengan antusias!]'), null));
        return true;
    }

    if (low === '/senkahelp' || low === '/senka') {
        showCommandListInChat();
        return true;
    }

    return false;
}

function extractYouTubeId(url) {
    const m = String(url).match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    return m ? m[1] : null;
}

/* ===== Floating Music Player (YouTube Iframe API + Queue) ===== */
let musicQueue = [];
let currentTrackIndex = 0;
let isLooping = false;
let ytPlayer = null;
let ytApiReady = false;
let ytApiInjected = false;
let pendingVideoId = null;

window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (pendingVideoId && !ytPlayer) {
        const id = pendingVideoId;
        pendingVideoId = null;
        createYtPlayer(id);
    }
};

function ensureYtApi() {
    if (window.YT && window.YT.Player) return;
    if (ytApiInjected) return;
    ytApiInjected = true;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
}

function createYtPlayer(videoId) {
    ytPlayer = new YT.Player('yt-player-engine', {
        videoId,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1 },
        events: {
            onReady: e => { try { e.target.playVideo(); } catch (err) { } updateTitleFromPlayer(); },
            onStateChange: onPlayerStateChange,
            onError: () => {
                showToast('Video tidak bisa diputar. Coba link lain.');
                if (musicQueue.length > 1) playNext();
            }
        }
    });
}

function updateTitleFromPlayer() {
    if (!ytPlayer) return;
    try {
        const vd = ytPlayer.getVideoData();
        if (vd && vd.title && vd.title !== 'Video unavailable') {
            const label = vd.title + (vd.author ? ' — ' + vd.author : '');
            setFloatingTitle(label);
            try { localStorage.setItem('senka_yt_title_' + vd.video_id, label); } catch (e) { }
        }
    } catch (e) { }
}

let titlePoll = null;

function playTrack(index) {
    if (!musicQueue.length) return;
    currentTrackIndex = ((index % musicQueue.length) + musicQueue.length) % musicQueue.length;
    const videoId = musicQueue[currentTrackIndex].id;
    if (ytPlayer) {
        ytPlayer.loadVideoById(videoId);
    } else if (window.YT && ytApiReady) {
        createYtPlayer(videoId);
    } else {
        pendingVideoId = videoId;
        ensureYtApi();
    }
    showFloatingPlayer(videoId);
    ensureTitleFromPlayer();
}

function showFloatingPlayer(videoId) {
    const player = document.getElementById('floating-music-player');
    if (!player) return;
    player.style.display = 'flex';
    document.getElementById('floating-thumb').src = 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
    setFloatingTitle('Memuat musik...');
    document.getElementById('play-pause-btn').innerHTML = '<i class="fas fa-pause"></i>';
    const titleKey = 'senka_yt_title_' + videoId;
    const cached = localStorage.getItem(titleKey);
    if (cached) setFloatingTitle(cached);
    const fallback = () => setFloatingTitle('Lagu ' + (currentTrackIndex + 1) + ' dari ' + musicQueue.length);
    const applyTitle = d => {
        if (d && d.title) {
            setFloatingTitle(d.title);
            try { localStorage.setItem(titleKey, d.title); } catch (e) { }
        } else {
            fallback();
        }
    };
    fetch('/api/yt-title?id=' + encodeURIComponent(videoId))
        .then(r => r.json())
        .then(applyTitle)
        .catch(() => fetch('https://noembed.com/embed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D' + videoId)
            .then(r => { if (!r.ok) throw 0; return r.json(); })
            .then(applyTitle)
            .catch(fallback));
}

function remeasureMarquee() {
    const title = document.getElementById('floating-title');
    if (!title || !title.firstElementChild) return;
    const w = title.firstElementChild.scrollWidth;
    if (w > 10) title.style.setProperty('--dur', Math.max(6, Math.round(w / 40)) + 's');
}

function setFloatingTitle(text) {
    const title = document.getElementById('floating-title');
    if (!title) return;
    title.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = (text || ' ') + '   •   ' + (text || ' ');
    title.appendChild(span);
    requestAnimationFrame(() => requestAnimationFrame(remeasureMarquee));
}

function ensureTitleFromPlayer() {
    if (titlePoll) return;
    let tries = 0;
    titlePoll = setInterval(() => {
        tries++;
        let label = null;
        try {
            const vd = ytPlayer && ytPlayer.getVideoData ? ytPlayer.getVideoData() : null;
            if (vd && vd.title && vd.title !== 'Video unavailable') {
                label = vd.title + (vd.author ? ' — ' + vd.author : '');
            }
        } catch (e) { }
        if (label) {
            setFloatingTitle(label);
            try { localStorage.setItem('senka_yt_title_' + musicQueue[currentTrackIndex].id, label); } catch (e) { }
            clearInterval(titlePoll);
            titlePoll = null;
        } else if (tries > 20) {
            clearInterval(titlePoll);
            titlePoll = null;
        }
    }, 500);
}

window.addEventListener('resize', () => {
    const title = document.getElementById('floating-title');
    if (title && title.innerText) setFloatingTitle(title.innerText);
});

const PLAYLIST_KEY = 'senka_playlists';

function loadPlaylists() {
    try { return JSON.parse(localStorage.getItem(PLAYLIST_KEY)) || {}; } catch (e) { return {}; }
}

function savePlaylists(lists) {
    try { localStorage.setItem(PLAYLIST_KEY, JSON.stringify(lists)); } catch (e) { }
}

function resetShuffleState() {
    shuffleActive = false;
    queueBackup = [];
    document.getElementById('shuffle-btn').classList.remove('active');
}

function onPlayerStateChange(e) {
    const playBtn = document.getElementById('play-pause-btn');
    if (e.data === YT.PlayerState.PLAYING) {
        if (playBtn) playBtn.innerHTML = '<i class="fas fa-pause"></i>';
        updateTitleFromPlayer();
    } else if (e.data === YT.PlayerState.PAUSED) {
        if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
    } else if (e.data === YT.PlayerState.ENDED) {
        if (isLooping) ytPlayer.playVideo();
        else playNext();
    }
}

function togglePlay() {
    if (!ytPlayer || !musicQueue.length) return;
    const st = ytPlayer.getPlayerState();
    if (st === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
}

function playNext() {
    if (musicQueue.length) playTrack(currentTrackIndex + 1);
}

function playPrev() {
    if (musicQueue.length) playTrack(currentTrackIndex - 1);
}

function toggleLoop() {
    isLooping = !isLooping;
    document.getElementById('loop-btn').classList.toggle('active', isLooping);
}

let shuffleActive = false;
let queueBackup = [];
let stopTimerInterval = null;
let stopTimerLeft = 0;

function parseTimerInput(input) {
    const s = String(input).trim().toLowerCase();
    if (!s) return 0;
    let total = 0;
    const mJ = s.match(/(\d+)\s*(?:jam|h)\b/);
    if (mJ) total += +mJ[1] * 3600;
    const mM = s.match(/(\d+)\s*menit\b/);
    if (mM) total += +mM[1] * 60;
    const mD = s.match(/(\d+)\s*detik\b/);
    if (mD) total += +mD[1];
    if (total) return total;
    const parts = s.split(':').map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2 && parts.every(n => !isNaN(n))) return parts[0] * 60 + parts[1];
    if (parts.length === 1 && !isNaN(parts[0])) return parts[0] * 60;
    return 0;
}

function formatDuration(total) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p = n => String(n).padStart(2, '0');
    if (h) return p(h) + ':' + p(m) + ':' + p(s);
    if (m) return p(m) + ':' + p(s);
    return s + ' detik';
}

function shuffleQueue() {
    if (!musicQueue.length) return false;
    if (!shuffleActive) {
        queueBackup = musicQueue.slice();
        const current = musicQueue[currentTrackIndex];
        const rest = musicQueue.filter((_, i) => i !== currentTrackIndex);
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        musicQueue = [current, ...rest];
        currentTrackIndex = 0;
        shuffleActive = true;
    } else {
        const currentId = musicQueue[currentTrackIndex].id;
        musicQueue = queueBackup;
        currentTrackIndex = Math.max(0, musicQueue.findIndex(t => t.id === currentId));
        shuffleActive = false;
        queueBackup = [];
    }
    document.getElementById('shuffle-btn').classList.toggle('active', shuffleActive);
    return shuffleActive;
}

function minimizePlayer() {
    document.getElementById('floating-music-player').style.display = 'none';
    const min = document.getElementById('minimized-player');
    min.style.display = 'flex';
    min.__dragMoved = false;
}

function maximizePlayer() {
    const min = document.getElementById('minimized-player');
    if (min.__dragMoved) {
        min.__dragMoved = false;
        return;
    }
    min.style.display = 'none';
    document.getElementById('floating-music-player').style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(remeasureMarquee));
}

function makeDraggable(el) {
    let dragging = false;
    let arming = false;
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

    function arm(e) {
        if (e.target.closest('button')) return;
        const t = e.touches ? e.touches[0] : e;
        arming = true;
        dragging = false;
        startX = t.clientX;
        startY = t.clientY;
        baseLeft = el.getBoundingClientRect().left;
        baseTop = el.getBoundingClientRect().top;
        el.__dragMoved = false;
    }

    function startDrag() {
        const rect = el.getBoundingClientRect();
        document.body.appendChild(el);
        el.style.position = 'fixed';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.transform = 'none';
        el.style.margin = '0';
        el.style.width = rect.width + 'px';
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        dragging = true;
    }

    function move(e) {
        if (!arming && !dragging) return;
        const t = e.touches ? e.touches[0] : e;
        if (!dragging) {
            if (Math.abs(t.clientX - startX) < 5 && Math.abs(t.clientY - startY) < 5) return;
            startDrag();
        }
        let left = baseLeft + (t.clientX - startX);
        let top = baseTop + (t.clientY - startY);
        left = Math.min(Math.max(left, 0), window.innerWidth - el.offsetWidth);
        top = Math.min(Math.max(top, 0), window.innerHeight - el.offsetHeight);
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.__dragMoved = true;
        if (e.cancelable) e.preventDefault();
    }

    function end() {
        arming = false;
        dragging = false;
    }

    el.addEventListener('mousedown', arm);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    el.addEventListener('touchstart', arm, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
}

makeDraggable(document.getElementById('floating-music-player'));
makeDraggable(document.getElementById('minimized-player'));

function startTebakGame() {
    tebakGame = { answer: 1 + Math.floor(Math.random() * 10), tries: 0 };
    appendMessage('senka', '🎲 Aku lagi mikirin angka rahasia dari 1 sampai 10. Coba tebak, sayang! (kirim angkanya)');
    scrollToBottom(true);
}

function handleTebakGuess(n) {
    if (!tebakGame) return;
    tebakGame.tries++;
    let msg;
    if (n === tebakGame.answer) {
        msg = `🎉 Benar! Angkanya ${tebakGame.answer}! Kamu jago banget, ${panggilan}! (tebakan ke-${tebakGame.tries})`;
        tebakGame = null;
    } else if (n < tebakGame.answer) {
        msg = `⬆️ Hmm, angkanya lebih besar dari ${n}. Coba lagi!`;
    } else {
        msg = `⬇️ Wah, angkanya lebih kecil dari ${n}. Coba lagi!`;
    }
    appendMessage('senka', msg);
    scrollToBottom(true);
}

function clearChat() {
    if (supabaseEnabled) {
        authHeaders().then(h => {
            memoryList.forEach(m => { if (m.cid) fetch('/api/chats/' + m.cid, { method: 'DELETE', headers: h }).catch(() => { }); });
        });
    }
    memoryList = [];
    tebakGame = null;
    chatHistoryDOM.innerHTML = '';
    if (!supabaseEnabled) saveSessions();
}

function colorCmd(cmd) {
    return '<span style="color: #778899; font-weight: bold;">' + cmd + '</span>';
}

function colorLag(n) {
    return '<span style="color: #B0C4DE; font-weight: bold;">Lagu ' + n + '</span>';
}

function showCommandListInChat() {
    appendMessage('senka', '🤖 Command List:\n' +
        colorCmd('/senkaplay') + ' [link YouTube] — putar musik (full durasi)\n' +
        colorCmd('/senkaadd') + ' [link YouTube] — tambah ke antrean\n' +
        colorCmd('/senkalist') + ' — lihat daftar antrean\n' +
        colorCmd('/senkashuffle') + ' — acak urutan playlist\n' +
        colorCmd('/senkasave') + ' [nama] — simpan antrean jadi playlist\n' +
        colorCmd('/senkaplaylist') + ' [nama] — putar playlist tersimpan\n' +
        colorCmd('/senkadel') + ' [nama] — hapus playlist tersimpan\n' +
        colorCmd('/senkastop') + ' — hentikan musik & kosongkan antrean\n' +
        colorCmd('/senkatimer') + ' [menit / jam:menit:detik] — sleep timer\n' +
        colorCmd('/senkagame') + ' — mini-game tebak angka\n' +
        colorCmd('/senkahelp') + ' — daftar command');
    scrollToBottom(true);
}

function extractOpsi(text) {
    let out = '';
    const options = [];
    const re = /\[Opsi\s*:\s*([^\]]*)\]/gi;
    let last = 0, m;
    while ((m = re.exec(String(text || ''))) !== null) {
        out += text.slice(last, m.index);
        m[1].split('|').forEach(o => {
            const t = o.trim();
            if (t) options.push(t);
        });
        last = m.index + m[0].length;
    }
    out += text.slice(last);
    return { clean: out, options };
}

function appendOpsiButtons(body, options) {
    if (!body || !options || !options.length) return;
    const bar = document.createElement('div');
    bar.className = 'context-btn-container';
    options.forEach(opt => {
        const b = document.createElement('button');
        b.className = 'context-btn';
        b.innerText = opt;
        b.onclick = () => sendMessageFromBtn(b, opt);
        bar.appendChild(b);
    });
    body.appendChild(bar);
}

function sendMessageFromBtn(btnElement, text) {
    messageInput.value = text;
    sendToSenka();
    if (btnElement && btnElement.closest) {
        const container = btnElement.closest('.context-btn-container');
        if (container) container.remove();
    }
}

/* ===== Command List Modal ===== */
function openCommandMenu() {
    document.getElementById('command-menu-modal').style.display = 'flex';
}

function closeCommandMenu() {
    document.getElementById('command-menu-modal').style.display = 'none';
}

function runCommandFromMenu(kind) {
    closeCommandMenu();
    closeSenkaProfile();
    if (kind === 'play') {
        messageInput.value = '/senkaplay ';
        messageInput.focus();
    } else if (kind === 'game') {
        messageInput.value = '/senkagame';
        sendToSenka();
    } else if (kind === 'image') {
        openImageModal();
    } else if (kind === 'info') {
        showCommandListInChat();
    }
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

async function streamAssistantReply(payloadMessages, jpnMode = false) {
    const createdTs = Date.now();
    const msgContent = makeMsgContent('senka', createdTs, formatMsgTime(createdTs));
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'msg-senka');
    const stb = document.createElement('div');
    stb.className = 'msg-body';
    stb.innerHTML = 'Senka ngetik<span class="tind"><i></i><i></i><i></i></span>';
    msgDiv.appendChild(stb);
    msgContent.appendChild(msgDiv);
    const srow = assembleMsgRow('senka', msgContent);
    chatHistoryDOM.appendChild(srow);
    scrollToBottom(true);
    isStreaming = true;

    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: payloadMessages, modelKey, panggilan, useVision: visionAuto, gender: personaGender(), persona: personaPayload(), length: lengthSetting(), lorebook: getActiveLorebook(), mode: storyMode, jpnMode })
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
                        if (!jpnMode) msgBodyOf(msgDiv).innerHTML = mdToHtml(streamBuf);
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
        const opsi = extractOpsi(renderText);

        const rb = msgBodyOf(msgContent);
        if (jpnMode && hasJapaneseText(renderText)) {
            const [cleanId, optsId] = await Promise.all([
                toId(opsi.clean),
                Promise.all((opsi.options || []).map(o => toId(o)))
            ]);
            rb.innerHTML = mdToHtml(cleanId);
            if (stk) appendStickerImg(msgMediaOf(msgContent), stk);
            if (fileReq) rb.appendChild(makeFileCard(fileReq.meta));
            if (!fileReq) appendOpsiButtons(rb, optsId);
        } else {
            rb.innerHTML = mdToHtml(opsi.clean);
            if (stk) appendStickerImg(msgMediaOf(msgContent), stk);
            if (fileReq) rb.appendChild(makeFileCard(fileReq.meta));
            if (!fileReq) appendOpsiButtons(rb, opsi.options);
        }
        addMsgActions(msgContent, 'senka');

        memoryList.push({ role: 'assistant', content: [{ type: "text", text: displayText }], ts: createdTs, time: formatMsgTime(createdTs) });
        const aiItem = memoryList[memoryList.length - 1];
        attachAiActions(msgContent, aiItem, true);
        if (!supabaseEnabled) saveSessions();
        else remoteSave('senka', 'text', displayText, aiItem);
        shrinkMemoryImages();
        if (autospeak && !fileReq) speak(opsi.clean);
    } catch (error) {
        if (error.message === 'empty') {
            memoryList.pop();
            saveSessions();
            const sr = msgContent.closest('.msg-row');
            if (sr) sr.remove(); else msgContent.remove();
            return;
        }
        const errContent = makeMsgContent('senka');
        const errBubble = document.createElement('div');
        errBubble.classList.add('message', 'msg-senka');
        const ebody = document.createElement('div');
        ebody.className = 'msg-body';
        ebody.innerHTML = `Waduh error: ${error.message.replace(/</g, '&lt;')} — <span class="retry-btn" onclick="retryLast()">coba lagi</span>`;
        errBubble.appendChild(ebody);
        errContent.appendChild(errBubble);
        const er = msgContent.closest('.msg-row');
        if (er) { msgContent.remove(); er.appendChild(errContent); }
        else msgContent.replaceWith(errContent);
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
    const content = meta.content || '';
    const sizeKb = Math.max(1, Math.round(content.length / 1024));
    const isTable = looksLikeTable(content);
    const card = document.createElement('div');
    card.className = 'file-card';
    const iconMap = { txt: 'fa-file-lines', csv: 'fa-table', xlsx: 'fa-file-excel', excel: 'fa-file-excel', doc: 'fa-file-word', docx: 'fa-file-word', pdf: 'fa-file-pdf' };
    const btns = [
        { fmt: 'pdf', icon: 'fa-file-pdf', label: 'Download PDF' },
        { fmt: 'doc', icon: 'fa-file-word', label: 'Download Word' }
    ];
    if (isTable || ['csv', 'xlsx', 'excel'].includes(type)) {
        btns.push({ fmt: 'xlsx', icon: 'fa-file-excel', label: 'Download Excel' });
    }
    btns.push({ fmt: 'txt', icon: 'fa-file-lines', label: 'Download TXT' });
    card.innerHTML = `<div class="fc-icon"><i class="fa-solid ${iconMap[type] || 'fa-file'}"></i></div>
        <div class="fc-info">
            <div class="fc-name"></div>
            <div class="fc-meta">${type.toUpperCase()} · ${sizeKb} KB · ${isTable ? 'berisi tabel' : 'siap diunduh'}</div>
            <div class="fc-actions">${btns.map(b => `<button class="fc-btn" data-fmt="${b.fmt}"><i class="fa-solid ${b.icon}"></i> ${b.label}</button>`).join('')}</div>
        </div>`;
    card.querySelector('.fc-name').innerText = name;
    card.querySelectorAll('.fc-btn').forEach(b => {
        b.onclick = () => downloadGeneratedFile(meta, b.dataset.fmt);
    });
    return card;
}

function nameWithoutExt(n) {
    return String(n).replace(/\.(txt|csv|xlsx|excel|doc|docx|pdf)$/i, '');
}

function looksLikeTable(content) {
    const s = String(content || '').replace(/```[\s\S]*?```/g, '');
    const lines = s.split('\n').filter(l => l.trim());
    if (lines.length < 2) return false;
    const sepRe = /^\s*\|?\s*:?-{2,}\s*(\|\s*:?-{2,}\s*)+\|?\s*$/;
    if (lines.some(l => sepRe.test(l))) return true;
    const pipeLines = lines.filter(l => l.includes('|'));
    return pipeLines.length >= 2 && pipeLines.length / lines.length >= 0.8;
}

function parseTableRows(content) {
    const rows = [];
    const sepRe = /^\s*\|?\s*:?-{2,}\s*(\|\s*:?-{2,}\s*)+\|?\s*$/;
    for (const line of String(content || '').split('\n')) {
        const t = line.trim();
        if (!t || sepRe.test(t)) continue;
        if (!t.includes('|')) {
            if (rows.length) rows.push([t]);
            continue;
        }
        rows.push(t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
    }
    return rows;
}

function downloadGeneratedFile(meta, format) {
    const type = (meta.type || 'txt').toLowerCase();
    const name = (meta.name || 'file-senka').trim();
    const content = meta.content || '';
    const hasCJK = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(content);
    const fmt = (format || type).toLowerCase();

    if (fmt === 'pdf') {
        if (!window.jspdf) { showToast('Library PDF belum siap, coba lagi.'); return; }
        if (hasCJK) {
            downloadWord(name, content);
            return;
        }
        const doc = new window.jspdf.jsPDF();
        const lines = doc.splitTextToSize(content, 185);
        let y = 14;
        lines.forEach(l => {
            if (y > 282) { doc.addPage(); y = 14; }
            doc.setFontSize(11);
            doc.text(l, 10, y);
            y += 6;
        });
        doc.save(nameWithoutExt(name) + '.pdf');
        return;
    }

    if (fmt === 'xlsx' || fmt === 'excel') {
        const rows = looksLikeTable(content) ? parseTableRows(content) : content.split('\n').map(l => l.split(',')).filter(r => r.some(c => c.trim() !== ''));
        loadSheetJS(() => {
            const ws = XLSX.utils.aoa_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            XLSX.writeFile(wb, nameWithoutExt(name) + '.xlsx');
        });
        return;
    }

    if (fmt === 'csv') {
        const rows = looksLikeTable(content) ? parseTableRows(content) : content.split('\n').map(l => l.split(',')).filter(r => r.some(c => c.trim() !== ''));
        const blob = new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
        saveBlob(blob, nameWithoutExt(name) + '.csv');
        return;
    }

    if (fmt === 'doc' || fmt === 'docx') {
        downloadWord(name, content);
        return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    saveBlob(blob, nameWithoutExt(name) + '.txt');
}

function downloadWord(name, content) {
    const safe = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<html><head><meta charset="utf-8"><title>${name}</title></head><body>${safe.split('\n').map(l => `<p>${l}</p>`).join('')}</body></html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
    saveBlob(blob, nameWithoutExt(name) + '.doc');
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
            const media = msgMediaOf(loading);
            media.innerHTML = '';
            msgBodyOf(loading).innerHTML = '';
            media.appendChild(tag);
            let imgSrc = data.url;
            const finishImage = () => {
                const img = document.createElement('img');
                img.src = imgSrc;
                img.classList.add('chat-img');
                img.alt = prompt;
                img.onerror = () => { msgBodyOf(loading).innerText = 'Gagal memuat gambar. Coba lagi.'; };
                media.appendChild(img);
                const actions = document.createElement('div');
                actions.className = 'msg-actions';
                const dl = document.createElement('button');
                dl.className = 'msg-action';
                dl.title = 'Download gambar';
                dl.innerHTML = '<i class="fa-solid fa-download"></i>';
                dl.onclick = () => downloadImage(imgSrc, 'senka-' + prompt.slice(0, 25).replace(/[^a-zA-Z0-9]+/g, '_') + '.jpg');
                actions.appendChild(dl);
                media.appendChild(actions);
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
            msgBodyOf(loading).innerText = 'Gagal: ' + e.message;
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

function renderRich(text) {
    if (!text) return '';
    const spans = [];
    const s = protectColorSpans(text, spans);
    return escapeHtml(s).replace(/\uE000CLR(\d+)\uE001/g, (m, i) => spans[+i]);
}

function appendMessage(role, text, isTypewriter = false, ts, timeStr) {
    const content = makeMsgContent(role, ts, timeStr);
    if (text) {
        const bubble = document.createElement('div');
        bubble.classList.add('message', role === 'user' ? 'msg-user' : 'msg-senka');
        const body = document.createElement('div');
        body.className = 'msg-body';
        body.innerHTML = renderRich(text);
        bubble.appendChild(body);
        content.appendChild(bubble);
    }
    if (!isTypewriter) {
        chatHistoryDOM.appendChild(assembleMsgRow(role, content));
        scrollToBottom(true);
    }
    return content;
}

function scrollToBottom(smooth = false) {
    chatHistoryDOM.scrollTo({ top: chatHistoryDOM.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendToSenka(); });
document.getElementById('image-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generateImage();
});
document.getElementById('search-input').addEventListener('input', doSearch);

const BG_BRIGHTNESS_KEY = 'senka_bg_brightness';

function applyBgBrightness(v) {
    const w = document.getElementById('wallpaper');
    if (w) w.style.filter = 'brightness(' + v + '%)';
}

function initBgBrightness() {
    const slider = document.getElementById('bg-brightness-input');
    if (!slider) return;
    const saved = localStorage.getItem(BG_BRIGHTNESS_KEY);
    const val = saved !== null ? Math.max(10, Math.min(100, parseInt(saved, 10) || 50)) : 50;
    slider.value = val;
    applyBgBrightness(val);
    slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        applyBgBrightness(v);
        localStorage.setItem(BG_BRIGHTNESS_KEY, String(v));
    });
}

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
