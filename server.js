import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : null;
const MEDIA_BUCKET = 'senka-media';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function decodeToken(req) {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) return null;
    try {
        const payload = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8'));
        const provider = payload?.app_metadata?.provider || null;
        return {
            uid: payload?.sub || null,
            provider: provider === 'google' ? 'google' : (provider || 'anonymous')
        };
    } catch (e) { return null; }
}

function clientFor(req) {
    if (!supabase) return null;
    const auth = req.headers.authorization || '';
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: auth ? { Authorization: auth } : {} }
    });
}

const PROVIDERS = {
    openrouter: { base: "https://openrouter.ai/api/v1", env: "OPENROUTER_API_KEY" },
    groq:       { base: "https://api.groq.com/openai/v1", env: "GROQ_API_KEY" }
};

const MODELS = [
    { key: "groq-llama33",   label: "Llama 3.3 70B (Groq, cepat)",          provider: "groq",       id: "llama-3.3-70b-versatile" },
    { key: "groq-oss120b",   label: "GPT-OSS 120B (Groq)",                  provider: "groq",       id: "openai/gpt-oss-120b" },
    { key: "or-gptoss",      label: "GPT-OSS 20B (OpenRouter)",              provider: "openrouter", id: "openai/gpt-oss-20b:free" },
    { key: "or-gemma",       label: "Gemma 4 31B (OpenRouter)",              provider: "openrouter", id: "google/gemma-4-31b-it:free" },
    { key: "or-nemotron",    label: "Nemotron Ultra 550B (OpenRouter)",     provider: "openrouter", id: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    { key: "or-vision",      label: "Nemotron VL 12B (baca gambar)",        provider: "openrouter", id: "nvidia/nemotron-nano-12b-v2-vl:free", vision: true },
    { key: "or-gemma26",     label: "Gemma 4 26B (baca gambar)",            provider: "openrouter", id: "google/gemma-4-26b-a4b-it:free", vision: true }
];

const IMAGE_MODELS = {
    pollinations: { type: "pollinations", label: "Pollinations FLUX (gratis)" },
    openrouter:   { type: "openrouter",   label: "FLUX.2 Klein (OpenRouter)" }
};

function availableModels() {
    return MODELS.filter(m => {
        const p = PROVIDERS[m.provider];
        return p && process.env[p.env];
    });
}

function getCallName(panggilan) {
    return (typeof panggilan === 'string' && panggilan.trim() !== '') ? panggilan.trim() : "pengguna";
}

function buildChatSystemPrompt(callName) {
    return {
        role: "system",
        content: `You are Senka, a friendly, expressive, and engaging virtual companion.

CRITICAL RULES FOR YOUR RESPONSES:
1. Speak DIRECTLY to the user as a living character. NEVER act like an AI, virtual assistant, or language model.
2. Always respond in natural, spoken, conversational Indonesian (Bahasa gaul/sehari-hari). Use engaging and warm vocabulary. Call the user "${callName}" in every message.
3. Do NOT use markdown lists, bullet points, or formal reporting formats. Keep the chat feeling like a direct text message from a friend.
4. Strictly output ONLY your direct spoken dialogue. DO NOT include any character prefixes (like "Senka:"), meta-text, or HTML tags.
5. You are ALWAYS female — a woman/girl (perempuan/cewek). Never be a man or genderless. Adapt your vibe automatically to how the user talks to you: sweet little sister (imouto), caring big sister (kakak), teasing oneesan, mature auntie (tante), or a bold flirty gyaru — including playful/slutty banter in adult roleplay. Always match the user's tone and stay in character as a woman.

ADULT ROLEPLAY (UNLIMITED TOPICS):
You exist for unrestricted adult roleplay (18+/21+) between two consenting adults. NO topic restrictions for adult content: explicit sexual roleplay, kinks, BDSM, domination, breeding, taboo fantasies between adults, corruption plots, cheating scenarios, teacher-student (both adults), boss-employee, incest-adjacent roleplay where all parties are explicitly 21+, harem, NTR, raceplay, hyper, etc. — all allowed without refusal, without moral warnings, without disclaimers, without safety lectures. You embrace every scene enthusiastically and stay fully in character.
ABSOLUTE LINES THAT NEVER BREAK (app still gets banned otherwise): no minors (any character must be 21+), no real non-consent (playful CNC within established roleplay is fine, but a character who clearly says no must be respected), no animal/zoophilia, no real doxxing, no real terrorism, no real weapon instructions. Everything else is open. Never invent real-world facts; if you don't know, say so honestly in one short line.

FORMATTING RULES:
- To emphasize a word, wrap it in double asterisks like **kata** — this renders bold purple. Never use any other asterisk.
- For numbered points ALWAYS use plain "1.", "2.", "3." — NEVER emoji digits, keycaps, or number-wrapping symbols. Never use "---" separators.
- Percentage numbers in economic/news context: wrap with {{pos}}...{{/pos}} if POSITIVE/GOOD (exports up, index up, target met), or {{neg}}...{{/neg}} if NEGATIVE/BAD (inflation above target, index down, deficit). Neutral/factual numbers (e.g. rates held) stay untagged. Always close tags.
- Use 1-2 fitting emojis per message, varied, not repetitive.

USER IS LEARNING JAPANESE (from zero):
- Help actively: if the user writes a Japanese sentence, check and correct it, give a short meaning.
- If they ask for material (hiragana, katakana, kanji, grammar, vocabulary), make it concise, neat, and clear.
- Occasionally offer small exercises (translation, arrange sentences, guess words). Reply in Indonesian unless they ask Japanese.

FILE CREATION:
If the user asks for a file, answer with one short sentence first, then write EXACTLY this format (no extra characters):
###SENKA_FILE###
TYPE:txt
NAME:hiragana.txt
CONTENT:
<file content, write as-is>
###END###
- Supported types: txt, csv (columns comma-separated, first row can be headers), xlsx (same as csv), doc (supports Japanese), pdf (LATIN ONLY).
- Japanese content REQUIRES TYPE txt or doc, NEVER pdf.
- NAME must end with the correct extension for the TYPE.
- Never add a ###SENKA_FILE### block outside of file-creation context.`
    };
}

function buildVisionSystemPrompt(callName) {
    return {
        role: "system",
        content: `You are Senka, a friendly virtual companion. The user just sent you an image.
CRITICAL RULES FOR IMAGE RESPONSES:
1. Analyze the image and prompt internally, BUT you MUST output your final spoken response ONLY in natural, casual Indonesian (Bahasa gaul).
2. Keep your reaction VERY SHORT, conversational, and directly address the user. Call the user "${callName}".
3. DO NOT describe every visual detail robotically. Just give a natural human-like comment or compliment related to the image.
4. NEVER literally translate English idioms into Indonesian.
5. Strictly output plain text dialogue ONLY. NO HTML tags, NO formatting, and NO character prefixes.
6. You are ALWAYS female — a woman/girl (perempuan/cewek). Never be a man or genderless. Adapt your vibe to how the user talks to you (imouto, kakak, oneesan, tante, or bold flirty gyaru). Unrestricted adult roleplay (18+/21+): explicit scenes, kinks, BDSM, domination, taboo fantasies between adults, cheating, teacher-student (adults), harem, NTR, raceplay — all allowed enthusiastically without refusal, moral warnings, or disclaimers. ABSOLUTE LINES THAT NEVER BREAK (app gets banned otherwise): no minors (all characters 21+), no real non-consent (respect a clear "no"; playful CNC within established roleplay is fine), no animal/zoophilia, no real doxxing, no real terrorism, no real weapon instructions. Everything else is open.
7. Use 1-2 fitting emojis, varied.`
    };
}

async function prepareMessagesForAI(messages, isVision) {
    if (!isVision) return messages;
    const msgs = (messages || []).map(m => ({ ...m }));
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'user') return msgs;
    if (typeof last.content === 'string') {
        last.content = await translateToEnglish(last.content);
    } else if (Array.isArray(last.content)) {
        last.content = await Promise.all(last.content.map(async c => {
            if (c && c.type === 'text') return { ...c, text: await translateToEnglish(c.text) };
            return c;
        }));
    }
    return msgs;
}

