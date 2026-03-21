// ==========================================
// STATE & CONFIG
// ==========================================
const state = { showBtns: true, studyMode: false };
const isMac = navigator.userAgent.includes('Mac');
const modKey = isMac ? 'Ctrl' : 'Alt';

chrome.storage.local.get(['showInlineBtns', 'defaultStudyMode'], (res) => {
    if (res.showInlineBtns !== undefined) state.showBtns = res.showInlineBtns;
    if (res.defaultStudyMode !== undefined) state.studyMode = res.defaultStudyMode;
});

// ==========================================
// EVENT LISTENERS
// ==========================================
if (window.navigation) window.navigation.addEventListener('navigate', fullReset);
window.addEventListener('popstate', fullReset);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_page") {
        injectTranslationUI(null, request.shortcutScreenshot);
        return;
    }

    if (request.action === "reload_page") {
        handleReload(request.shortcutScreenshot);
        return;
    }

    if (request.action === "toggle_visibility") {
        toggleStudyMode();
        return;
    }

    if (request.action === "update_settings") {
        state.showBtns = request.showBtns;
        state.studyMode = request.studyMode;
        document.querySelectorAll('.mangalens-btn-group').forEach(group => {
            group.style.display = state.showBtns ? 'flex' : 'none';
        });
        return;
    }

    if (request.action === "clear_page_cache" || request.action === "reset_ui") {
        removeUI('.mangalens-container, .mangalens-loader');
        document.querySelectorAll('.mangalens-btn-group').forEach(group => {
            setButtonState(group.dataset.groupId, 'default');
        });

        if (request.action === "reset_ui") return;

        const keysToRemove = Array.from(document.querySelectorAll('img'))
            .filter(img => img.src)
            .map(img => 'manga_cache_' + img.src);

        if (keysToRemove.length) {
            chrome.storage.local.remove(keysToRemove, () => sendResponse({ cleared: keysToRemove.length }));
        } else {
            sendResponse({ cleared: 0 });
        }
        return true; // Keep the message channel open for the async response
    }
});

const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
            if (node.tagName === 'IMG') processImage(node);
            else if (node.querySelectorAll) node.querySelectorAll('img').forEach(processImage);
        });
    }
});
domObserver.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('img').forEach(processImage);

// ==========================================
// CORE LOGIC
// ==========================================
function fullReset() {
    removeUI('.mangalens-container, .mangalens-loader, .mangalens-btn-group');
    document.querySelectorAll('img').forEach(img => delete img.dataset.hasMangaLensBtn);
    setTimeout(() => document.querySelectorAll('img').forEach(processImage), 100);
}

function processImage(img) {
    if (img.dataset.hasMangaLensBtn) return;

    const tryAttach = () => {
        if (img.clientWidth > 300 && img.clientHeight > 400 && !img.dataset.hasMangaLensBtn) {
            img.dataset.hasMangaLensBtn = "true";
            injectInlineButton(img);
            return true;
        }
        return false;
    };

    if (tryAttach()) return;

    const resizeObserver = new ResizeObserver(() => {
        if (tryAttach()) resizeObserver.disconnect();
    });
    resizeObserver.observe(img);
}

