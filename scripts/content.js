// State & configuration
let showButtonsConfig = true;
let defaultStudyModeConfig = false;

// Detect OS to show the correct keyboard shortcut in tooltips
const isMac = navigator.userAgent.includes('Mac');
const modKey = isMac ? 'Ctrl' : 'Alt';

chrome.storage.local.get(['showInlineBtns', 'defaultStudyMode'], (result) => {
    if (result.showInlineBtns !== undefined) {
        showButtonsConfig = result.showInlineBtns;
    }
    if (result.defaultStudyMode !== undefined) {
        defaultStudyModeConfig = result.defaultStudyMode; // <-- LOAD STATE
    }
});

// Event listeners & observers
if (window.navigation) {
    window.navigation.addEventListener('navigate', fullReset);
}
window.addEventListener('popstate', fullReset);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_page") {
        injectTranslationUI(null, request.shortcutScreenshot);
    } else if (request.action === "reload_page") {
        handleReloadShortcut(request.shortcutScreenshot);
    } else if (request.action === "toggle_visibility") {
        handleToggleShortcut();
    } else if (request.action === "update_settings") {
        // LIVE UPDATE BOTH VARIABLES!
        showButtonsConfig = request.showBtns;
        defaultStudyModeConfig = request.studyMode;

        // Sync the physical Ghost Pills visibility
        document.querySelectorAll('.mangalens-btn-group').forEach(group => {
            group.style.display = showButtonsConfig ? 'flex' : 'none';
        });
    } else if (request.action === "clear_page_cache" || request.action === "reset_ui") {
        // 1. INSTANT UI WIPE: Destroy active bubbles and loaders
        document.querySelectorAll('.mangalens-container, .mangalens-loader').forEach(el => el.remove());

        // 2. RESET BUTTONS: Put the Ghost Pills back to their default state
        document.querySelectorAll('.mangalens-btn-group').forEach(group => {
            const mainBtn = group.querySelector('[data-btn-id]');
            const refreshBtn = group.querySelector('[data-refresh-btn-id]');

            if (mainBtn) {
                mainBtn.innerText = '✨';
                mainBtn.style.opacity = '1';
                mainBtn.title = `Translate Panel (${modKey} + T)`;
            }
            if (refreshBtn) {
                refreshBtn.style.display = 'none';
            }
        });

        // If we only wanted a UI reset (because popup.js handled the global storage wipe), stop here!
        if (request.action === "reset_ui") {
            return;
        }

        // 3. STORAGE WIPE (Only runs for clear_page_cache): Find every image on the screen
        const keysToRemove = [];
        document.querySelectorAll('img').forEach(img => {
            if (img.src) keysToRemove.push('manga_cache_' + img.src);
        });

        // 4. Execute the database wipe for the current page
        if (keysToRemove.length > 0) {
            chrome.storage.local.remove(keysToRemove, () => {
                sendResponse({ cleared: keysToRemove.length });
            });
        } else {
            sendResponse({ cleared: 0 });
        }

        return true;
    }
});

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'IMG') {
                    processImage(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('img').forEach(processImage);
                }
            });
        }
    }
});
observer.observe(document.body, { childList: true, subtree: true });

document.querySelectorAll('img').forEach(processImage);


// Core logic
function fullReset() {
    document.querySelectorAll('.mangalens-container, .mangalens-loader, .mangalens-inline-btn').forEach(el => el.remove());
    document.querySelectorAll('img').forEach(img => {
        delete img.dataset.hasMangaLensBtn;
    });

    setTimeout(() => {
        document.querySelectorAll('img').forEach(processImage);
    }, 100);
}