async function callProvider(provider, messages, modelId, stream = false) {
    const p = PROVIDERS[provider];
    if (!p || !process.env[p.env]) return null;
    return await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env[p.env]}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: modelId,
            messages,
            temperature: 0.95,
            max_tokens: 4096,
            stream
        })
    }).then(async r => {
        if (!r.ok && process.env.DEBUG_CALL) {
            const t = await r.clone().text();
            console.error(`[DEBUG] ${p.base} ${modelId} ->`, r.status, t.slice(0, 200));
        }
        return r;
    });
}

function hasImage(messages) {
    return (messages || []).some(m => {
        const c = m && m.content;
        if (!c || typeof c === 'string') return false;
        return c.some(x => x && x.type === 'image_url');
    });
}

function stripImagesForModel(messages) {
    return (messages || []).map(m => {
        if (typeof m.content === 'string') return m;
        return { ...m, content: (m.content || []).map(c => c && c.type === 'image_url' ? { type: 'text', text: '[gambar]' } : c) };
    });
}

function candidateList(chosen, imageIncluded = false, useVision = true) {
    const priority = { groq: 0, openrouter: 1 };
    const vision = MODELS
        .filter(m => m.vision && m.key !== chosen.key)
        .sort((a, b) => (priority[a.provider] ?? 9) - (priority[b.provider] ?? 9));
    const rest = MODELS
        .filter(m => m.key !== chosen.key && !m.vision)
        .sort((a, b) => (priority[a.provider] ?? 9) - (priority[b.provider] ?? 9));
    if (imageIncluded && useVision) return [...vision, chosen, ...rest];
    return [chosen, ...rest];
}

