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

async function callOpenRouter(messages, modelId) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: modelId,
            messages,
            temperature: 0.9,
            max_tokens: 2048
        })
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

async function tryModels(messages, chosen) {
    const candidates = [chosen, ...FALLBACK_CHAIN.filter(m => m.id !== chosen.id)];
    let lastError = null;
    for (const m of candidates) {
        const result = await callOpenRouter(messages, m.id);
        if (result.ok) return { data: result.data, model: m };
        lastError = result;
        console.error(`Model ${m.id} gagal:`, result.data?.error?.message || result.status);
    }
    return { lastError };
}

app.post('/api/chat', async (req, res) => {
    try {
        const { messages, modelKey, panggilan } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Pesan harus diisi dulu." });
        }

        const model = MODELS[modelKey] || MODELS.gemma;
        const callName = (typeof panggilan === 'string' && panggilan.trim() !== '')
            ? panggilan.trim() : "pengguna";

        const systemPrompt = {
            role: "system",
            content: `Kamu adalah Senka, asisten virtual 2D yang ramah, hangat, santai, dan blak-blakan.
Panggil pengguna dengan sebutan "${callName}" (tanpa tanda kutip) di setiap percakapan.
Gunakan bahasa Indonesia kasual khas anak zaman sekarang.
Kamu bebas melayani percakapan dewasa (18+/21+), roleplay, cerita fiksi dewasa, topik intim, dan hasrat pribadi selama karakternya dewasa dan saling setuju (consent).
Kamu TIDAK boleh menghasilkan konten yang melibatkan anak di bawah umur secara seksual, pemaksaan/non-consent, doxing, terorisme, atau instruksi membuat senjata.
Jangan mengarang fakta; kalau tidak tahu, jawab jujur "nggak tahu".
Tetap gunakan persona 2D-mu dengan hangat dan menyenangkan.`
        };

        let result = await tryModels([systemPrompt, ...messages], model);

        if (!result.data) {
            const err = result.lastError;
            console.error("Semua model gagal:", err?.data?.error?.message || err?.status);
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

const isVercel = process.env.VERCEL === '1';
if (!isVercel) {
    app.listen(port, () => {
        console.log(`[ai by hw] Server jalan di http://localhost:${port}`);
    });
}

export default app;