function processImage(img) {
    if (img.dataset.hasMangaLensBtn) return;

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

async function injectTranslationUI(targetImage = null, shortcutPayload = null) {
    let isScreenshotMode = false;

    if (!targetImage) targetImage = getCenterImage();
    if (!targetImage) isScreenshotMode = true;

    if (!isScreenshotMode && !targetImage.dataset.mangalensId) {
        targetImage.dataset.mangalensId = 'panel_' + Math.random().toString(36).substr(2, 9);
    }

    let linkedMainBtn = null;
    let linkedRefreshBtn = null;

    if (!isScreenshotMode) {
        const targetId = targetImage.dataset.mangalensId;
        linkedMainBtn = document.querySelector(`[data-btn-id="${targetId}"]`);
        linkedRefreshBtn = document.querySelector(`[data-refresh-btn-id="${targetId}"]`);

        if (linkedMainBtn && linkedMainBtn.innerText !== '⏳') {
            linkedMainBtn.innerText = '⏳';
            linkedMainBtn.title = 'Translating...';
            if (linkedRefreshBtn) linkedRefreshBtn.style.display = 'none';
        }
    }

    // Teardown previous UI for the specific target
    if (isScreenshotMode) {
        document.querySelectorAll('.mangalens-container, .mangalens-loader').forEach(el => el.remove());
    } else {
        const targetId = targetImage.dataset.mangalensId;
        document.querySelectorAll(`.mangalens-container[data-mangalens-id="${targetId}"], .mangalens-loader[data-mangalens-id="${targetId}"]`).forEach(el => el.remove());
    }

    const loader = document.createElement('div');
    loader.className = 'mangalens-loader';
    loader.innerHTML = '<div class="spinner"></div><p>Scanning...</p>';

    if (!isScreenshotMode) {
        loader.dataset.mangalensId = targetImage.dataset.mangalensId;
    }

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

        if (isScreenshotMode) {
            if (shortcutPayload) {
                response = await chrome.runtime.sendMessage({
                    action: 'process_base64_screenshot',
                    dataUrl: shortcutPayload
                });
            } else {
                response = await chrome.runtime.sendMessage({ action: 'process_screenshot' });
            }
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

        if (defaultStudyModeConfig) {
            overlayContainer.classList.add('mangalens-study-mode');
        }

        if (!isScreenshotMode) {
            overlayContainer.dataset.mangalensId = targetImage.dataset.mangalensId;
        } else {
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
            bubble.style.minHeight = `${(ymax - ymin) / 10}%`;

            // THE SMART LAYOUT ROUTER
            if (item.type === 'dialogue') {
                // Dialogue gets a comfortable horizontal reading shape
                bubble.style.minWidth = '140px';
                bubble.style.maxWidth = '240px';
            } else {
                // SFX and background signs get locked to their strict, narrow bounding box
                bubble.style.width = `${(xmax - xmin) / 10}%`;
            }

            overlayContainer.appendChild(bubble);
        });

        document.body.appendChild(overlayContainer);

        if (linkedMainBtn) {
            linkedMainBtn.innerText = '👁️';
            linkedMainBtn.style.opacity = defaultStudyModeConfig ? '0.5' : '1';
            linkedMainBtn.title = `${defaultStudyModeConfig ? 'Unhide' : 'Hide'} Translations (${modKey} + H)`;
        }
        if (linkedRefreshBtn && showButtonsConfig)
            linkedRefreshBtn.style.display = (!defaultStudyModeConfig && showButtonsConfig) ? 'block' : 'none';

        // Event cleanup
        if (isScreenshotMode) {
            const cleanup = (e) => {
                // If it's a key press, ONLY clear the UI if it's an arrow key or spacebar (pagination keys)
                if (e && e.type === 'keydown' && !['ArrowRight', 'ArrowLeft', 'Space', 'KeyH', 'KeyJ'].includes(e.code)) return;

                document.querySelectorAll('.mangalens-container').forEach(el => el.remove());

                // Remove listeners so they don't pile up
                window.removeEventListener('mousedown', cleanup);
                window.removeEventListener('keydown', cleanup);
                window.removeEventListener('scroll', cleanup);
                window.removeEventListener('resize', cleanup);
            };

            // Listen for canvas type panel viewers page turn actions
            window.addEventListener('mousedown', cleanup); // Catch mouse clicks on the canvas
            window.addEventListener('keydown', cleanup);   // Catch keyboard page turns
            window.addEventListener('scroll', cleanup, { once: true });
            window.addEventListener('resize', cleanup, { once: true });
        } else{
            keepOverlaySynced(overlayContainer, targetImage);
            const srcObserver = new MutationObserver(() => {
                fullReset();
                srcObserver.disconnect();
            });
            srcObserver.observe(targetImage, { attributes: true, attributeFilter: ['src'] });
        }

    } catch (error) {
        if (loader) loader.remove();
        if (linkedMainBtn) {
            linkedMainBtn.innerText = '✨';
            linkedMainBtn.title = `Translate Panel (${modKey} + T)`;
        }
        console.error("MangaLens runtime error:", error);
    }
}