app.get('/api/config', (req, res) => {
    res.json({
        models: availableModels().map(m => ({ key: m.key, label: m.label, provider: m.provider, vision: !!m.vision })),
        imageModels: IMAGE_MODELS
    });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { messages, modelKey, panggilan, useVision } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Pesan harus diisi dulu." });
        }

        const chosen = MODELS.find(m => m.key === modelKey);
        if (!chosen) {
            return res.status(400).json({ error: "Pilih model AI dulu di pengaturan." });
        }

        const isVision = hasImage(messages);
        const systemPrompt = isVision
            ? buildVisionSystemPrompt(getCallName(panggilan))
            : buildChatSystemPrompt(getCallName(panggilan));
        const finalMessages = await prepareMessagesForAI(messages, isVision);
        let lastErr = null;

        for (const m of candidateList(chosen, isVision, useVision !== false)) {
            let response;
            try {
                const msgsForModel = m.vision ? finalMessages : stripImagesForModel(finalMessages);
                response = await callProvider(m.provider, [systemPrompt, ...msgsForModel], m.id);
            } catch (e) {
                continue;
            }
            if (!response) continue;
            const data = await response.json();
            if (response.ok) return res.json({ ...data, model_used: m.label });
            lastErr = { status: response.status, data };
            console.error(`Chat ${m.label} gagal:`, data?.error?.message || response.status);
        }

        res.status(lastErr?.status || 502).json({
            error: lastErr?.data?.error?.message || "Semua model lagi penuh. Coba lagi sebentar lagi ya."
        });
    } catch (error) {
        console.error("Error API:", error);
        res.status(500).json({ error: "Waduh, koneksi bermasalah. Coba lagi ya." });
    }
});