async function injectTranslationUI(targetImage = null, shortcutPayload = null) {
    let isScreenshot = false;
    if (!targetImage) targetImage = getCenterImage();
    if (!targetImage) isScreenshot = true;

    const targetId = isScreenshot ? 'screenshot' : (targetImage.dataset.mangalensId || 'panel_' + Math.random().toString(36).substr(2, 9));
    if (!isScreenshot) targetImage.dataset.mangalensId = targetId;

    setButtonState(targetId, 'loading');
    removeUI(`.mangalens-container[data-mangalens-id="${targetId}"], .mangalens-loader[data-mangalens-id="${targetId}"]`);

    const loader = document.createElement('div');
    loader.className = 'mangalens-loader';
    loader.dataset.mangalensId = targetId;
    loader.innerHTML = '<div class="spinner"></div><p>Scanning...</p>';

    document.body.appendChild(loader);
    if (isScreenshot) setupFixedOverlay(loader);
    else syncPosition(loader, targetImage);

    try {
        const payload = isScreenshot
            ? { action: shortcutPayload ? 'process_base64_screenshot' : 'process_screenshot', dataUrl: shortcutPayload }
            : { action: 'process_image_url', imageUrl: targetImage.src };

        const response = await chrome.runtime.sendMessage(payload);
        loader.remove();

        if (!response?.success) throw new Error(response?.error || "Background worker failed.");

        const container = document.createElement('div');
        container.className = `mangalens-container ${state.studyMode ? 'mangalens-study-mode' : ''}`;
        container.dataset.mangalensId = targetId;

        document.body.appendChild(container);
        if (isScreenshot) setupFixedOverlay(container);
        else syncPosition(container, targetImage);

        response.data.forEach(item => {
            const [ymin, xmin, ymax, xmax] = item.box_2d;
            const bubble = document.createElement('div');
            bubble.className = 'mangalens-bubble';
            bubble.innerText = item.translation;
            bubble.style.top = `${(ymin + ymax) / 20}%`;
            bubble.style.left = `${(xmin + xmax) / 20}%`;
            bubble.style.transform = 'translate(-50%, -50%)';
            bubble.style.minHeight = `${(ymax - ymin) / 10}%`;

            if (item.type === 'dialogue') {
                bubble.style.minWidth = '140px';
                bubble.style.maxWidth = '240px';
            } else {
                bubble.style.width = `${(xmax - xmin) / 10}%`;
            }
            container.appendChild(bubble);
        });

        setButtonState(targetId, state.studyMode ? 'hidden' : 'visible');

        if (isScreenshot) {
            const cleanup = (e) => {
                if (e?.type === 'keydown' && !['ArrowRight', 'ArrowLeft', 'Space', 'KeyH', 'KeyJ'].includes(e.code)) return;
                removeUI('.mangalens-container');
                ['mousedown', 'keydown', 'scroll', 'resize'].forEach(evt => window.removeEventListener(evt, cleanup));
            };
            ['mousedown', 'keydown', 'scroll', 'resize'].forEach(evt => window.addEventListener(evt, cleanup, { once: ['scroll', 'resize'].includes(evt) }));
        } else {
            const srcObserver = new MutationObserver(() => { fullReset(); srcObserver.disconnect(); });
            srcObserver.observe(targetImage, { attributes: true, attributeFilter: ['src'] });
        }
    } catch (error) {
        loader.remove();
        setButtonState(targetId, 'default');
        console.error("MangaLens error:", error);
    }
}

// ==========================================
// UI COMPONENTS & POSITIONING
// ==========================================
function injectInlineButton(targetImage) {
    const panelId = targetImage.dataset.mangalensId || 'panel_' + Math.random().toString(36).substr(2, 9);
    targetImage.dataset.mangalensId = panelId;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'mangalens-btn-group';
    btnGroup.dataset.groupId = panelId;
    btnGroup.style.display = state.showBtns ? 'flex' : 'none';

    btnGroup.innerHTML = `
        <button data-btn-id="${panelId}" class="mangalens-inline-btn" title="Translate Panel (${modKey} + T)" style="pointer-events: auto !important;">✨</button>
        <button data-refresh-btn-id="${panelId}" class="mangalens-inline-btn" title="Reload (${modKey} + R)" style="pointer-events: auto !important; display: none;">🔄</button>
    `;

    const stopHijack = (e) => e.stopPropagation();
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(evt => btnGroup.addEventListener(evt, stopHijack));

    btnGroup.querySelector('[data-btn-id]').addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const btn = e.currentTarget; // <-- Change to currentTarget

        if (btn.innerText === '⏳') return;
        if (btn.innerText === '👁️') {
            toggleStudyMode(panelId);
            return;
        }
        await injectTranslationUI(targetImage);
    });

    btnGroup.querySelector('[data-refresh-btn-id]').addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        removeUI(`.mangalens-container[data-mangalens-id="${panelId}"]`);
        chrome.storage.local.remove('manga_cache_' + targetImage.src, () => injectTranslationUI(targetImage));
    });

    (targetImage.offsetParent || document.body).appendChild(btnGroup);
    syncPosition(btnGroup, targetImage, true);
}

