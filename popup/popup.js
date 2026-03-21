document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const inlineBtnToggle = document.getElementById('inlineBtnToggle');
    const defaultStudyModeToggle = document.getElementById('defaultStudyModeToggle');
    const saveBtn = document.getElementById('saveBtn');
    const translateBtn = document.getElementById('translateBtn');
    const modelBadge = document.getElementById('modelBadge');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');
    const initClearBtn = document.getElementById('initClearBtn');
    const cacheWarning = document.getElementById('cacheWarning');
    const wipePageBtn = document.getElementById('wipePageBtn');
    const wipeAllBtn = document.getElementById('wipeAllBtn');
    const cancelWipeBtn = document.getElementById('cancelWipeBtn');

    // --- HELPER FUNCTIONS ---
    async function sendMessageToActiveTab(message, callback) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) chrome.tabs.sendMessage(tab.id, message, callback);
    }

    function updateBadgeUI() {
        if (modelSelect.selectedIndex === -1) modelSelect.selectedIndex = 0;
        modelBadge.textContent = modelSelect.options[modelSelect.selectedIndex].text.replace(' (Default)', '');
    }

    // --- UI NAVIGATION ---
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    // --- INITIALIZATION ---
    chrome.storage.local.get(['geminiApiKey', 'selectedModel', 'showInlineBtns', 'defaultStudyMode'], (result) => {
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
        if (result.selectedModel) {
            modelSelect.value = result.selectedModel;
            updateBadgeUI();
        }
        if (result.showInlineBtns !== undefined) inlineBtnToggle.checked = result.showInlineBtns;
        if (result.defaultStudyMode !== undefined) defaultStudyModeToggle.checked = result.defaultStudyMode;

        document.body.classList.add('loaded');
    });

    // --- MAIN ACTIONS ---
    saveBtn.addEventListener('click', () => {
        const dataToSave = {
            selectedModel: modelSelect.value,
            showInlineBtns: inlineBtnToggle.checked,
            defaultStudyMode: defaultStudyModeToggle.checked
        };
        if (apiKeyInput.value.trim()) dataToSave.geminiApiKey = apiKeyInput.value.trim();

        chrome.storage.local.set(dataToSave, () => {
            updateBadgeUI();
            sendMessageToActiveTab({
                action: "update_settings",
                showBtns: dataToSave.showInlineBtns,
                studyMode: dataToSave.defaultStudyMode
            });

            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saved Successfully!';
            saveBtn.classList.add('success');

            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.classList.remove('success');
            }, 2000);
        });
    });

    translateBtn.addEventListener('click', () => {
        sendMessageToActiveTab({ action: "translate_page" });
    });

    // --- CACHE MANAGEMENT ---
    initClearBtn.addEventListener('click', () => {
        initClearBtn.style.display = 'none';
        cacheWarning.style.display = 'block';
    });

    cancelWipeBtn.addEventListener('click', () => {
        cacheWarning.style.display = 'none';
        initClearBtn.style.display = 'flex';
    });

    wipePageBtn.addEventListener('click', () => {
        const originalText = wipePageBtn.textContent;
        wipePageBtn.textContent = 'Clearing...';

        sendMessageToActiveTab({ action: "clear_page_cache" }, (response) => {
            if (chrome.runtime.lastError || !response || response.cleared === 0) {
                wipePageBtn.textContent = 'Nothing to clear here!';
            } else {
                wipePageBtn.textContent = `Cleared ${response.cleared} panels!`;
            }

            setTimeout(() => {
                cancelWipeBtn.click();
                wipePageBtn.textContent = originalText;
            }, 2000);
        });
    });

    wipeAllBtn.addEventListener('click', () => {
        const originalText = wipeAllBtn.textContent;
        wipeAllBtn.textContent = 'Clearing all...';

        chrome.storage.local.get(null, (items) => {
            const keysToRemove = Object.keys(items).filter(key => key.startsWith('manga_cache_'));

            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove, () => {
                    wipeAllBtn.textContent = 'All caches cleared.';
                    sendMessageToActiveTab({ action: "reset_ui" });

                    setTimeout(() => {
                        cancelWipeBtn.click();
                        wipeAllBtn.textContent = originalText;
                    }, 2000);
                });
            } else {
                wipeAllBtn.textContent = 'Cache is already empty.';
                setTimeout(() => { wipeAllBtn.textContent = originalText; }, 2000);
            }
        });
    });
});