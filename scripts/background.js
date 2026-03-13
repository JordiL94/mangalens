// Listen for messages from your content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'process_image_url') {
        fetchAndProcessImage(request.imageUrl)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));

        return true; // Keeps the message channel open for async response
    }
});

// New function to handle the fetch bypassing CORS
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
    const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
    if (!geminiApiKey) {
        throw new Error('API Key not found. Please save it in the MangaLens popup.');
    }

    const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    // Updated prompt utilizing Gemini's native 1000x1000 spatial grid
    const prompt = `
    You are an expert manga translator and OCR system. 
    Carefully scan the ENTIRE image and identify EVERY distinct block of text. This includes speech bubbles, text on phone screens, thought bubbles, and background text.
    Translate the Japanese text to natural-sounding English.
    
    For spatial coordinates, you must use Gemini's native 1000x1000 grid. 
    Provide the bounding box as an array of 4 integers between 0 and 1000: [ymin, xmin, ymax, xmax].
    (ymin = top edge, xmin = left edge, ymax = bottom edge, xmax = right edge)
  `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiApiKey}`, {
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
                thinking_config: {
                    thinking_level: "low"
                },
                // Enforcing a strict schema guarantees we get coordinates for every translation
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            translation: { type: "STRING" },
                            box_2d: {
                                type: "ARRAY",
                                items: { type: "INTEGER" },
                                description: "[ymin, xmin, ymax, xmax] from 0 to 1000"
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