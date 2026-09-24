// Background service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AI_FETCH') {
    const { url, headers, body } = msg;
    fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      .then(async r => {
        const text = await r.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch (_) {
          // SSE stream - concat all delta content
          const lines = text.split('\n').filter(l => l.startsWith('data:') && l.trim() !== 'data: [DONE]');
          let fullContent = '';
          for (const line of lines) {
            try {
              const chunk = JSON.parse(line.slice(5).trim());
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
              // non-streaming fallback
              if (!fullContent && chunk?.choices?.[0]?.message?.content)
                fullContent = chunk.choices[0].message.content;
            } catch (_) {}
          }
          if (fullContent) {
            data = { choices: [{ message: { content: fullContent } }] };
          }
        }
        sendResponse({ ok: r.ok, status: r.status, data });
      })
      .catch(err => sendResponse({ ok: false, status: 0, data: {}, error: err.message }));
    return true;
  }
  if (msg.type === 'AI_LIST_MODELS') {
    const { url, headers } = msg;
    fetch(url, { method: 'GET', headers })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return false;
});