// UI Components
function injectInlineButton(targetImage) {
    if (!targetImage.dataset.mangalensId) {
        targetImage.dataset.mangalensId = 'panel_' + Math.random().toString(36).substr(2, 9);
    }
    const panelId = targetImage.dataset.mangalensId;

    // --- NEW: THE PILL CONTAINER ---
    const btnGroup = document.createElement('div');
    btnGroup.className = 'mangalens-btn-group';
    btnGroup.dataset.groupId = panelId;
    btnGroup.style.display = showButtonsConfig ? 'flex' : 'none';

    // --- 1. Main Toggle Button (No longer absolute) ---
    const btn = document.createElement('button');
    btn.dataset.btnId = panelId;
    btn.innerText = '✨';
    btn.title = `Translate Panel (${modKey} + T)`;
    btn.className = 'mangalens-inline-btn';
    btn.style.setProperty('pointer-events', 'auto', 'important');

    // --- 2. Refresh Button (No longer absolute) ---
    const refreshBtn = document.createElement('button');
    refreshBtn.dataset.refreshBtnId = panelId;
    refreshBtn.innerText = '🔄';
    refreshBtn.title = `Reload Translation (${modKey} + R)`;
    refreshBtn.className = 'mangalens-inline-btn';
    refreshBtn.style.setProperty('pointer-events', 'auto', 'important');
    refreshBtn.style.display = 'none'; // Hidden initially

    // Put buttons in the pill, put the pill in the DOM
    btnGroup.appendChild(btn);
    btnGroup.appendChild(refreshBtn);

    const container = targetImage.offsetParent || document.body;
    container.appendChild(btnGroup);

    // The Shield now protects the whole group
    const stopHijack = (e) => e.stopPropagation();
    [btnGroup].forEach(el => {
        el.addEventListener('mousedown', stopHijack);
        el.addEventListener('mouseup', stopHijack);
        el.addEventListener('pointerdown', stopHijack);
        el.addEventListener('pointerup', stopHijack);
    });

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.innerText === '⏳') return;

        const targetId = targetImage.dataset.mangalensId;
        if (targetId) {
            const existingContainer = document.querySelector(`.mangalens-container[data-mangalens-id="${targetId}"]`);
            if (existingContainer) {
                btn.innerText = '👁️';

                // Toggle Study Mode via CSS Class
                if (existingContainer.classList.contains('mangalens-study-mode')) {
                    existingContainer.classList.remove('mangalens-study-mode');
                    btn.style.opacity = '1';
                    btn.title = `Hide Translations (${modKey} + H)`;
                    refreshBtn.style.display = showButtonsConfig ? 'block' : 'none';
                } else {
                    existingContainer.classList.add('mangalens-study-mode');
                    btn.style.opacity = '0.5';
                    btn.title = `Unhide Translations (${modKey} + H)`;
                    refreshBtn.style.display = 'none';
                }
                return;
            }
        }

        btn.innerText = '⏳';
        btn.title = 'Translating...';
        refreshBtn.style.display = 'none';
        await injectTranslationUI(targetImage);

        if (btn.isConnected) {
            btn.innerText = '👁️';
            btn.title = `Hide Translations (${modKey} + H)`;
            refreshBtn.style.display = showButtonsConfig ? 'block' : 'none';
        }
    });

    refreshBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetId = targetImage.dataset.mangalensId;
        if (targetId) {
            document.querySelectorAll(`.mangalens-container[data-mangalens-id="${targetId}"]`).forEach(el => el.remove());
        }

        const cacheKey = 'manga_cache_' + targetImage.src;
        chrome.storage.local.remove(cacheKey, async () => {
            btn.innerText = '⏳';
            refreshBtn.style.display = 'none';

            await injectTranslationUI(targetImage);

            if (btn.isConnected) {
                btn.innerText = '👁️';
                refreshBtn.style.display = showButtonsConfig ? 'block' : 'none';
            }
        });
    });

    function syncBtn() {
        if (!targetImage.isConnected) {
            btnGroup.remove(); // Remove the group!
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

        // Just move the pill, flexbox handles the rest!
        if (btnGroup.style.top !== newTop) btnGroup.style.top = newTop;
        if (btnGroup.style.left !== newLeft) btnGroup.style.left = newLeft;

        requestAnimationFrame(syncBtn);
    }
    requestAnimationFrame(syncBtn);
}


