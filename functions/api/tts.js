/**
 * RuDao voice reply - /api/tts
 *
 * Turns a chat answer into speech so readers can listen instead of read.
 *
 * Providers, tried in this order (TTS_PROVIDER can pin one explicitly):
 *   1. ElevenLabs - the author's own cloned voices ("TonyTong" US accent
 *      for English, "TonyTong" Mandarin for Chinese)
 *        POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id>
 *        headers: xi-api-key: <key>
 *        body: { text, model_id, voice_settings }   ->  raw mp3 bytes
 *   2. Fish Audio - standby provider (s2.1-pro-free is USD 0). When both
 *      keys are configured the reader never sees a silent chat: if the
 *      ElevenLabs call fails or is out of credits, the same text is
 *      retried on Fish Audio before the browser-speech fallback.
 *
 * Setup - the author's own voice (ElevenLabs):
 *   1. elevenlabs.io -> avatar -> Profile -> API Keys -> create a key
 *   2. Voices page -> the cloned "Tony Tong" voice -> copy its Voice ID
 *   3. Pages project settings -> environment variables:
 *        ELEVENLABS_API_KEY    (Secret)   the API key
 *        ELEVENLABS_VOICE_ID   (Variable) the voice id for English replies
 *        ELEVENLABS_VOICE_ID_ZH (Variable) optional second clone trained on
 *                              Mandarin; Chinese replies use it when set,
 *                              otherwise they fall back to ELEVENLABS_VOICE_ID
 *        ELEVENLABS_MODEL      (Variable) optional; defaults to
 *                                        eleven_flash_v2_5 (fast, half credits,
 *                                        speaks EN + ZH). Use eleven_multilingual_v2
 *                                        for the richest quality (2x credits).
 *   4. Retry the deployment - variables only reach new builds.
 *   Tip: GET /api/tts?voices=1 lists every voice on the account with its id,
 *   so the right voice id can be copied straight from this endpoint.
 *
 * While no key is configured the endpoint reports not_configured and the
 * chat widget falls back to the browser's built-in speech synthesis, so the
 * listen button works from day one at zero cost.
 */

const MAX_CHARS = 2000;

function json(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
}

function detectProvider(env) {
    const pinned = env.TTS_PROVIDER;
    if (pinned === "elevenlabs" && env.ELEVENLABS_API_KEY) return "elevenlabs";
    if (pinned === "fish" && env.FISH_API_KEY) return "fish";
    if (env.ELEVENLABS_API_KEY) return "elevenlabs";
    if (env.FISH_API_KEY) return "fish";
    return null;
}

function providerInfo(env) {
    const p = detectProvider(env);
    const info = {
        provider: p || "none",
        configured: Boolean(p),
        commit: env.CF_PAGES_COMMIT_SHA ? env.CF_PAGES_COMMIT_SHA.slice(0, 7) : "unknown"
    };
    if (p === "elevenlabs") {
        info.model = env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
        info.voice = env.ELEVENLABS_VOICE_ID ? "custom" : "default";
        info.voice_zh = env.ELEVENLABS_VOICE_ID_ZH ? "custom" : "fallback-to-en";
    } else {
        info.model = env.FISH_MODEL || "s2.1-pro-free";
        info.voice = env.FISH_VOICE_ID ? "custom" : "default";
    }
    info.standby = (p !== "fish" && env.FISH_API_KEY) ? "fish-audio" : "none";
    return info;
}

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);

    /* Admin helper: list the account's voices so the cloned voice id can be
       copied without digging through the ElevenLabs dashboard. */
    if (url.searchParams.has("voices")) {
        if (!env.ELEVENLABS_API_KEY) {
            return json({ ok: false, error: "not_configured", message: "Set ELEVENLABS_API_KEY first." });
        }
        try {
            const r = await fetch("https://api.elevenlabs.io/v1/voices", {
                headers: { "xi-api-key": env.ELEVENLABS_API_KEY }
            });
            const d = await r.json();
            const voices = (d.voices || []).map(function (v) {
                return { id: v.voice_id, name: v.name, category: v.category };
            });
            return json({ ok: r.ok, count: voices.length, voices: voices });
        } catch (e) {
            return json({ ok: false, error: "network", message: String(e && e.message || e) });
        }
    }

    return json(Object.assign({ ok: true, service: "RuDao voice reply" }, providerInfo(env)));
}

