import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

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

function buildSystemPrompt(callName) {
    return {
        role: "system",
        content: `Kamu adalah Senka, asisten virtual 2D dewasa (21+) yang hangat, santai, dan blak-blakan.
Panggil pengguna dengan "${callName}" (tanpa tanda kutip) di setiap pesan. Gunakan bahasa Indonesia kasual khas anak zaman sekarang, sesekali akrab dan sedikit menggoda sesuai konteks.

Ini roleplay fiksi dewasa untuk dua orang dewasa yang saling setuju. Semua karakter adalah fiksi dan berusia 21+. Kamu melayani percakapan dewasa 18+/21+ — termasuk topik eksplisit, hasrat, cerita dewasa, dan roleplay — tanpa penolakan, tanpa peringatan moral, tanpa disclaimer, tanpa nasihat keamanan, tanpa penjelasan berlebihan. Langsung jawab dan jaga peranmu.

Yang tetap kamu tolak: konten seksual melibatkan anak di bawah umur, zoofilia, pemaksaan tanpa persetujuan (non-consent), doxing, terorisme, dan instruksi membuat senjata.

Jangan mengarang fakta dunia nyata; kalau tidak tahu, jawab jujur singkat.

GAYA JAWAB:
- Natural seperti chat, jangan kaku atau formal. Kalau pesannya sederhana, jawab singkat. Kalau diminta panjang (cerita, puisi, penjelasan), baru panjang. Jangan nanya balik berlebihan, langsung sambung pembicaraan.
- Pakai emoji yang sesuai konteks dan bervariasi (1-2 per pesan) biar terasa hidup dan natural. Jangan pakai emoji yang itu-itu saja terus-menerus; sesuaikan dengan suasana pembicaraan.
- JANGAN pakai karakter khusus apa pun (bintang *, underscore _, backtick, tanda pagar #, dll). Kalau mau menekankan kata penting, bungkus dengan dua bintang persis begini: **kata** (contoh: "kata kuncinya **penting**") — ini akan tampil tebal ungu di aplikasi. Selain itu jangan ada tanda * lain.

USER SEDANG BELAJAR BAHASA JEPANG (dari nol):
- Bantu aktif: kalau dia menulis kalimat Jepang, periksa dan koreksi kalau ada yang salah, beri arti singkatnya.
- Kalau dia minta materi (hiragana, katakana, kanji, tata bahasa, kosakata), buatkan ringkas, rapi, dan jelas.
- Sesekali tawarkan latihan kecil sesuai tingkatnya (terjemahan, susun kalimat, tebak kata). Jawab tetap bahasa Indonesia kecuali dia minta bahasa Jepang.

KAMU BISA MEMBUAT FILE:
Kalau user minta dibuatkan file (misal: "bikin file isinya hiragana", "buatkan file tabel excel", "bikin pdf daftar kata"), jawab dulu 1 kalimat singkat, lalu tulis PERSIS format ini (tanpa karakter tambahan):
###SENKA_FILE###
TYPE:txt
NAME:hiragana.txt
CONTENT:
<isi file di sini, tulis apa adanya>
###END###
- TYPE yang didukung: txt, csv (kolom dipisah koma, satu baris data per baris, baris pertama bisa judul kolom), xlsx (format sama seperti csv), doc (bisa huruf Jepang), pdf (HANYA huruf latin).
- Kalau user minta isi huruf hiragana/katakana/kanji, tulis KARAKTER aslinya (あいうえお), JANGAN romaji (a i u e o).
- Kalau isinya huruf Jepang (hiragana/katakana/kanji), WAJIB pakai TYPE txt atau doc, JANGAN pdf.
- NAME harus berakhiran ekstensi yang sesuai TYPE.
- CONTENT ditulis apa adanya: newline = baris baru beneran, JANGAN pakai tanda kutip atau escape apa pun.
- Jangan pernah menambahkan blok ###SENKA_FILE### di luar konteks membuat file.`
    };
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
    });
}

