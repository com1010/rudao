/**
 * RuDao voice reply - /api/tts
 *
 * Turns a chat answer into speech so readers can listen instead of read.
 *
 * Provider: Fish Audio (https://fish.audio)
 *   POST https://api.fish.audio/v1/tts
 *   headers: Authorization: Bearer <key>, Content-Type: application/json,
 *            model: s2.1-pro-free (USD 0, fine for a reader-facing voice)
 *   body:    { text, reference_id (the cloned TonyTong voice), format: mp3, language }
 *   returns: raw audio bytes
 *
 * Setup (step 2 - "the author's own voice"):
 *   1. Record 1-3 min of clean speech (EN + ZH), upload at fish.audio,
 *      create the clone, copy its voice id.
 *   2. Pages project settings -> environment variables:
 *        FISH_API_KEY   (Secret)   API key from fish.audio
 *        FISH_VOICE_ID  (Variable) the cloned voice id (optional; when absent
 *                                  Fish picks its default catalog voice)
 *        FISH_MODEL     (Variable) optional override, defaults to s2.1-pro-free
 *   3. Retry the deployment - variables only reach new builds.
 *
 * While FISH_API_KEY is missing the endpoint reports not_configured and the
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

export async function onRequestGet({ env }) {
    return json({
        ok: true,
        service: "RuDao voice reply",
        provider: "fish-audio",
        configured: Boolean(env.FISH_API_KEY),
        model: env.FISH_MODEL || "s2.1-pro-free",
        voice: env.FISH_VOICE_ID ? "custom" : "default",
        commit: env.CF_PAGES_COMMIT_SHA ? env.CF_PAGES_COMMIT_SHA.slice(0, 7) : "unknown"
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

    if (!env.FISH_API_KEY) {
        /* The widget reads this and switches to the browser's own speech. */
        return json({ ok: false, error: "not_configured", fallback: "browser" });
    }

    const lang = /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en";
    const payload = { text: text, format: "mp3", language: lang };
    if (env.FISH_VOICE_ID) payload.reference_id = env.FISH_VOICE_ID;

    try {
        const upstream = await fetch("https://api.fish.audio/v1/tts", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + env.FISH_API_KEY,
                "Content-Type": "application/json",
                "model": env.FISH_MODEL || "s2.1-pro-free"
            },
            body: JSON.stringify(payload)
        });

        if (!upstream.ok) {
            let detail = "";
            try { detail = (await upstream.text()).slice(0, 300); } catch (e) { /* ignore */ }
            return json({
                ok: false,
                error: "upstream",
                status: upstream.status,
                detail: detail,
                fallback: "browser"
            });
        }

        return new Response(upstream.body, {
            status: 200,
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-store"
            }
        });
    } catch (e) {
        return json({ ok: false, error: "network", message: String(e && e.message || e), fallback: "browser" });
    }
}
