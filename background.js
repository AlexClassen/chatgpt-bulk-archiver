// Capture Authorization: Bearer ... from outgoing requests
// NOTE: To see Authorization headers, we need the "extraHeaders" option.
const URL_FILTERS = [
  "*://chatgpt.com/*",
  "*://chat.openai.com/*",
  "*://api.openai.com/*",
  "*://auth.openai.com/*"
];

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const hdrs = details.requestHeaders || [];
    const auth = hdrs.find(h => h.name.toLowerCase() === "authorization");
    if (auth && /^Bearer\s+\S+/i.test(auth.value)) {
      // Save the most recent Bearer for content scripts to use
      chrome.storage.local.set({ bearer: auth.value }).catch(() => {});
    }
  },
  { urls: URL_FILTERS },
  ["requestHeaders", "extraHeaders"] // extraHeaders is required to read Authorization
);
