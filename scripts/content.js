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

// Button positioned on panel visibility state
let showButtonsConfig = true;

chrome.storage.local.get(['showInlineBtns'], (result) => {
    if (result.showInlineBtns !== undefined) {
        showButtonsConfig = result.showInlineBtns;
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_page") {
        injectTranslationUI();
    } else if (request.action === "toggle_buttons") {
        showButtonsConfig = request.show;
        document.querySelectorAll('.mangalens-inline-btn').forEach(btn => {
            btn.style.display = showButtonsConfig ? 'block' : 'none';
        });
    }
});

// Listen for the trigger from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_page") {
        injectTranslationUI();
    }
});

// Mutation observer
function processImage(img) {
    if (img.dataset.hasMangaLensBtn) return;

    // Safe thresholds to ensure only actual manga panels are targeted
    const MIN_WIDTH = 300;
    const MIN_HEIGHT = 400;

    const tryAttach = () => {
        if (img.clientWidth > MIN_WIDTH && img.clientHeight > MIN_HEIGHT && !img.dataset.hasMangaLensBtn) {
            img.dataset.hasMangaLensBtn = "true";
            injectInlineButton(img);
            return true;
        }
        return false;
    };

    if (tryAttach()) return;

    const resizeObserver = new ResizeObserver(() => {
        if (tryAttach()) {
            resizeObserver.disconnect();
        }
    });
    resizeObserver.observe(img);
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


// Button positioned on panels
function injectInlineButton(targetImage) {
    const btn = document.createElement('button');
    btn.innerText = '✨';
    btn.className = 'mangalens-inline-btn';
    btn.style.display = showButtonsConfig ? 'block' : 'none';

    btn.style.position = 'absolute';
    btn.style.setProperty('pointer-events', 'auto'); // Break out of inherited ghosting

    const container = targetImage.offsetParent || document.body;
    container.appendChild(btn);

    const stopHijack = (e) => e.stopPropagation();

    btn.addEventListener('mousedown', stopHijack);
    btn.addEventListener('mouseup', stopHijack);
    btn.addEventListener('pointerdown', stopHijack);
    btn.addEventListener('pointerup', stopHijack);

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.innerText === '⏳') return;

        btn.innerText = '⏳';
        await injectTranslationUI(targetImage);
        if (btn.isConnected) btn.innerText = '✨';
    });

    function syncBtn() {
        if (!targetImage.isConnected) {
            btn.remove();
            return;
        }

        const imgRect = targetImage.getBoundingClientRect();
        let newTop, newLeft;

        if (container === document.body) {
            newTop = `${imgRect.top + window.scrollY + 16}px`;
            newLeft = `${imgRect.left + window.scrollX + 16}px`;
        } else {
            const containerRect = container.getBoundingClientRect();
            newTop = `${(imgRect.top - containerRect.top) + container.scrollTop + 16}px`;
            newLeft = `${(imgRect.left - containerRect.left) + container.scrollLeft + 16}px`;
        }

        if (btn.style.top !== newTop) btn.style.top = newTop;
        if (btn.style.left !== newLeft) btn.style.left = newLeft;

        requestAnimationFrame(syncBtn);
    }
    requestAnimationFrame(syncBtn);
}

// Helper to find the image closest to the vertical center of the viewport
function getCenterImage() {
    // Only look at images that meet manga panel size thresholds
    const images = Array.from(document.querySelectorAll('img')).filter(img =>
        img.clientWidth > 300 && img.clientHeight > 400
    );

    if (images.length === 0) return null;

    const viewportCenter = window.innerHeight / 2;
    let closestImage = null;
    let minDistance = Infinity;

    images.forEach(img => {
        const rect = img.getBoundingClientRect();
        const imageCenter = rect.top + (rect.height / 2);
        const distance = Math.abs(viewportCenter - imageCenter);

        if (distance < minDistance) {
            minDistance = distance;
            closestImage = img;
        }
    });

    return closestImage;
}