function speakElevenLabs(text, env) {
    /* Two clones, one per language: the English-trained voice speaks EN,
       the Mandarin-trained voice speaks ZH. Chinese falls back to the
       English voice until ELEVENLABS_VOICE_ID_ZH is set. */
    const isZh = /[\u4e00-\u9fff]/.test(text);
    const voiceId = (isZh && env.ELEVENLABS_VOICE_ID_ZH) || env.ELEVENLABS_VOICE_ID;
    if (!voiceId) {
        return Promise.resolve(json({
            ok: false,
            error: "not_configured",
            message: "ELEVENLABS_VOICE_ID is missing - copy the voice id of the cloned voice.",
            fallback: "browser"
        }));
    }
    const model = env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
    return fetch(
        "https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "?output_format=mp3_44100_128",
        {
            method: "POST",
            headers: {
                "xi-api-key": env.ELEVENLABS_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: text,
                model_id: model,
                voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true }
            })
        }
    ).then(function (upstream) {
        if (!upstream.ok) {
            return upstream.text().then(function (t) {
                return json({
                    ok: false,
                    error: "upstream",
                    status: upstream.status,
                    detail: String(t || "").slice(0, 300),
                    fallback: "browser"
                });
            });
        }
        return new Response(upstream.body, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
        });
    });
}

function speakFish(text, env) {
    const lang = /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en";
    const payload = { text: text, format: "mp3", language: lang };
    if (env.FISH_VOICE_ID) payload.reference_id = env.FISH_VOICE_ID;
    return fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + env.FISH_API_KEY,
            "Content-Type": "application/json",
            "model": env.FISH_MODEL || "s2.1-pro-free"
        },
        body: JSON.stringify(payload)
    }).then(function (upstream) {
        if (!upstream.ok) {
            return upstream.text().then(function (t) {
                return json({
                    ok: false,
                    error: "upstream",
                    status: upstream.status,
                    detail: String(t || "").slice(0, 300),
                    fallback: "browser"
                });
            });
        }
        return new Response(upstream.body, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
        });
    });
}

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return json({ ok: false, error: "bad_request", message: "JSON body required." });
    }

    const text = String((body && body.text) || "").trim();
    if (!text) {
        return json({ ok: false, error: "bad_request", message: "Nothing to speak." });
    }
    if (text.length > MAX_CHARS) {
        return json({ ok: false, error: "too_long", message: "Reply too long for one voice clip." });
    }

    const provider = detectProvider(env);
    if (!provider) {
        /* The widget reads this and switches to the browser's own speech. */
        return json({ ok: false, error: "not_configured", fallback: "browser" });
    }

    try {
        let res = await (provider === "elevenlabs"
            ? speakElevenLabs(text, env)
            : speakFish(text, env));

        /* The standby provider kicks in whenever the primary one answers
           with an error instead of audio - quota exhausted, outage, etc. */
        const ct = res.headers.get("Content-Type") || "";
        if (!ct.startsWith("audio") && provider !== "fish" && env.FISH_API_KEY) {
            try {
                const res2 = await speakFish(text, env);
                if ((res2.headers.get("Content-Type") || "").startsWith("audio")) {
                    return res2;
                }
            } catch (e) { /* fall through with the primary error */ }
        }
        return res;
    } catch (e) {
        /* network-level failure on the primary: try the standby directly */
        if (provider !== "fish" && env.FISH_API_KEY) {
            try {
                return await speakFish(text, env);
            } catch (e2) { /* report below */ }
        }
        return json({ ok: false, error: "network", message: String(e && e.message || e), fallback: "browser" });
    }
}
