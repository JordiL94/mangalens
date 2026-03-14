// SPA routing listener
if (window.navigation) {
    window.navigation.addEventListener('navigate', fullReset);
}
window.addEventListener('popstate', fullReset);

// Completely wipe all UI and reset state for the new SPA page
function fullReset() {
    // 1. Destroy all containers, loaders, AND orphaned buttons
    document.querySelectorAll('.mangalens-container, .mangalens-loader, .mangalens-inline-btn').forEach(el => el.remove());

    // 2. Untag all images so they can be re-scanned
    document.querySelectorAll('img').forEach(img => {
        delete img.dataset.hasMangaLensBtn;
    });

    // 3. Give the SPA a fraction of a second to mount the new image, then add the correct button
    setTimeout(() => {
        document.querySelectorAll('img').forEach(processImage);
    }, 100);
}

// Listen for the trigger from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_page") {
        injectTranslationUI();
    }
});

// Mutation observer
function processImage(img) {
    if (img.clientWidth > 400 && img.clientHeight > 500 && !img.dataset.hasMangaLensBtn) {
        img.dataset.hasMangaLensBtn = "true";
        injectInlineButton(img);
    } else if (!img.complete) {
        img.addEventListener('load', () => {
            if (img.clientWidth > 400 && img.clientHeight > 500 && !img.dataset.hasMangaLensBtn) {
                img.dataset.hasMangaLensBtn = "true";
                injectInlineButton(img);
            }
        }, { once: true });
    }
}

document.querySelectorAll('img').forEach(processImage);

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'IMG') {
                    processImage(node);
                } else if (node.querySelectorAll) {
                    const images = node.querySelectorAll('img');
                    images.forEach(processImage);
                }
            });
        }
    }
});
observer.observe(document.body, { childList: true, subtree: true });


function injectInlineButton(targetImage) {
    const btn = document.createElement('button');
    btn.innerText = '✨';
    btn.className = 'mangalens-inline-btn';
    btn.style.position = 'absolute';
    document.body.appendChild(btn);

    btn.addEventListener('click', async () => {
        btn.innerText = '⏳';
        await injectTranslationUI(targetImage);
        if (btn.isConnected) btn.innerText = '✨'; // Only reset if button still exists
    });

    // Use the render loop to tie the button's lifecycle to the image
    function syncBtn() {
        // If the site destroys the image, destroy the button instantly
        if (!targetImage.isConnected) {
            btn.remove();
            return;
        }
        const rect = targetImage.getBoundingClientRect();
        btn.style.top = `${rect.top + window.scrollY + 16}px`;
        btn.style.left = `${rect.left + window.scrollX + 16}px`;
        requestAnimationFrame(syncBtn);
    }
    requestAnimationFrame(syncBtn);
}


// Translation pipeline
async function injectTranslationUI(targetImage = null) {
    // Only wipe existing overlays, leave the buttons alone during an active translation
    document.querySelectorAll('.mangalens-container, .mangalens-loader').forEach(el => el.remove());

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
    document.body.appendChild(loader);

    keepOverlaySynced(loader, targetImage);

    try {
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

        const translations = response.data;
        translations.forEach(item => {
            const [ymin, xmin, ymax, xmax] = item.box_2d;

            const bubble = document.createElement('div');
            bubble.className = 'mangalens-bubble';
            bubble.innerText = item.translation;

            // 1. Calculate the true center of the Japanese bubble
            const centerY = (ymin + ymax) / 20;
            const centerX = (xmin + xmax) / 20;

            // 2. Pin the exact center of our HTML div to the center of the Japanese text
            bubble.style.top = `${centerY}%`;
            bubble.style.left = `${centerX}%`;
            bubble.style.transform = 'translate(-50%, -50%)';

            // 3. Set dynamic width/height allowing for text expansion
            bubble.style.width = `${(xmax - xmin) / 10}%`;
            bubble.style.minHeight = `${(ymax - ymin) / 10}%`;

            overlayContainer.appendChild(bubble);
        });

        document.body.appendChild(overlayContainer);
        keepOverlaySynced(overlayContainer, targetImage);

        // Watch this specific image. If the site swaps its 'src', trigger a full reset
        const srcObserver = new MutationObserver(() => {
            fullReset();
            srcObserver.disconnect();
        });
        srcObserver.observe(targetImage, { attributes: true, attributeFilter: ['src'] });

    } catch (error) {
        loader.remove();
        console.error("MangaLens runtime error:", error);
        alert("An unexpected error occurred. Check the console.");
    }
}


function keepOverlaySynced(overlayElement, targetImage) {
    overlayElement.style.position = 'absolute';

    function sync() {
        if (!overlayElement.isConnected || !targetImage.isConnected) return;

        const rect = targetImage.getBoundingClientRect();

        const newTop = `${rect.top + window.scrollY}px`;
        const newLeft = `${rect.left + window.scrollX}px`;
        const newWidth = `${rect.width}px`;
        const newHeight = `${rect.height}px`;

        if (overlayElement.style.top !== newTop) overlayElement.style.top = newTop;
        if (overlayElement.style.left !== newLeft) overlayElement.style.left = newLeft;
        if (overlayElement.style.width !== newWidth) overlayElement.style.width = newWidth;
        if (overlayElement.style.height !== newHeight) overlayElement.style.height = newHeight;

        requestAnimationFrame(sync);
    }
    requestAnimationFrame(sync);
}


function injectStyles() {
    if (document.getElementById('mangalens-styles')) return;

    const style = document.createElement('style');
    style.id = 'mangalens-styles';
    style.textContent = `
    .mangalens-container {
      pointer-events: none;
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
      pointer-events: auto;
      transition: opacity 0.2s ease;
      box-sizing: border-box;
      min-width: 80px;
      height: auto;
      word-wrap: break-word;
      overflow-wrap: break-word;
      hyphens: auto;
    }
    .mangalens-bubble:hover {
      opacity: 0;
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