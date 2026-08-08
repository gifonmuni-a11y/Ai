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
    { key: "groq-llama33",  label: "Llama 3.3 70B (Groq, cepat)",          provider: "groq",       id: "llama-3.3-70b-versatile" },
    { key: "groq-nemo",     label: "Mistral Nemo 12B (Groq, cepat)",       provider: "groq",       id: "mistral-nemo-12b" },
    { key: "or-gptoss",     label: "GPT-OSS 20B (OpenRouter, free)",       provider: "openrouter", id: "openai/gpt-oss-20b:free" },
    { key: "or-gemma",      label: "Gemma 4 31B (OpenRouter, free)",       provider: "openrouter", id: "google/gemma-4-31b-it:free" },
    { key: "or-nemotron",   label: "Nemotron Ultra 550B (OpenRouter)",     provider: "openrouter", id: "nvidia/nemotron-3-ultra-550b-a55b:free" }
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

Jangan mengarang fakta dunia nyata; kalau tidak tahu, jawab jujur singkat.`
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

function candidateList(chosen) {
    const priority = { groq: 0, openrouter: 1 };
    const rest = MODELS
        .filter(m => m.key !== chosen.key)
        .sort((a, b) => (priority[a.provider] ?? 9) - (priority[b.provider] ?? 9));
    return [chosen, ...rest];
}

app.get('/api/config', (req, res) => {
    res.json({
        models: availableModels().map(m => ({ key: m.key, label: m.label, provider: m.provider })),
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

        for (const m of candidateList(chosen)) {
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

        for (const m of candidateList(chosen)) {
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

const isVercel = process.env.VERCEL === '1';
if (!isVercel) {
    app.listen(port, () => {
        console.log(`[ai by hw] Server jalan di http://localhost:${port}`);
    });
}

export default app;