// Helpers
function handleToggleShortcut() {
    const containers = document.querySelectorAll('.mangalens-container');
    if (containers.length === 0) return;

    // Check if the first container has the study mode class
    const isCurrentlyHidden = containers[0].classList.contains('mangalens-study-mode');

    // Toggle the class on all containers instead of using display: none
    containers.forEach(c => {
        if (isCurrentlyHidden) {
            c.classList.remove('mangalens-study-mode');
        } else {
            c.classList.add('mangalens-study-mode');
        }
    });

    // Sync the physical buttons to match the new state
    document.querySelectorAll('.mangalens-inline-btn').forEach(btn => {
        if (btn.innerText === '✨' || btn.innerText === '👁️') {
            const panelId = btn.dataset.btnId;
            const hasContainer = document.querySelector(`.mangalens-container[data-mangalens-id="${panelId}"]`);

            if (hasContainer) {
                btn.innerText = '👁️';
                // If we WERE hidden, we are now visible (opacity 1).
                btn.style.opacity = isCurrentlyHidden ? '1' : '0.5';
                btn.title = `${isCurrentlyHidden ? 'Hide' : 'Unhide'} Translations (${modKey} + H)`;

                const refreshBtn = document.querySelector(`[data-refresh-btn-id="${panelId}"]`);
                if (refreshBtn) {
                    refreshBtn.style.display = (isCurrentlyHidden && showButtonsConfig) ? 'block' : 'none';
                }
            }
        }
    });
}

function handleReloadShortcut(shortcutPayload) {
    let targetImage = getCenterImage();
    let isScreenshotMode = !targetImage;

    if (isScreenshotMode) {
        // Canvas type panel viewers reload: Wipe the screen and run a fresh screenshot
        document.querySelectorAll('.mangalens-container, .mangalens-loader').forEach(el => el.remove());
        injectTranslationUI(null, shortcutPayload);
    } else {
        // Standard reload: Wipe the specific panel's cache and re-run
        const targetId = targetImage.dataset.mangalensId;
        if (targetId) {
            document.querySelectorAll(`.mangalens-container[data-mangalens-id="${targetId}"]`).forEach(el => el.remove());
        }

        const cacheKey = 'manga_cache_' + targetImage.src;
        chrome.storage.local.remove(cacheKey, () => {
            injectTranslationUI(targetImage);
        });
    }
}

function getCenterImage() {
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

function keepOverlaySynced(overlayElement, targetImage) {
    overlayElement.style.position = 'absolute';

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


// Styles
(function() {
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
      padding: 8px 2px; 
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
      height: auto; 
      overflow-wrap: anywhere;
      word-break: break-word;
      hyphens: auto; 
    }
    .mangalens-bubble:hover {
      opacity: 0;
    }
    /* 1. Make the bubbles invisible but keep their physical hitboxes */
    .mangalens-study-mode .mangalens-bubble {
      opacity: 0; 
    }
    /* 2. When hovering the invisible hitbox, reveal the English */
    .mangalens-study-mode .mangalens-bubble:hover {
      opacity: 1;
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
    .mangalens-btn-group {
      position: absolute;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 2px;
      background: rgba(15, 17, 21, 0.3);
      backdrop-filter: blur(2px);
      border-radius: 20px; 
      padding: 4px;
      transition: all 0.2s ease;
      opacity: 0.4; 
    }
    .mangalens-btn-group:hover {
      opacity: 1; 
      background: rgba(15, 17, 21, 0.85); 
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .mangalens-btn-group .mangalens-inline-btn {
      background: transparent;
      border: none;
      box-shadow: none;
      padding: 4px 8px;
      font-size: 16px;
      cursor: pointer;
      border-radius: 16px;
      transition: background 0.2s;
      color: white;
    }
    .mangalens-btn-group .mangalens-inline-btn:hover {
      background: rgba(255, 255, 255, 0.1); /* Subtle highlight on hover */
      transform: none; 
    }
  `;
    document.head.appendChild(style);
})();