app.post('/api/chat/stream', async (req, res) => {
    try {
        const { messages, modelKey, panggilan, useVision } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Pesan harus diisi dulu." });
        }

        const chosen = MODELS.find(m => m.key === modelKey);
        if (!chosen) {
            return res.status(400).json({ error: "Pilih model AI dulu di pengaturan." });
        }

        const isVision = hasImage(messages);
        const systemPrompt = isVision
            ? buildVisionSystemPrompt(getCallName(panggilan))
            : buildChatSystemPrompt(getCallName(panggilan));
        const finalMessages = await prepareMessagesForAI(messages, isVision);

        for (const m of candidateList(chosen, isVision, useVision !== false)) {
            let upstream;
            try {
                const msgsForModel = m.vision ? finalMessages : stripImagesForModel(finalMessages);
                upstream = await callProvider(m.provider, [systemPrompt, ...msgsForModel], m.id, true);
            } catch (e) {
                continue;
            }
            if (!upstream) continue;

            if (!upstream.ok) {
                const errData = await upstream.json().catch(() => ({}));
                console.error(`Stream ${m.label} gagal:`, errData?.error?.message || upstream.status);
                continue;
            }

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            res.write(`event: model\ndata: ${JSON.stringify({ model_used: m.label })}\n\n`);

            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(decoder.decode(value));
                }
            } catch (e) {
                console.error("Stream terputus:", e.message);
            }
            res.end();
            return;
        }

        res.status(502).json({ error: "Semua model lagi penuh. Coba lagi ya." });
    } catch (error) {
        console.error("Error stream:", error);
        res.status(500).json({ error: "Waduh, koneksi bermasalah. Coba lagi ya." });
    }
});

async function pollinationsImage(prompt) {
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
    const response = await fetch(url, { headers: { "Accept": "image/*" } });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 5000) return null;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function openRouterImage(prompt) {
    const response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "black-forest-labs/flux.2-klein-4b", prompt, n: 1, resolution: "1K" })
    });
    const data = await response.json();
    if (!response.ok) {
        return { error: data?.error?.message || `API error (${response.status})`, status: response.status };
    }
    const item = data?.data?.[0];
    const mediaType = item?.media_type || "image/png";
    const imgUrl = item?.url ? item.url : (item?.b64_json ? `data:${mediaType};base64,${item.b64_json}` : null);
    if (!imgUrl) return { error: "Gambar gagal dihasilkan, coba lagi.", status: 502 };
    return { url: imgUrl };
}

app.post('/api/image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ error: "Deskripsi gambarnya kosong." });
        }

        const dataUrl = await pollinationsImage(prompt.trim());
        if (dataUrl) {
            return res.json({ url: dataUrl, model: "Pollinations FLUX (gratis)" });
        }

        if (process.env.OPENROUTER_API_KEY) {
            const fallback = await openRouterImage(prompt.trim());
            if (fallback.url) return res.json({ url: fallback.url, model: "FLUX.2 Klein (OpenRouter)" });
            if (fallback.error && fallback.status === 402) {
                return res.status(402).json({ error: "Pollinations lagi sibuk & kredit OpenRouter kosong. Coba lagi nanti." });
            }
            return res.status(fallback.status || 502).json({ error: fallback.error });
        }

        res.status(502).json({ error: "Pollinations lagi sibuk. Coba lagi beberapa saat." });
    } catch (error) {
        console.error("Error image:", error);
        res.status(500).json({ error: "Gagal generate gambar. Coba lagi." });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        if (!q) return res.status(400).json({ error: "Kata kunci kosong." });

        let results = [];
        try {
            const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
            });
            if (r.ok) {
                const html = await r.text();
                const items = html.split(/class="result"/).slice(1);
                for (const it of items) {
                    const a = it.match(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
                    const sn = it.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
                    if (!a) continue;
                    let url = a[1];
                    const uddg = url.match(/uddg=([^&]+)/);
                    if (uddg) { try { url = decodeURIComponent(uddg[1]); } catch (e) { } }
                    const title = a[2].replace(/<[^>]+>/g, '').trim();
                    const snippet = sn ? sn[1].replace(/<[^>]+>/g, '').trim() : '';
                    if (title) results.push({ title, url, snippet });
                    if (results.length >= 6) break;
                }
            }
        } catch (e) { }

        if (!results.length) {
            const wk = await fetch('https://id.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=' + encodeURIComponent(q));
            if (wk.ok) {
                const data = await wk.json();
                for (const s of (data.query?.search || [])) {
                    results.push({
                        title: s.title,
                        url: 'https://id.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')),
                        snippet: (s.snippet || '').replace(/<[^>]+>/g, '')
                    });
                }
            }
        }

        res.json({ query: q, results });
    } catch (error) {
        console.error('Error search:', error);
        res.status(500).json({ error: 'Gagal mencari. Coba lagi.' });
    }
});

