document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const inlineBtnToggle = document.getElementById('inlineBtnToggle'); // Grab the toggle
    const saveBtn = document.getElementById('saveBtn');
    const translateBtn = document.getElementById('translateBtn');
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const modelBadge = document.getElementById('modelBadge');

    function updateBadgeUI() {
        const selectedText = modelSelect.options[modelSelect.selectedIndex].text;
        modelBadge.textContent = selectedText.replace(' (Default)', '');
    }

    // Load the saved key, model, AND toggle state
    chrome.storage.local.get(['geminiApiKey', 'selectedModel', 'showInlineBtns'], (result) => {
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
        if (result.selectedModel) {
            modelSelect.value = result.selectedModel;
            updateBadgeUI();
        }
        // Default to true if it has never been set
        if (result.showInlineBtns !== undefined) {
            inlineBtnToggle.checked = result.showInlineBtns;
        }
    });

    // Save everything and notify the page
    saveBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const model = modelSelect.value;
        const showBtns = inlineBtnToggle.checked;

        const dataToSave = { selectedModel: model, showInlineBtns: showBtns };
        if (key) dataToSave.geminiApiKey = key;

        chrome.storage.local.set(dataToSave, () => {
            updateBadgeUI();

            // Instantly tell the current tab to hide/show buttons
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "toggle_buttons", show: showBtns });
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
});