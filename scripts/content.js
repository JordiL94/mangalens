// Listen for the trigger from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_page") {
        injectTranslationUI();
    }
});

// Modify the function signature to accept a specific image target
async function injectTranslationUI(targetImage = null) {

    // If no target is provided (e.g. from the popup), fallback to finding the largest image
    if (!targetImage) {
        const images = Array.from(document.querySelectorAll('img'));
        let maxArea = 0;
        images.forEach(img => {
            const area = img.clientWidth * img.clientHeight;
            if (area > maxArea) {
                maxArea = area;
                targetImage = img;
            }
        });
    }

    if (!targetImage) {
        alert("MangaLens: Couldn't find a suitable image.");
        return;
    }

    // 2. Create and inject our premium CSS dynamically
    injectStyles();

    // 3. Show a loading overlay over the image
    const loader = document.createElement('div');
    loader.className = 'mangalens-loader';
    loader.innerHTML = '<div class="spinner"></div><p>Gemini is translating...</p>';
    positionOverlay(loader, mainImage);
    document.body.appendChild(loader);

    try {
        // 4. Send the image URL to background.js instead of using Canvas
        const response = await chrome.runtime.sendMessage({
            action: 'process_image_url',
            imageUrl: mainImage.src
        });

        loader.remove(); // Remove loader

        if (!response.success) {
            alert("MangaLens Error: " + response.error);
            return;
        }

        // 6. Create the translation overlay container
        const overlayContainer = document.createElement('div');
        overlayContainer.className = 'mangalens-container';
        positionOverlay(overlayContainer, mainImage);

        // 7. Map over the JSON and create the text bubbles
        const translations = response.data;
        translations.forEach(item => {
            // Destructure the 1000x1000 grid coordinates
            const [ymin, xmin, ymax, xmax] = item.box_2d;

            const bubble = document.createElement('div');
            bubble.className = 'mangalens-bubble';
            bubble.innerText = item.translation;

            // Convert the 0-1000 scale to 0-100 percentages by dividing by 10
            bubble.style.top = `${ymin / 10}%`;
            bubble.style.left = `${xmin / 10}%`;
            bubble.style.height = `${(ymax - ymin) / 10}%`;
            bubble.style.width = `${(xmax - xmin) / 10}%`;

            overlayContainer.appendChild(bubble);
        });

        document.body.appendChild(overlayContainer);

        // Update overlay position if the window resizes
        window.addEventListener('resize', () => positionOverlay(overlayContainer, mainImage));

    } catch (error) {
        loader.remove();
        alert("MangaLens encountered a fatal error.");
        console.error(error);
    }
}

// Helper to keep our overlays perfectly aligned with the DOM image
function positionOverlay(overlayElement, targetImage) {
    const rect = targetImage.getBoundingClientRect();
    overlayElement.style.position = 'absolute';
    overlayElement.style.top = `${rect.top + window.scrollY}px`;
    overlayElement.style.left = `${rect.left + window.scrollX}px`;
    overlayElement.style.width = `${rect.width}px`;
    overlayElement.style.height = `${rect.height}px`;
}

// Helper to inject our UI styles
function injectStyles() {
    if (document.getElementById('mangalens-styles')) return;

    const style = document.createElement('style');
    style.id = 'mangalens-styles';
    style.textContent = `
    .mangalens-container {
      pointer-events: none; /* Lets you click through to the image */
      z-index: 9999;
    }
    .mangalens-bubble {
      position: absolute;
      background: rgba(15, 17, 21, 0.85);
      backdrop-filter: blur(4px);
      color: #fff;
      padding: 8px 12px;
      border-radius: 8px;
      font-family: -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.4;
      border: 1px solid rgba(139, 92, 246, 0.5);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: auto; /* Re-enable pointer events for hover */
      transition: opacity 0.2s ease;
      overflow: hidden;
      box-sizing: border-box;
    }
    .mangalens-bubble:hover {
      opacity: 0; /* Hide translation to reveal original Japanese */
    }
    .mangalens-loader {
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(2px);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      font-family: sans-serif;
      border-radius: 8px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: #8b5cf6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin { 
      to { transform: rotate(360deg); } 
    }
    .mangalens-inline-btn {
      z-index: 10000;
      background: rgba(15, 17, 21, 0.7);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(139, 92, 246, 0.5);
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.2s ease;
    }
    .mangalens-inline-btn:hover {
      background: rgba(139, 92, 246, 0.8);
      transform: scale(1.05);
    }
  `;
    document.head.appendChild(style);
}

