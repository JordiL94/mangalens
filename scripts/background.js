// --- HELPER FUNCTIONS ---
async function handleAsyncMessage(promise, sendResponse) {
    try {
        const data = await promise;
        sendResponse({ success: true, data });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Service Workers lack FileReader, so we convert Blobs manually via ArrayBuffer
async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// --- MESSAGE LISTENERS ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'process_image_url') {
        handleAsyncMessage(processWithCache(request.imageUrl), sendResponse);
        return true;
    }

    if (request.action === 'process_base64_screenshot') {
        handleAsyncMessage(translateImage(request.dataUrl), sendResponse);
        return true;
    }

    if (request.action === 'process_screenshot') {
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                return sendResponse({ success: false, error: chrome.runtime.lastError.message });
            }
            handleAsyncMessage(translateImage(dataUrl), sendResponse);
        });
        return true;
    }
});

// --- COMMAND LISTENERS ---
chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (command === "translate_current_panel" || command === "reload_translations") {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) return;
            chrome.tabs.sendMessage(tab.id, {
                action: command === "translate_current_panel" ? "translate_page" : "reload_page",
                shortcutScreenshot: dataUrl
            });
        });
    } else if (command === "toggle_translations") {
        chrome.tabs.sendMessage(tab.id, { action: "toggle_visibility" });
    }
});

// --- CORE TRANSLATION PIPELINE ---
async function processWithCache(imageUrl) {
    const cacheKey = `manga_cache_${imageUrl}`;
    const cachedData = await chrome.storage.local.get([cacheKey]);

    if (cachedData[cacheKey]) return cachedData[cacheKey];

    const imageResponse = await fetch(imageUrl);
    const blob = await imageResponse.blob();
    const base64Image = await blobToBase64(blob);

    const freshData = await translateImage(base64Image);
    await chrome.storage.local.set({ [cacheKey]: freshData });

    return freshData;
}

async function translateImage(base64Image) {
    const { geminiApiKey, selectedModel } = await chrome.storage.local.get(['geminiApiKey', 'selectedModel']);
    if (!geminiApiKey) throw new Error('API Key not found. Please save it in the MangaLens popup.');

    const modelToUse = selectedModel || 'gemini-3.1-flash-preview';
    const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const prompt = `
      You are an expert manga translator and OCR system. 
      Carefully scan the ENTIRE image and identify EVERY distinct block of text.
      Translate the Japanese text to natural-sounding English.
      
      You MUST return a valid JSON array of objects. Do NOT wrap the JSON in markdown blocks (like \`\`\`json). Just the raw JSON.
      Each object must have exactly these three keys:
      1. "box_2d": An array of 4 integers between 0 and 1000 representing the bounding box [ymin, xmin, ymax, xmax].
      2. "translation": The English translation.
      3. "type": Categorize the text as either "dialogue" or "sfx".
    `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/jpeg", data: base64Data } }
                ]
            }],
            generationConfig: {
                response_mime_type: "application/json",
                temperature: 1.0,
                thinking_config: { thinking_level: "low" },
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            translation: { type: "STRING" },
                            type: { type: "STRING" },
                            box_2d: {
                                type: "ARRAY",
                                items: { type: "INTEGER" }
                            }
                        },
                        required: ["translation", "type", "box_2d"]
                    }
                }
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch from Gemini API');
    }

    const result = await response.json();
    return JSON.parse(result.candidates[0].content.parts[0].text);
}