document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const saveBtn = document.getElementById('saveBtn');
    const translateBtn = document.getElementById('translateBtn');
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const modelBadge = document.getElementById('modelBadge'); // The new badge

    // Helper to instantly update the UI badge
    function updateBadgeUI() {
        // Get the actual text of the selected option, and strip out the "(Default)" tag
        const selectedText = modelSelect.options[modelSelect.selectedIndex].text;
        modelBadge.textContent = selectedText.replace(' (Default)', '');
    }

    // Load the saved key and model when the popup opens
    chrome.storage.local.get(['geminiApiKey', 'selectedModel'], (result) => {
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
        if (result.selectedModel) {
            modelSelect.value = result.selectedModel;
            updateBadgeUI();
        }
    });

    // Save the key and the model choice
    saveBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const model = modelSelect.value;

        // Create an object to save, allowing users to save the model even if they don't change the API key
        const dataToSave = { selectedModel: model };
        if (key) dataToSave.geminiApiKey = key;

        chrome.storage.local.set(dataToSave, () => {
            updateBadgeUI(); // Update the badge instantly when saved

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