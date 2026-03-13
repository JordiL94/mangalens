# MangaLens - Gemini-Powered Manga Translator

MangaLens is a lightweight, on-the-fly manga translation tool built directly into your browser. It uses the Google AI Studio Gemini API to intelligently identify and translate Japanese text from manga panels, placing high-quality English overlays right over the original speech bubbles.

This extension is currently in beta and designed for development use and sharing with friends.

---

## 🚀 System Architecture & Key Features

This project was built to showcase clean extension design and optimized multimodal AI integration. Here are the key technical highlights:

### 1. Robust CORS-Bypass Architecture
MangaLens solves the common browser security issue (CORS) encountered when fetching images across different domains.
* **The Problem:** Browsers prevent content scripts from directly fetching image data via a canvas (`canvas.toDataURL()`), which is often blocked by manga CDNs.
* **The Solution:** MangaLens utilizes a background service worker. When you click translate, the content script sends the image **URL** to the background script. Because extensions have elevated privileges via the `<all_urls>` permission, the background worker performs the cross-origin fetch, retrieves the image data as a blob, and converts it to Base64, thus elegantly bypassing the CORS security constraint.

### 2. Normalized Coordinate Grid for Responsive Overlays
Achieving perfect overlay placement is difficult, especially on responsive websites.
* The system is designed for high accuracy by making the Gemini model act as a precise OCR scanner.
* The prompt explicitly instructs the model to utilize its native **1000x1000 coordinate grid**. The model returns bounding boxes in the normalized format `[ymin, xmin, ymax, xmax]`.
* The client-side content script then simply divides these integers by 10 to convert them directly into robust CSS percentages. This technique ensures that the text overlays are pixel-perfect and remain aligned with the speech bubbles even if the image is dynamically resized by the website or the browser window.

---

## How it Works

1.  **Detection:** A high-performance `MutationObserver` scans the page and adds a sleek ✨ button to the top-left corner of any large manga-sized image panel.
2.  **Multimodal Request:** Clicking ✨ triggers a process that fetches the panel's URL and sends it to your `background.js`, which securely performs an API call to **Gemini 3 Flash-Preview**.
3.  **Intelligent Translation:** The prompt is highly optimized for performance and accuracy:
    * It forces Gemini into a low thinking level (`thinking_config: { thinking_level: "low" }`) to prioritize raw speed and keep the UI snappy.
    * It specifies a strict JSON schema output, ensuring a parseable result.
4.  **Interactive Overlay:** MangaLens renders high-performance "glassmorphism" styled tooltips. For a premium reading experience, the overlays are interactive—hovering over a translation causes it to fade out, revealing the original Japanese text underneath, making it a great tool for language practice.

---

## Setup & Installation

Since this extension is not yet published, you will need to load it locally in "Developer Mode".

### Prerequisites
1.  A **Google AI Studio API Key**.

### Installation Steps
1.  **Clone the Repository:** Download the project folder containing the source code.
2.  **Navigate to Extension Settings:** Open your Google Chrome or Brave browser and go to `chrome://extensions/`.
3.  **Enable Developer Mode:** In the top right corner, toggle on "Developer mode".
4.  **Load Unpacked:** Click the "Load unpacked" button in the top left and select your project folder.
5.  **Configure API Key:** Open the MangaLens extension from your toolbar and paste your API key. Hit "Save Key".

### Obtaining an API Key
MangaLens requires a free API key from Google AI Studio.
1.  Go to [aistudio.google.com](https://aistudio.google.com).
2.  Sign in with your Google account.
3.  Click "Get API Key" on the left sidebar.
4.  Generate a new key and copy it. This key is stored locally in your browser and is never shared.

---

## License

This project is shared under an **MIT License**, meaning you are free to use, modify, and distribute the code, but the author is not liable for its performance.

## Acknowledgments

* Powered by Google AI Studio and the Gemini API.
* Manga panels used in screenshots are from various authors and publishers, used here for demonstration purposes only.