import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const MODELS = {
    gemma:     { id: "google/gemma-4-31b-it:free",                                 label: "Gemma 4 31B (free, cepat)" },
    nemotron:  { id: "nvidia/nemotron-3-ultra-550b-a55b:free",                     label: "Nemotron Ultra 550B (free, kualitas)" },
    gptoss:    { id: "openai/gpt-oss-20b:free",                                    label: "GPT-OSS 20B (free)" },
    euryale:   { id: "sao10k/l3.3-euryale-70b",                                    label: "Euryale 70B v3.3 (berbayar, roleplay)" },
    euryale31: { id: "sao10k/l3.1-euryale-70b",                                    label: "Euryale 70B v3.1 (berbayar)" }
};

const FALLBACK_CHAIN = [MODELS.gemma, MODELS.gptoss, MODELS.nemotron];
const IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b";

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

async function openRouterChat(messages, modelId, stream = false) {
    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
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

async function tryModels(messages, chosen) {
    const candidates = [chosen, ...FALLBACK_CHAIN.filter(m => m.id !== chosen.id)];
    let lastError = null;
    for (const m of candidates) {
        let response;
        try {
            response = await openRouterChat(messages, m.id);
        } catch (e) {
            lastError = { status: 500, data: { error: { message: "koneksi gagal" } } };
            continue;
        }
        const data = await response.json();
        if (response.ok) return { data, model: m };
        lastError = { status: response.status, data };
        console.error(`Model ${m.id} gagal:`, data?.error?.message || response.status);
    }
    return { lastError };
}

app.post('/api/chat', async (req, res) => {
    try {
        const { messages, modelKey, panggilan } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Pesan harus diisi dulu." });
        }

        const model = MODELS[modelKey];
        if (!model) {
            return res.status(400).json({ error: "Pilih model AI dulu di pengaturan." });
        }

        const systemPrompt = buildSystemPrompt(getCallName(panggilan));
        const result = await tryModels([systemPrompt, ...messages], model);

        if (!result.data) {
            const err = result.lastError;
            return res.status(err?.status || 502).json({
                error: err?.data?.error?.message || "Semua model lagi penuh. Coba lagi sebentar lagi ya."
            });
        }

        res.json({ ...result.data, model_used: result.model.label });
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

        const model = MODELS[modelKey];
        if (!model) {
            return res.status(400).json({ error: "Pilih model AI dulu di pengaturan." });
        }

        const systemPrompt = buildSystemPrompt(getCallName(panggilan));
        const candidates = [model, ...FALLBACK_CHAIN.filter(m => m.id !== model.id)];

        for (const m of candidates) {
            let upstream;
            try {
                upstream = await openRouterChat([systemPrompt, ...messages], m.id, true);
            } catch (e) {
                console.error(`Stream ${m.id} koneksi gagal`);
                continue;
            }

            if (!upstream.ok) {
                const errData = await upstream.json().catch(() => ({}));
                console.error(`Stream ${m.id} gagal:`, errData?.error?.message || upstream.status);
                continue;
            }

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            res.write(`event: model\ndata: ${JSON.stringify({ model_used: m.label, model_id: m.id })}\n\n`);

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

app.post('/api/image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ error: "Deskripsi gambarnya kosong." });
        }

        const response = await fetch("https://openrouter.ai/api/v1/images", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: IMAGE_MODEL,
                prompt: prompt.trim(),
                n: 1,
                resolution: "1K"
            })
        });

        const data = await response.json();

        if (!response.ok) {
            const msg = data?.error?.message || `API error (${response.status})`;
            if (response.status === 402) {
                return res.status(402).json({
                    error: "Bikin gambar pakai model berbayar. Isi dulu kredit di openrouter.ai → Credits."
                });
            }
            return res.status(response.status).json({ error: msg });
        }

        const item = data?.data?.[0];
        const mediaType = item?.media_type || "image/png";
        const imgUrl = item?.url
            ? item.url
            : (item?.b64_json ? `data:${mediaType};base64,${item.b64_json}` : null);
        if (!imgUrl) {
            return res.status(502).json({ error: "Gambar gagal dihasilkan, coba lagi." });
        }
        res.json({ url: imgUrl, model: IMAGE_MODEL });
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