// Translation pipeline
async function injectTranslationUI(targetImage = null) {
    document.querySelectorAll('.mangalens-container, .mangalens-loader').forEach(el => el.remove());

    let isScreenshotMode = false;

    // 1. Try to find a standard manga image
    if (!targetImage) {
        targetImage = getCenterImage();
    }

    // 2. THE FALLBACK: No image found (BookWalker Canvas). Switch to Screenshot mode!
    if (!targetImage) {
        isScreenshotMode = true;
    }

    injectStyles();

    const loader = document.createElement('div');
    loader.className = 'mangalens-loader';
    loader.innerHTML = '<div class="spinner"></div><p>Gemini is scanning...</p>';

    // Position the loader based on the mode
    if (isScreenshotMode) {
        loader.style.position = 'fixed';
        loader.style.top = '0';
        loader.style.left = '0';
        loader.style.width = '100vw';
        loader.style.height = '100vh';
        document.body.appendChild(loader);
    } else {
        document.body.appendChild(loader);
        keepOverlaySynced(loader, targetImage);
    }

    try {
        let response;

        // 3. Route the request based on the mode
        if (isScreenshotMode) {
            response = await chrome.runtime.sendMessage({ action: 'process_screenshot' });
        } else {
            response = await chrome.runtime.sendMessage({ action: 'process_image_url', imageUrl: targetImage.src });
        }

        loader.remove();

        if (!response || !response.success) {
            alert("MangaLens Error: " + (response?.error || "Failed to communicate with Background worker."));
            return;
        }

        const overlayContainer = document.createElement('div');
        overlayContainer.className = 'mangalens-container';

        // Lock the container to the entire viewport for screenshots
        if (isScreenshotMode) {
            overlayContainer.style.position = 'fixed';
            overlayContainer.style.top = '0';
            overlayContainer.style.left = '0';
            overlayContainer.style.width = '100vw';
            overlayContainer.style.height = '100vh';
        }

        const translations = response.data;
        translations.forEach(item => {
            const [ymin, xmin, ymax, xmax] = item.box_2d;

            const bubble = document.createElement('div');
            bubble.className = 'mangalens-bubble';
            bubble.innerText = item.translation;

            const centerY = (ymin + ymax) / 20;
            const centerX = (xmin + xmax) / 20;

            bubble.style.top = `${centerY}%`;
            bubble.style.left = `${centerX}%`;
            bubble.style.transform = 'translate(-50%, -50%)';
            bubble.style.width = `${(xmax - xmin) / 10}%`;
            bubble.style.minHeight = `${(ymax - ymin) / 10}%`;

            overlayContainer.appendChild(bubble);
        });

        document.body.appendChild(overlayContainer);

        // 4. Handle Cleanup
        if (isScreenshotMode) {
            const cleanup = () => removeExistingOverlays();
            window.addEventListener('scroll', cleanup, { once: true });
            window.addEventListener('resize', cleanup, { once: true });
        } else {
            keepOverlaySynced(overlayContainer, targetImage);
            const srcObserver = new MutationObserver(() => {
                fullReset();
                srcObserver.disconnect();
            });
            srcObserver.observe(targetImage, { attributes: true, attributeFilter: ['src'] });
        }

    } catch (error) {
        if (loader) loader.remove();
        console.error("MangaLens runtime error:", error);
        alert("An unexpected error occurred. Check the console.");
    }
}


// Helpers
function keepOverlaySynced(overlayElement, targetImage) {
    overlayElement.style.position = 'absolute';

    // Move the overlay from the body into the scrolling container
    const container = targetImage.offsetParent || document.body;
    if (overlayElement.parentElement !== container) {
        container.appendChild(overlayElement);
    }

    function sync() {
        if (!overlayElement.isConnected || !targetImage.isConnected) return;

        const imgRect = targetImage.getBoundingClientRect();
        let newTop, newLeft;

        if (container === document.body) {
            newTop = `${imgRect.top + window.scrollY}px`;
            newLeft = `${imgRect.left + window.scrollX}px`;
        } else {
            const containerRect = container.getBoundingClientRect();
            newTop = `${(imgRect.top - containerRect.top) + container.scrollTop}px`;
            newLeft = `${(imgRect.left - containerRect.left) + container.scrollLeft}px`;
        }

        const newWidth = `${imgRect.width}px`;
        const newHeight = `${imgRect.height}px`;

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