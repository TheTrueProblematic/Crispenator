// Crispenator UXP main.js - adds retry with backoff and Retry-After handling
(function () {
    const { app, action, core } = require("photoshop");
    const uxp = require("uxp");
    const fs = uxp.storage.localFileSystem;
    const shell = uxp.shell;

    // Prompts
    const UPSCALE_PROMPT = `Upscale and restore detail. Keep content identical. Preserve color and tone. Reduce artifacts. No new objects. Natural sharpness only. Maintain the aspect ratio of the input image. KEEP COLOR AND PROPORTIONS IDENTICAL!`;
    const RESTORE_PROMPT = `Take this existing image and make it look like it was shot with an expensive, professional, modern camera. If it’s an old black and white image make it colored accurately. The outputed image should have impeccable depth of field and have a professional look, while maintaining all of the detail and recognizable attributes of the initial image`;

    // UI
    const upscaleBtn = document.getElementById("upscaleBtn");
    const restoreBtn = document.getElementById("restoreBtn");
    const settingsBtn = document.getElementById("settingsBtn");
    const modal = document.getElementById("modal");
    const apiKeyInput = document.getElementById("apiKeyInput");
    const saveKey = document.getElementById("saveKey");
    const closeModal = document.getElementById("closeModal");
    const statusEl = document.getElementById("status");
    const progressWrap = document.getElementById("progressWrap");
    const bar = document.getElementById("bar");
    const pct = document.getElementById("pct");
    const progressLabel = document.getElementById("progressLabel");
    const ppLink = document.getElementById("ppLink");

    // error surfacing
    function showError(e) {
        const msg = e && e.message ? e.message : String(e);
        statusEl.style.color = "#ff9a9a";
        statusEl.textContent = msg;
        try { console.error("Crispenator error:", e); } catch {}
    }
    window.addEventListener("error", ev => showError(ev.error || ev.message));
    window.addEventListener("unhandledrejection", ev => showError(ev.reason || ev));

    function setStatus(msg, isError = false) {
        statusEl.style.color = isError ? "#ff9a9a" : "#a8ffa8";
        statusEl.textContent = msg || "";
        try { console.log("Crispenator:", msg); } catch {}
    }
    function showProgress() {
        progressWrap.classList.remove("hidden");
        bar.style.width = "0%";
        pct.textContent = "0%";
    }
    function hideProgress() {
        progressWrap.classList.add("hidden");
    }

    // ascii helpers so we do not need TextEncoder or TextDecoder
    function asciiToBytes(str) {
        const u = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xff;
        return u;
    }
    function bytesToAscii(ab) {
        const u = ab instanceof Uint8Array ? ab : new Uint8Array(ab);
        let s = "";
        for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
        return s;
    }

    // sleep helper for backoff
    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // data folder needs no permissions
    async function getWorkFolder() {
        return await fs.getDataFolder();
    }
    async function createOrGetFile(folder, name) {
        try { return await folder.getEntry(name); }
        catch { return await folder.createFile(name, { overwrite: true }); }
    }
    async function deleteIfExists(folder, name) {
        try { const f = await folder.getEntry(name); await f.delete(); } catch {}
    }

    // compat writers and readers
    async function writeBinaryCompat(file, uint8) {
        if (typeof file.createWritable === "function") {
            const w = await file.createWritable({ keepExistingData: false });
            await w.write(uint8);
            await w.close();
            return;
        }
        if (typeof file.write === "function") {
            try { await file.write(uint8, { format: uxp.storage.formats.binary, append: false }); return; } catch {}
            try { await file.write(uint8); return; } catch {}
        }
        throw new Error("File write is not supported in this UXP runtime");
    }
    async function writeTextCompat(file, text) {
        if (typeof file.write === "function") {
            try { await file.write(text); return; } catch {}
        }
        await writeBinaryCompat(file, asciiToBytes(text));
    }
    async function readBinaryCompat(file) {
        if (typeof file.read === "function") {
            try { return await file.read({ format: uxp.storage.formats.binary }); } catch {}
            try { return await file.read(); } catch {}
        }
        throw new Error("File read is not supported in this UXP runtime");
    }
    async function readTextCompat(file) {
        if (typeof file.read === "function") {
            try {
                const s1 = await file.read({ format: uxp.storage.formats.utf8 });
                if (typeof s1 === "string") return s1;
            } catch {}
            try {
                const s2 = await file.read();
                if (typeof s2 === "string") return s2;
            } catch {}
        }
        const ab = await readBinaryCompat(file);
        return bytesToAscii(ab);
    }

    async function saveApiKey(workFolder, key) {
        const f = await createOrGetFile(workFolder, "key.txt");
        await writeTextCompat(f, key.trim());
    }
    async function readApiKey(workFolder) {
        try {
            const f = await workFolder.getEntry("key.txt");
            return (await readTextCompat(f)).trim();
        } catch { return ""; }
    }

    async function saveActiveDocAsPng(targetFile) {
        const token = await fs.createSessionToken(targetFile);
        await action.batchPlay([{
            _obj: "save",
            as: { _obj: "PNGFormat", PNGInterlaceType: { _enum: "PNGInterlaceType", _value: "PNGInterlaceNone" } },
            in: { _path: token, _kind: "local" },
            copy: false,
            lowerCase: true,
            embedProfiles: false
        }], {});
    }

    async function exportComposite(workFolder) {
        if (!app.documents.length) throw new Error("No open document.");
        const inputFile = await createOrGetFile(workFolder, "input.png");
        await core.executeAsModal(async () => {
            const docId = app.activeDocument.id;
            await action.batchPlay([{ _obj: "duplicate", _target: [{ _ref: "document", _id: docId }], name: "Crispenator Temp" }], {});
            await action.batchPlay([{ _obj: "flattenImage" }], {});
            await saveActiveDocAsPng(inputFile);
            await action.batchPlay([{ _obj: "close", saving: { _enum: "yesNo", _value: "no" } }], {});
        }, { commandName: "Crispenator export" });
        return inputFile;
    }

    // place output.png directly into the active document as a new layer
    async function placeOutputLayer(workFolder) {
        const output = await workFolder.getEntry("output.png");
        const token = await fs.createSessionToken(output);

        await core.executeAsModal(async () => {
            await action.batchPlay(
                [
                    {
                        _obj: "placeEvent",
                        null: { _path: token, _kind: "local" },
                        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
                        offset: {
                            _obj: "offset",
                            horizontal: { _unit: "pixelsUnit", _value: 0 },
                            vertical: { _unit: "pixelsUnit", _value: 0 }
                        }
                    }
                ],
                {}
            );

            await action.batchPlay(
                [
                    {
                        _obj: "set",
                        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                        to: { _obj: "layer", name: "CrispenatorOutput" }
                    }
                ],
                {}
            );
        }, { commandName: "Crispenator - Place output" });
    }

    // Use API auto sizing to preserve aspect
    function pickApiSize() {
        return "auto";
    }

    // Parse Retry After header or seconds from error payload
    function parseRetryAfter(resp, bodyText) {
        const h = resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null;
        if (h) {
            const n = Number(h);
            if (!isNaN(n) && n >= 0) return Math.max(1, Math.floor(n));
        }
        if (bodyText) {
            const m = bodyText.match(/after\s+([0-9]+(?:\.[0-9]+)?)\s*seconds?/i);
            if (m) {
                const n = Number(m[1]);
                if (!isNaN(n)) return Math.max(1, Math.round(n));
            }
        }
        return 1;
    }

    // Call OpenAI with retry and size fallback
    async function callOpenAI(workFolder, apiKey, prompt) {
        const input = await workFolder.getEntry("input.png");
        const ab = await readBinaryCompat(input);
        const blob = new Blob([ab], { type: "image/png" });

        // Try auto first to preserve aspect, then fall back to square
        const primary = pickApiSize();
        const sizes = primary === "auto" ? ["auto", "1024x1024"] : [primary];

        let lastErr = null;

        for (let sIdx = 0; sIdx < sizes.length; sIdx++) {
            const size = sizes[sIdx];
            let delayMs = 1000;
            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    const form = new FormData();
                    form.append("model", "gpt-image-1.5");
                    form.append("prompt", prompt);
                    form.append("size", size);
                    form.append("quality", "high");
                    form.append("image", blob, "input.png");

                    const resp = await fetch("https://api.openai.com/v1/images/edits", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${apiKey}` },
                        body: form
                    });

                    if (resp.status === 429 || resp.status >= 500) {
                        const text = await resp.text().catch(() => "");
                        const waitSec = parseRetryAfter(resp, text);
                        lastErr = new Error(`Rate limited. Waiting ${waitSec} seconds before retry ${attempt + 1} of 5 on ${size}.`);
                        setStatus(lastErr.message, true);
                        const jitter = Math.floor(Math.random() * 250);
                        await sleep(waitSec * 1000 + jitter);
                        delayMs = Math.min(delayMs * 2, 16000);
                        continue;
                    }

                    if (!resp.ok) {
                        const text = await resp.text().catch(() => "");
                        // Save error and break out to try next size rather than aborting
                        lastErr = new Error(`OpenAI error ${resp.status}. ${text}`);
                        break;
                    }

                    const data = await resp.json();
                    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
                    if (!b64) {
                        lastErr = new Error("No image returned.");
                        break;
                    }

                    const out = await createOrGetFile(workFolder, "output.png");
                    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                    await writeBinaryCompat(out, bytes);
                    return; // success
                } catch (e) {
                    lastErr = e;
                    const msg = String(e && e.message ? e.message : e);
                    if (!/Rate limited|429|retry/i.test(msg)) {
                        // break attempts loop to try next size
                        break;
                    }
                    const jitter = Math.floor(Math.random() * 250);
                    await sleep(delayMs + jitter);
                    delayMs = Math.min(delayMs * 2, 16000);
                }
            }
            setStatus(`Could not generate at ${size}. Trying another size if available.`, true);
        }

        throw lastErr || new Error("Image generation failed after retries.");
    }

    function runProgress(checkFn, onDone) {
        const start = Date.now();
        const DURATION = 90000;
        let finished = false;
        const t = setInterval(async () => {
            const elapsed = Date.now() - start;
            let p = Math.floor((elapsed / DURATION) * 100);
            if (p >= 100) p = 100;
            if (!finished && p >= 99) p = 99;
            bar.style.width = p + "%";
            pct.textContent = p + "%";
            if (!finished) {
                try {
                    const done = await checkFn();
                    if (done) {
                        finished = true;
                        bar.style.width = "100%";
                        pct.textContent = "100%";
                        clearInterval(t);
                        onDone();
                    }
                } catch (e) {
                    clearInterval(t);
                    showError(e);
                }
            }
        }, 150);
    }

    async function outputExists(workFolder) {
        try {
            const f = await workFolder.getEntry("output.png");
            if (typeof f.stat === "function") {
                const s = await f.stat();
                return s.size > 0;
            }
            const ab = await readBinaryCompat(f);
            return ab && ab.byteLength > 0;
        } catch { return false; }
    }

    // UI events
    ppLink.addEventListener("click", e => {
        e.preventDefault();
        shell.openExternal("https://crispenator.com");
    });

    // Settings button now toggles the bottom panel only
    settingsBtn.addEventListener("click", () => {
        const isHidden = modal.classList.contains("hidden");
        modal.classList.toggle("hidden");
        settingsBtn.setAttribute("aria-expanded", String(isHidden));
    });

    // Save and close
    saveKey.addEventListener("click", async () => {
        try {
            const folder = await getWorkFolder();
            await saveApiKey(folder, apiKeyInput.value);
            setStatus("API key saved.");
            modal.classList.add("hidden");
            settingsBtn.setAttribute("aria-expanded", "false");
        } catch (e) { showError(e); }
    });

    // Close button now closes the settings panel
    closeModal.addEventListener("click", () => {
        modal.classList.add("hidden");
        settingsBtn.setAttribute("aria-expanded", "false");
    });

    // Escape closes the panel if open
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            modal.classList.add("hidden");
            settingsBtn.setAttribute("aria-expanded", "false");
        }
    });

    async function runWithPrompt(prompt, modeLabel) {
        try {
            setStatus("");
            const folder = await getWorkFolder();
            const key = await readApiKey(folder);
            if (!key) {
                modal.classList.remove("hidden");
                settingsBtn.setAttribute("aria-expanded", "true");
                setStatus("Enter your OpenAI API key first.", true);
                return;
            }
            setStatus("Exporting canvas to input.png ...");
            await exportComposite(folder);

            // Clear any old output so progress will not finish early
            await deleteIfExists(folder, "output.png");

            progressLabel.textContent = `Generating ${modeLabel.toLowerCase()} image. This usually takes up to 90 seconds.`;
            setStatus("Generating with high quality ...");
            showProgress();

            let apiError = null;
            callOpenAI(folder, key, prompt).catch(e => { apiError = e; });

            runProgress(async () => {
                if (apiError) throw apiError;
                return await outputExists(folder);
            }, async () => {
                try {
                    setStatus("Placing new layer ...");
                    await placeOutputLayer(folder);
                    setStatus("Done. New layer CrispenatorOutput added.");
                } catch (e2) {
                    showError(e2);
                } finally {
                    hideProgress();
                }
            });
        } catch (e) { showError(e); hideProgress(); }
    }

    upscaleBtn.addEventListener("click", () => runWithPrompt(UPSCALE_PROMPT, "Upscale"));
    restoreBtn.addEventListener("click", () => runWithPrompt(RESTORE_PROMPT, "Restore"));

    // On launch, auto fill the API key if saved
    (async function initPrefill() {
        try {
            const folder = await getWorkFolder();
            const k = await readApiKey(folder);
            if (k) {
                apiKeyInput.value = k;
            }
        } catch (e) {
            // do not block startup on this
            console.warn("Could not prefill API key:", e);
        }
    })();

    setStatus("Crispenator ready.");
})();