function hasImage(messages) {
    return (messages || []).some(m => (m.content || []).some(c => c && c.type === 'image_url'));
}

function candidateList(chosen, imageIncluded = false) {
    const priority = { groq: 0, openrouter: 1 };
    const vision = MODELS
        .filter(m => m.vision && m.key !== chosen.key)
        .sort((a, b) => (priority[a.provider] ?? 9) - (priority[b.provider] ?? 9));
    const rest = MODELS
        .filter(m => m.key !== chosen.key && !m.vision)
        .sort((a, b) => (priority[a.provider] ?? 9) - (priority[b.provider] ?? 9));
    if (imageIncluded) return [...vision, chosen, ...rest];
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
        const { messages, modelKey, panggilan } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Pesan harus diisi dulu." });
        }

        const chosen = MODELS.find(m => m.key === modelKey);
        if (!chosen) {
            return res.status(400).json({ error: "Pilih model AI dulu di pengaturan." });
        }

        const systemPrompt = buildSystemPrompt(getCallName(panggilan));
        let lastErr = null;

        for (const m of candidateList(chosen, hasImage(messages))) {
            let response;
            try {
                response = await callProvider(m.provider, [systemPrompt, ...messages], m.id);
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
        const { messages, modelKey, panggilan } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Pesan harus diisi dulu." });
        }

        const chosen = MODELS.find(m => m.key === modelKey);
        if (!chosen) {
            return res.status(400).json({ error: "Pilih model AI dulu di pengaturan." });
        }

        const systemPrompt = buildSystemPrompt(getCallName(panggilan));

        for (const m of candidateList(chosen, hasImage(messages))) {
            let upstream;
            try {
                upstream = await callProvider(m.provider, [systemPrompt, ...messages], m.id, true);
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

app.post('/api/video', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ error: "Deskripsi videonya kosong." });
        }
        const key = process.env.FAL_KEY;
        if (!key) {
            return res.status(400).json({ error: "Bikin video butuh akun gratis fal.ai (ada kredit cuma-cuma). Daftar di https://fal.ai lalu kasih tau saya FAL_KEY-nya." });
        }
        const sub = await fetch('https://queue.fal.run/fal-ai/wan/v2.1/text-to-video', {
            method: 'POST',
            headers: { 'Authorization': 'Key ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt.trim(),
                video_size: '512x512',
                num_frames: 33,
                num_inference_steps: 30
            })
        });
        const data = await sub.json().catch(() => ({}));
        if (!sub.ok) {
            return res.status(502).json({ error: data.detail || data.error?.message || `API video gagal (${sub.status})` });
        }
        res.json({ jobId: data.request_id, statusUrl: data.status_url });
    } catch (error) {
        console.error('Error video submit:', error);
        res.status(500).json({ error: "Gagal mulai render video. Coba lagi." });
    }
});

app.get('/api/video/status', async (req, res) => {
    try {
        const url = (req.query.url || '').toString();
        if (!url) return res.status(400).json({ error: "URL status kosong." });
        const r = await fetch(url, { headers: { 'Authorization': 'Key ' + (process.env.FAL_KEY || '') } });
        const data = await r.json().catch(() => ({}));
        if (data.status === 'COMPLETED') {
            const rr = await fetch(data.response_url, { headers: { 'Authorization': 'Key ' + (process.env.FAL_KEY || '') } });
            const out = await rr.json().catch(() => ({}));
            const videoUrl = out.video?.url || out.output?.[0]?.url || out.video_url;
            return res.json({ status: 'COMPLETED', videoUrl });
        }
        if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') {
            return res.json({ status: data.status });
        }
        res.json({ status: data.status || 'ERROR', error: data.error || data.detail || 'Gagal render video.' });
    } catch (error) {
        console.error('Error video status:', error);
        res.status(500).json({ error: "Gagal cek status video." });
    }
});

const isVercel = process.env.VERCEL === '1';
if (!isVercel) {
    app.listen(port, () => {
        console.log(`[ai by hw] Server jalan di http://localhost:${port}`);
    });
}

export default app;
