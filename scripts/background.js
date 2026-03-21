// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'process_image_url') {
        handleTranslationRequestWithCache(request.imageUrl)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));

        return true;
    } else if (request.action === 'process_base64_screenshot') {
        // If the content script hands us back a payload, process it directly!
        handleImageTranslation(request.dataUrl)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (request.action === 'process_screenshot') {
        // Chrome's native API takes a Base64 snapshot of the current tab
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 80 }, async (dataUrl) => {
            try {
                // Bypass the cache and feed the screenshot directly into Gemini function
                const data = await handleImageTranslation(dataUrl);
                sendResponse({ success: true, data });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        });
        return true;
    }
});

// Listen for the keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // 1. Translate OR Reload (Both might need a fresh screenshot for canvas type panel viewers)
    if (command === "translate_current_panel" || command === "reload_translations") {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) return;

            chrome.tabs.sendMessage(tab.id, {
                action: command === "translate_current_panel" ? "translate_page" : "reload_page",
                shortcutScreenshot: dataUrl
            });
        });
    }

    // 2. Hide/Show (Doesn't need a screenshot, just a ping)
    else if (command === "toggle_translations") {
        chrome.tabs.sendMessage(tab.id, { action: "toggle_visibility" });
    }
});

async function handleTranslationRequestWithCache(imageUrl) {
    const cacheKey = `manga_cache_${imageUrl}`;

    // 1. Check Chrome's local storage for this specific image URL
    const cachedData = await chrome.storage.local.get([cacheKey]);

    if (cachedData[cacheKey]) {
        console.log("MangaLens: Serving from cache!");
        return cachedData[cacheKey]; // Instant return, no API call
    }

    // 2. If not cached, proceed with the normal fetch and Gemini processing
    console.log("MangaLens: No cache found, fetching from Gemini...");
    const freshData = await fetchAndProcessImage(imageUrl);

    // 3. Save the result to cache for next time
    await chrome.storage.local.set({ [cacheKey]: freshData });

    return freshData;
}

async function fetchAndProcessImage(imageUrl) {
    try {
        // Fetch the image as a blob
        const imageResponse = await fetch(imageUrl);
        const blob = await imageResponse.blob();

        // Convert blob to base64
        const base64Image = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        // Pass the base64 string to your existing Gemini function
        return await handleImageTranslation(base64Image);
    } catch (error) {
        throw new Error(`Failed to fetch image from URL: ${error.message}`);
    }
}

async function handleImageTranslation(base64Image) {
    const { geminiApiKey, selectedModel } = await chrome.storage.local.get(['geminiApiKey', 'selectedModel']);

    if (!geminiApiKey) {
        throw new Error('API Key not found. Please save it in the MangaLens popup.');
    }

    const modelToUse = selectedModel || 'gemini-3-flash-preview';

    const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const prompt = `
      You are an expert manga translator and OCR system. 
      Carefully scan the ENTIRE image and identify EVERY distinct block of text.
      Translate the Japanese text to natural-sounding English.
      
      You MUST return a valid JSON array of objects. Do NOT wrap the JSON in markdown blocks (like \`\`\`json). Just the raw JSON.
      Each object must have exactly these three keys:
      1. "box_2d": An array of 4 integers between 0 and 1000 representing the bounding box [ymin, xmin, ymax, xmax].
      2. "translation": The English translation.
      3. "type": Categorize the text as either "dialogue" (for speech bubbles, thought bubbles, and narration boxes) or "sfx" (for background text, sound effects, floating text, and store signs).
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
                            box_2d: {
                                type: "ARRAY",
                                items: { type: "INTEGER" }
                            }
                        },
                        required: ["translation", "box_2d"]
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
    const jsonString = result.candidates[0].content.parts[0].text;
    return JSON.parse(jsonString);
}