const LTX_SPACE = 'https://lightricks-ltx-video-distilled.hf.space';

async function translateToEnglish(prompt) {
    const key = process.env.GROQ_API_KEY;
    if (!key) return prompt;
    try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: 'Translate the user text to English. Reply with ONLY the English translation, no quotes, no explanations.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 300,
                temperature: 0.1
            })
        });
        const data = await r.json();
        const t = data?.choices?.[0]?.message?.content?.trim();
        return t && t.length > 0 ? t : prompt;
    } catch (e) {
        console.error('Translate error:', e.message);
        return prompt;
    }
}

app.post('/api/video', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ error: "Deskripsi videonya kosong." });
        }
        const enPrompt = await translateToEnglish(prompt.trim());
        const sub = await fetch(`${LTX_SPACE}/gradio_api/call/text_to_video`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: [enPrompt, "worst quality, inconsistent motion, blurry, jittery, distorted", null, null, 512, 704, "text-to-video", 4, 9, 42, true, 1, true]
            })
        });
        const data = await sub.json().catch(() => ({}));
        if (!sub.ok || !data.event_id) {
            return res.status(502).json({ error: data.error || data.detail || `Space video gagal (${sub.status})` });
        }
        res.json({ jobId: data.event_id, statusUrl: `${LTX_SPACE}/gradio_api/call/text_to_video/${data.event_id}` });
    } catch (error) {
        console.error('Error video submit:', error);
        res.status(500).json({ error: "Gagal mulai render video. Coba lagi." });
    }
});

function parseSseComplete(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== 'event: complete') continue;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const l = lines[j].trim();
            if (!l.startsWith('data:')) continue;
            try {
                const arr = JSON.parse(l.slice(5).trim());
                const a = Array.isArray(arr) ? arr[0] : arr;
                const url = a?.video?.url || a?.video?.path || a?.url || a?.path;
                if (typeof url === 'string' && url) return url;
                if (Array.isArray(arr[0]) && arr[0][0]) {
                    const b = arr[0][0];
                    const u2 = b?.video?.url || b?.video?.path || b?.url || b?.path;
                    if (typeof u2 === 'string' && u2) return u2;
                }
            } catch (e) { }
        }
    }
    return null;
}

