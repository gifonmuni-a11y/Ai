/* SenkaGif — canvas GIF player (STAGE 2, disiapkan tapi BELUM diaktifkan).
 *
 * Alasan: Chrome Android meng-throttle/evict frame animasi <img> GIF saat
 * scroll sehingga GIF bisa freeze atau menghilang (blank). Rendering lewat
 * <canvas> + decoder omggif tidak kena eviction decoder GIF: frame terakhir
 * yang digambar selalu tetap tampil, jadi tidak mungkin "hilang".
 *
 * CARA AKTIVASI (sudah diterapkan 2026-08-09):
 * 1. index.html: kedua img avatar diberi class "gif-player":
 *      <img class="avatar gif-player" src="assets/avatarsenka.gif" ...>
 *      <img class="avatar-border gif-player" src="assets/bordersenka.gif" ...>
 * 2. index.html: <script src="gif-player.js"></script> sebelum script.js
 * 3. script.js: SenkaGif.init() dipanggil di window.onload.
 *
 * File GIF tidak diubah sama sekali — tetap file final2 yang sama.
 * omggif dimuat otomatis dari jsDelivr dan di-shim untuk browser.
 */
(function () {
    'use strict';

    const OMGGIF_URL = 'https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.min.js';
    const cache = new Map(); // url -> Promise<decoded>

    function loadOmggif() {
        if (window.omggif) return Promise.resolve(window.omggif);
        return fetch(OMGGIF_URL).then(function (r) {
            if (!r.ok) throw new Error('omggif http ' + r.status);
            return r.text();
        }).then(function (src) {
            const exports = {};
            new Function('exports', 'Math', src)(exports, Math);
            window.omggif = exports;
            return exports;
        });
    }

    function decode(url) {
        if (cache.has(url)) return cache.get(url);
        const p = loadOmggif().then(function () {
            return fetch(url).then(function (r) {
                if (!r.ok) throw new Error('gif http ' + r.status);
                return r.arrayBuffer();
            });
        }).then(function (buf) {
            const reader = new window.omggif.GifReader(new Uint8Array(buf));
            const w = reader.width, h = reader.height, n = reader.numFrames();
            const frames = [], delays = [];
            for (let i = 0; i < n; i++) {
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const ctx = c.getContext('2d');
                const img = ctx.createImageData(w, h);
                reader.decodeAndBlitFrameRGBA(i, img.data); // komposit akumulasi + disposal, sudah diverifikasi == GIF asli
                ctx.putImageData(img, 0, 0);
                frames.push(c);
                delays.push(reader.frameInfo(i).delay * 10); // cs -> ms
            }
            return { frames: frames, delays: delays };
        });
        cache.set(url, p);
        return p;
    }

    function play(canvas, img, url) {
        decode(url).then(function (g) {
            const ctx = canvas.getContext('2d');
            const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            let idx = 0, t = 0, last = performance.now(), started = false;

            function draw() {
                if (!started) {
                    started = true;
                    canvas.style.display = 'block'; // frame pertama siap -> canvas ganti img
                    img.style.display = 'none';
                }
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
                const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
                if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.clearRect(0, 0, cw, ch);
                ctx.drawImage(g.frames[idx], 0, 0, cw, ch);
                if (reduced) return;
                const now = performance.now();
                t += now - last; last = now;
                const total = g.delays.reduce(function (a, b) { return a + b; }, 0);
                if (total > 0) t = t % total; // lompatan besar (tab balik dari background) -> modulo total durasi
                while (t >= g.delays[idx]) {
                    t -= g.delays[idx];
                    idx = (idx + 1) % g.delays.length;
                }
                requestAnimationFrame(draw);
            }
            requestAnimationFrame(draw);
        }).catch(function () {
            canvas.remove(); // gagal -> img asli (render GIF bawaan browser) dipakai lagi
            img.style.display = '';
        });
    }

    window.SenkaGif = {
        init: function () {
            document.querySelectorAll('img.gif-player').forEach(function (img) {
                if (img.dataset.gifCanvas) return;
                const canvas = document.createElement('canvas');
                canvas.className = img.className + ' gif-canvas';
                canvas.style.display = 'none';
                img.dataset.gifCanvas = '1';
                img.insertAdjacentElement('afterend', canvas);
                play(canvas, img, img.currentSrc || img.src);
            });
        }
    };
})();
