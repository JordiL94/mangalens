document.addEventListener('DOMContentLoaded', () => {
    // 1. Centralized DOM Elements
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const inlineBtnToggle = document.getElementById('inlineBtnToggle');
    const defaultStudyModeToggle = document.getElementById('defaultStudyModeToggle'); // <-- NEW
    const saveBtn = document.getElementById('saveBtn');
    const translateBtn = document.getElementById('translateBtn');
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const modelBadge = document.getElementById('modelBadge');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));

            // Add active class to clicked tab and corresponding view
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    function updateBadgeUI() {
        // If the saved value doesn't match our HTML options, default to the first one
        if (modelSelect.selectedIndex === -1) {
            modelSelect.selectedIndex = 0;
        }
        const selectedText = modelSelect.options[modelSelect.selectedIndex].text;
        modelBadge.textContent = selectedText.replace(' (Default)', '');
    }

    // 2. Load all saved states consistently
    chrome.storage.local.get(['geminiApiKey', 'selectedModel', 'showInlineBtns', 'defaultStudyMode'], (result) => {
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
        if (result.selectedModel) {
            modelSelect.value = result.selectedModel;
            updateBadgeUI();
        }
        if (result.showInlineBtns !== undefined) {
            inlineBtnToggle.checked = result.showInlineBtns;
        }
        if (result.defaultStudyMode !== undefined) {
            defaultStudyModeToggle.checked = result.defaultStudyMode;
        }

        document.body.classList.add('loaded');
    });

    // 3. Save everything consistently
    saveBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const model = modelSelect.value;
        const showBtns = inlineBtnToggle.checked;
        const studyMode = defaultStudyModeToggle.checked;

        // Build the save payload
        const dataToSave = {
            selectedModel: model,
            showInlineBtns: showBtns,
            defaultStudyMode: studyMode // <-- Add new state
        };
        if (key) dataToSave.geminiApiKey = key;

        chrome.storage.local.set(dataToSave, () => {
            updateBadgeUI();

            // Instantly tell the current tab to hide/show buttons
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "update_settings",
                        showBtns: showBtns,
                        studyMode: studyMode
                    });
                }
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

    // Send a message to the content.js script on the active tab
    translateBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: "translate_page" });
        }
    });

    clearCacheBtn.addEventListener('click', () => {
        console.log("Clear cache clicked!");
    });
});