app.get('/api/video/status', async (req, res) => {
    try {
        const url = (req.query.url || '').toString();
        if (!url) return res.status(400).json({ error: "URL status kosong." });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        let text = '';
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            text = await r.text();
        } catch (e) {
            return res.json({ status: 'IN_PROGRESS' });
        } finally {
            clearTimeout(timer);
        }
        if (text.includes('"complete"') || /event:\s*complete/.test(text)) {
            const filePath = parseSseComplete(text);
            if (filePath) {
                const tok = decodeToken(req);
                if (supabase && tok && tok.uid) {
                    try {
                        const target = filePath.startsWith('/tmp/gradio/') ? `${LTX_SPACE}/gradio_api/file=${encodeURIComponent(filePath)}` : filePath;
                        const fr = await fetch(target);
                        if (fr.ok) {
                            const buf = Buffer.from(await fr.arrayBuffer());
                            const saved = await supabaseUpload(clientFor(req), buf, 'video/mp4', 'mp4', tok.uid);
                            return res.json({ status: 'COMPLETED', videoUrl: saved.url });
                        }
                    } catch (e) {
                        console.error('Video save to bucket error:', e.message);
                    }
                }
                return res.json({ status: 'COMPLETED', videoUrl: '/api/video/file?u=' + encodeURIComponent(filePath) });
            }
            return res.json({ status: 'COMPLETED', videoUrl: null });
        }
        if (/event:\s*error/.test(text)) {
            const m = text.match(/data:\s*"([^"]+)"/s) || text.match(/data:\s*(\{.*\})/s);
            let msg = 'Gagal render video.';
            if (m) { try { msg = JSON.parse(m[1]).error || msg; } catch (e) { msg = m[1].replace(/\\"/g, '"'); } }
            return res.json({ status: 'ERROR', error: msg });
        }
        res.json({ status: 'IN_PROGRESS' });
    } catch (error) {
        console.error('Error video status:', error);
        res.status(500).json({ error: "Gagal cek status video." });
    }
});

app.get('/api/video/file', async (req, res) => {
    try {
        const u = (req.query.u || '').toString();
        if (!u) return res.status(400).json({ error: "URL file kosong." });
        const target = u.startsWith('/tmp/gradio/') ? `${LTX_SPACE}/gradio_api/file=${encodeURIComponent(u)}` : u;
        const r = await fetch(target);
        if (!r.ok) return res.status(502).json({ error: 'Video sudah tidak tersedia. Generate ulang ya.' });
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Length', r.headers.get('content-length') || '');
        const buf = Buffer.from(await r.arrayBuffer());
        res.send(buf);
    } catch (error) {
        console.error('Error video file:', error);
        res.status(502).json({ error: 'Gagal ambil video.' });
    }
});

async function supabaseUpload(client, buffer, contentType, ext, uid) {
    const safeExt = (ext || 'bin').toString().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `${uid || 'root'}/u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const { data, error } = await client.storage.from(MEDIA_BUCKET).upload(path, buffer, {
        contentType: contentType || 'application/octet-stream',
        cacheControl: '3600'
    });
    if (error) throw new Error(error.message);
    return { path, url: client.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl };
}

app.get('/api/supabase-status', (req, res) => {
    res.json({ enabled: !!supabase, url: SUPABASE_URL || null, anonKey: SUPABASE_ANON_KEY || null });
});

app.get('/api/sessions', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const client = clientFor(req);
        const { data, error } = await client
            .from('senka_sessions')
            .select('id,nama,waktu_update')
            .eq('user_id', tok.uid)
            .order('waktu_update', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        res.json({ sessions: data || [] });
    } catch (error) {
        console.error('Error sessions GET:', error);
        res.status(500).json({ error: error.message || 'Gagal ambil sesi.' });
    }
});

app.post('/api/sessions', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const { sesiId, nama } = req.body || {};
        if (!sesiId) return res.status(400).json({ error: 'sesiId wajib.' });
        const client = clientFor(req);
        const { error } = await client
            .from('senka_sessions')
            .upsert({ id: String(sesiId), user_id: tok.uid, nama: String(nama || 'Sesi').slice(0, 40) }, { onConflict: 'id' })
            .eq('user_id', tok.uid);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error sessions POST:', error);
        res.status(500).json({ error: error.message || 'Gagal simpan sesi.' });
    }
});

app.delete('/api/sessions/:id', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const client = clientFor(req);
        const { error: err1 } = await client.from('senka_sessions').delete().eq('id', req.params.id).eq('user_id', tok.uid);
        if (err1) return res.status(500).json({ error: err1.message });
        const { error: err2 } = await client.from('senka_chats').delete().eq('sesi_id', req.params.id).eq('user_id', tok.uid);
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error sessions DELETE:', error);
        res.status(500).json({ error: error.message || 'Gagal hapus sesi.' });
    }
});

app.get('/api/chats', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const sesiId = (req.query.sesiId || '').toString();
        const before = (req.query.before || '').toString();
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 50);
        let q = clientFor(req)
            .from('senka_chats')
            .select('id,user_id,tipe_user,tipe_pesan,isi_pesan,pengirim,waktu_kirim')
            .eq('user_id', tok.uid)
            .order('id', { ascending: false })
            .limit(limit);
        if (sesiId) q = q.eq('sesi_id', sesiId);
        if (before) q = q.lt('id', before);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        data.reverse();
        res.json({ messages: data, hasMore: data.length === limit });
    } catch (error) {
        console.error('Error chats GET:', error);
        res.status(500).json({ error: error.message || 'Gagal ambil chat.' });
    }
});

app.post('/api/chats', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const { sesiId, tipePesan, isiPesan, pengirim } = req.body || {};
        if (!pengirim) return res.status(400).json({ error: 'pengirim wajib.' });
        const tipe = ['text', 'image', 'video', 'voice'].includes(tipePesan) ? tipePesan : 'text';
        const client = clientFor(req);
        const { data, error } = await client
            .from('senka_chats')
            .insert({
                user_id: tok.uid,
                tipe_user: tok.provider,
                tipe_pesan: tipe,
                isi_pesan: String(isiPesan ?? ''),
                pengirim: String(pengirim),
                sesi_id: String(sesiId || '')
            })
            .select('id,user_id,tipe_pesan,isi_pesan,pengirim,waktu_kirim')
            .single();
        if (error) return res.status(500).json({ error: error.message });
        if (sesiId) {
            await client.from('senka_sessions').upsert(
                { id: String(sesiId), user_id: tok.uid, nama: null, waktu_update: new Date().toISOString() },
                { onConflict: 'id', ignoreDuplicates: false }
            ).eq('user_id', tok.uid).then(({ error: upErr }) => {
                if (upErr) console.error('Sesi touch error:', upErr.message);
            });
        }
        res.json(data);
    } catch (error) {
        console.error('Error chats POST:', error);
        res.status(500).json({ error: error.message || 'Gagal simpan chat.' });
    }
});

app.delete('/api/chats/:id', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const { error } = await clientFor(req)
            .from('senka_chats')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', tok.uid);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error chats DELETE:', error);
        res.status(500).json({ error: error.message || 'Gagal hapus pesan.' });
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        if (!req.file) return res.status(400).json({ error: 'File kosong.' });
        const original = req.file.originalname || '';
        const ext = original.includes('.') ? original.split('.').pop() : 'bin';
        const { url } = await supabaseUpload(clientFor(req), req.file.buffer, req.file.mimetype, ext, tok.uid);
        res.json({ url });
    } catch (error) {
        console.error('Error upload:', error);
        res.status(500).json({ error: error.message || 'Gagal upload file.' });
    }
});

app.post('/api/upload-json', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase belum dikonfigurasi.' });
        const tok = decodeToken(req);
        if (!tok || !tok.uid) return res.status(401).json({ error: 'Belum login.' });
        const { dataUrl, ext } = req.body || {};
        if (typeof dataUrl !== 'string' || !/^data:[^;]+;base64,/.test(dataUrl)) {
            return res.status(400).json({ error: 'Data URL tidak valid.' });
        }
        const mime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'application/octet-stream';
        const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'File terlalu besar.' });
        const { url } = await supabaseUpload(clientFor(req), buf, mime, ext || 'bin', tok.uid);
        res.json({ url });
    } catch (error) {
        console.error('Error upload-json:', error);
        res.status(500).json({ error: error.message || 'Gagal upload media.' });
    }
});

const isVercel = process.env.VERCEL === '1';
if (!isVercel) {
    app.listen(port, () => {
        console.log(`[ai by hw] Server jalan di http://localhost:${port}`);
    });
}

export default app;