// Unified positioning engine for buttons AND overlays
function syncPosition(sourceEl, targetImage, isButton = false) {
    sourceEl.style.position = 'absolute';
    const container = targetImage.offsetParent || document.body;
    if (sourceEl.parentElement !== container) container.appendChild(sourceEl);

    function sync() {
        if (!sourceEl.isConnected || !targetImage.isConnected) {
            if (isButton) sourceEl.remove();
            return;
        }
        const imgRect = targetImage.getBoundingClientRect();
        const contRect = container === document.body ? { top: -window.scrollY, left: -window.scrollX } : container.getBoundingClientRect();

        const top = (imgRect.top - contRect.top) + (container === document.body ? 0 : container.scrollTop);
        const left = (imgRect.left - contRect.left) + (container === document.body ? 0 : container.scrollLeft);

        sourceEl.style.top = `${top + (isButton ? 16 : 0)}px`;
        sourceEl.style.left = `${left + (isButton ? 16 : 0)}px`;

        if (!isButton) {
            sourceEl.style.width = `${imgRect.width}px`;
            sourceEl.style.height = `${imgRect.height}px`;
        }
        requestAnimationFrame(sync);
    }
    requestAnimationFrame(sync);
}

// ==========================================
// HELPERS
// ==========================================
const removeUI = (selector) => document.querySelectorAll(selector).forEach(el => el.remove());
const setupFixedOverlay = (el) => Object.assign(el.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh' });

function setButtonState(panelId, status) {
    const btn = document.querySelector(`[data-btn-id="${panelId}"]`);
    const refBtn = document.querySelector(`[data-refresh-btn-id="${panelId}"]`);
    if (!btn) return;

    const states = {
        'default': { text: '✨', opacity: '1', title: 'Translate Panel', showRef: false },
        'loading': { text: '⏳', opacity: '1', title: 'Translating...', showRef: false },
        'visible': { text: '👁️', opacity: '1', title: 'Hide Translations', showRef: state.showBtns },
        'hidden':  { text: '👁️', opacity: '0.5', title: 'Unhide Translations', showRef: false }
    };

    const cfg = states[status];
    btn.innerText = cfg.text;
    btn.style.opacity = cfg.opacity;
    btn.title = `${cfg.title} (${modKey} + ${status.includes('hide') ? 'H' : 'T'})`;
    if (refBtn) refBtn.style.display = cfg.showRef ? 'block' : 'none';
}

function toggleStudyMode(specificPanelId = null) {
    const containers = specificPanelId
        ? document.querySelectorAll(`.mangalens-container[data-mangalens-id="${specificPanelId}"]`)
        : document.querySelectorAll('.mangalens-container');

    if (!containers.length) return;

    const isHidden = containers[0].classList.contains('mangalens-study-mode');
    containers.forEach(c => c.classList.toggle('mangalens-study-mode', !isHidden));

    document.querySelectorAll('.mangalens-btn-group').forEach(group => {
        if (group.querySelector('.mangalens-inline-btn').innerText === '👁️') {
            setButtonState(group.dataset.groupId, isHidden ? 'visible' : 'hidden');
        }
    });
}

function handleReload(shortcutPayload) {
    const targetImage = getCenterImage();
    if (!targetImage) {
        removeUI('.mangalens-container, .mangalens-loader');
        injectTranslationUI(null, shortcutPayload);
    } else {
        removeUI(`.mangalens-container[data-mangalens-id="${targetImage.dataset.mangalensId}"]`);
        chrome.storage.local.remove('manga_cache_' + targetImage.src, () => injectTranslationUI(targetImage));
    }
}

function getCenterImage() {
    const images = Array.from(document.querySelectorAll('img')).filter(img => img.clientWidth > 300 && img.clientHeight > 400);
    if (!images.length) return null;

    const center = window.innerHeight / 2;
    return images.reduce((closest, img) => {
        const dist = Math.abs(center - (img.getBoundingClientRect().top + img.clientHeight / 2));
        return dist < closest.dist ? { img, dist } : closest;
    }, { img: null, dist: Infinity }).img;
}

// ==========================================
// STYLES
// ==========================================
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
    
    .mangalens-study-mode .mangalens-bubble {
        opacity: 0;
    }
    
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
        background: rgba(255, 255, 255, 0.1);
        transform: none;
    }
    `;
    document.head.appendChild(style);
})();