// ==========================================
// 1. MUTATION OBSERVER (High Performance)
// ==========================================

// Function to check an image and add our button
function processImage(img) {
    // We only want large manga panels, and only if we haven't tagged them yet
    if (img.clientWidth > 400 && img.clientHeight > 500 && !img.dataset.hasMangaLensBtn) {
        img.dataset.hasMangaLensBtn = "true";
        injectInlineButton(img);
    } else if (!img.complete) {
        // If the image hasn't finished loading its dimensions yet, wait for it
        img.addEventListener('load', () => {
            if (img.clientWidth > 400 && img.clientHeight > 500 && !img.dataset.hasMangaLensBtn) {
                img.dataset.hasMangaLensBtn = "true";
                injectInlineButton(img);
            }
        }, { once: true });
    }
}

// Process any images already on the page during initial load
document.querySelectorAll('img').forEach(processImage);

// Watch the DOM for any new images being lazy-loaded (infinite scroll)
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'IMG') {
                    processImage(node);
                } else if (node.querySelectorAll) {
                    // If a wrapper div was added, check inside it for images
                    const images = node.querySelectorAll('img');
                    images.forEach(processImage);
                }
            });
        }
    }
});

// Start observing the body
observer.observe(document.body, { childList: true, subtree: true });

// ==========================================
// 2. INLINE BUTTON LOGIC
// ==========================================

function injectInlineButton(targetImage) {
    const btn = document.createElement('button');
    btn.innerText = '✨';
    btn.className = 'mangalens-inline-btn';

    positionInlineButton(btn, targetImage);
    document.body.appendChild(btn);

    btn.addEventListener('click', async () => {
        btn.innerText = '⏳';
        await injectTranslationUI(targetImage);
        btn.innerText = '✨';
    });

    window.addEventListener('resize', () => positionInlineButton(btn, targetImage));
}

function positionInlineButton(btn, targetImage) {
    const rect = targetImage.getBoundingClientRect();
    btn.style.position = 'absolute';
    btn.style.top = `${rect.top + window.scrollY + 16}px`;
    btn.style.left = `${rect.left + window.scrollX + 16}px`;
}

// ==========================================
// 3. FULL TRANSLATION PIPELINE
// ==========================================

async function injectTranslationUI(targetImage = null) {
    if (!targetImage) {
        const images = Array.from(document.querySelectorAll('img'));
        let maxArea = 0;
        images.forEach(img => {
            const area = img.clientWidth * img.clientHeight;
            if (area > maxArea) {
                maxArea = area;
                targetImage = img;
            }
        });
    }

    if (!targetImage) {
        alert("MangaLens: Couldn't find a suitable image.");
        return;
    }

    injectStyles();

    const loader = document.createElement('div');
    loader.className = 'mangalens-loader';
    loader.innerHTML = '<div class="spinner"></div><p>Gemini is translating...</p>';
    positionOverlay(loader, targetImage);
    document.body.appendChild(loader);

    try {
        // Crucial fix: Make sure we are grabbing targetImage.src, NOT mainImage.src
        const response = await chrome.runtime.sendMessage({
            action: 'process_image_url',
            imageUrl: targetImage.src
        });

        loader.remove();

        if (!response || !response.success) {
            alert("MangaLens Error: " + (response?.error || "Failed to communicate with Background worker."));
            return;
        }

        const overlayContainer = document.createElement('div');
        overlayContainer.className = 'mangalens-container';
        positionOverlay(overlayContainer, targetImage);

        const translations = response.data;
        translations.forEach(item => {
            const [ymin, xmin, ymax, xmax] = item.box_2d;

            const bubble = document.createElement('div');
            bubble.className = 'mangalens-bubble';
            bubble.innerText = item.translation;

            bubble.style.top = `${ymin / 10}%`;
            bubble.style.left = `${xmin / 10}%`;
            bubble.style.height = `${(ymax - ymin) / 10}%`;
            bubble.style.width = `${(xmax - xmin) / 10}%`;

            overlayContainer.appendChild(bubble);
        });

        document.body.appendChild(overlayContainer);
        window.addEventListener('resize', () => positionOverlay(overlayContainer, targetImage));

    } catch (error) {
        loader.remove();
        console.error("MangaLens runtime error:", error);
        alert("An unexpected error occurred. Check the console.");
    }
}