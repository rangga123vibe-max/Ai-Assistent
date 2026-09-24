// Anti-detection override
(() => {
  const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  const originalVisibilityState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  
  Object.defineProperty(document, 'hidden', {
    get() { return false; }
  });
  Object.defineProperty(document, 'visibilityState', {
    get() { return 'visible'; }
  });
  
  window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
  window.addEventListener('blur', e => e.stopImmediatePropagation(), true);
  document.addEventListener('mouseleave', e => e.stopImmediatePropagation(), true);
})();


// Auto-Typer: bypass paste detection - type text char by char into focused input

// Track last focused external element for Auto-Type
var _aiLastFocused = null;
document.addEventListener('focusin', function(e) {
  if (!document.getElementById('ai-widget-root').contains(e.target)) {
    _aiLastFocused = e.target;
  }
}, true);

function autoType(element, text, delay) {
  delay = delay || 20;

  // CodeMirror 5: scan all possible elements
  var cm = null;
  var candidates = [element];
  var all = document.querySelectorAll('.CodeMirror, .cm-editor, [class*="CodeMirror"]');
  all.forEach(function(el) { candidates.push(el); });
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    while (el) {
      if (el && el.CodeMirror) { cm = el.CodeMirror; break; }
      el = el.parentElement;
    }
    if (cm) break;
  }

  if (cm) {
    cm.focus();
    cm.setValue(text);
    cm.setCursor(cm.lineCount(), 0);
    return;
  }

  // CodeMirror 6 / ace editor
  var ace = window.ace;
  if (ace) {
    try {
      var aceEditor = ace.edit(document.querySelector('.ace_editor'));
      if (aceEditor) { aceEditor.setValue(text, 1); return; }
    } catch(_) {}
  }

  // Monaco
  try {
    if (window.monaco) {
      var models = window.monaco.editor.getModels();
      if (models.length) { models[0].setValue(text); return; }
    }
  } catch(_) {}

  // Textarea/input fallback
  var target = element.tagName === 'TEXTAREA' || element.tagName === 'INPUT'
    ? element
    : document.querySelector('textarea, [contenteditable="true"]');
  if (target) {
    target.focus();
    var proto = target instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (nativeSetter && nativeSetter.set) nativeSetter.set.call(target, text);
    else target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    alert('Editor tidak terdeteksi. Paste manual: Ctrl+A lalu Ctrl+V setelah Copy.');
  }
}
window.addEventListener('ai-widget-autotype', function(e) {
  var text = e.detail.text, delay = e.detail.delay;
  var target = _aiLastFocused;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    autoType(target, text, delay || 30);
  } else {
    alert('Klik dulu kolom input di halaman, baru tekan Auto-Type.');
  }
});

// Floating widget
class AIWidget {
  constructor() {
    this.isMinimized = false;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.apiKey = localStorage.getItem('ai-widget-apikey') || '';
    this.hasValidKey = false;
    this.history = [];
    this.mode = 'study';
    this.language = 'javascript';
    this.provider = localStorage.getItem('ai-widget-provider') || 'gemini';
    this.model = localStorage.getItem('ai-widget-model') || 'gemini-3.6-flash';
    if (document.body) this.init();
    else document.addEventListener('DOMContentLoaded', () => this.init(), { once: true });
  }
  
  init() {
    if (document.getElementById('ai-widget-root')) return;
    this.createUI();
    this.attachEvents();
    document.getElementById('ai-widget-container').classList.remove('ai-widget-hidden');
  }
  
  createUI() {
    const container = document.createElement('div');
    container.id = 'ai-widget-root';
    container.innerHTML = `
      <div id="ai-widget-container" class="ai-widget-hidden">
        <div id="ai-widget-header" class="ai-widget-header">
          <div class="ai-header-left">
            <div class="ai-avatar"><svg viewBox="0 0 24 24" width="18" height="18" fill="white" aria-hidden="true"><path d="M12 12c1.9 0 3.5-1.6 3.5-3.5S13.9 5 12 5 8.5 6.6 8.5 8.5 10.1 12 12 12zm0 2c-2.8 0-8 1.4-8 4v2h16v-2c0-2.6-5.2-4-8-4z"/></svg></div>
            <div class="ai-header-text">
              <span class="ai-title">AI Assistant</span>
              <span id="ai-header-status" class="ai-widget-header-status">Belum ada API key</span>
            </div>
          </div>
          <button id="ai-minimize-btn" aria-label="Minimize">−</button>
        </div>
        
        <div id="ai-provider-section" class="ai-provider-section" style="display:block">
          <div class="ai-provider-row">
            <select id="ai-provider-select" aria-label="Provider AI">
              <option value="gemini">Gemini (Google)</option>
              <option value="9router">9Router (localhost:20128)</option>
            </select>
          </div>
          <div id="ai-model-row" class="ai-model-row">
            <input type="text" id="ai-model-input" placeholder="Nama model, contoh: kr/auto"><button id="ai-list-models-btn" title="Lihat daftar model">?</button>
          </div>
        </div>

        <div id="ai-key-section" class="ai-key-section">
          <div class="ai-key-status">Tidak Ada API Key</div>
          <div class="ai-key-input-row">
            <input type="password" id="ai-apikey-input" placeholder="Masukan API Key..." value="${this.apiKey}">
            <button id="ai-key-check-btn">Check</button>
          </div>
        </div>
        <div class="ai-mode-row" style="display: ${this.hasValidKey ? 'flex' : 'none'};">
          <select id="ai-mode-select" aria-label="Mode jawaban">
            <option value="study">Mode Belajar</option>
            <option value="coding">Mode Coding</option>
          </select>
          <select id="ai-language-select" aria-label="Bahasa kode">
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="php">PHP</option>
            <option value="csharp">C#</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
          </select>
        </div>
        <div id="ai-chat-area" class="ai-chat-area" style="display: ${this.hasValidKey ? 'flex' : 'none'};">
          <div id="ai-messages" class="ai-messages"></div>
        </div>
        <div class="ai-input-row" style="display: ${this.hasValidKey ? 'flex' : 'none'};">
          <input type="text" id="ai-input" placeholder="Tulis pertanyaan...">
          <button id="ai-send-btn">Send</button>
          <button id="ai-detect-btn">Detect</button>
        </div>
        <div class="ai-watermark">By:Ranzx999</div>
      </div>
      <div id="ai-blur-logo" class="ai-blur-logo">◆</div>
    `;
    document.body.appendChild(container);
  }
  
  attachEvents() {
    const header = document.getElementById('ai-widget-header');
    const minimizeBtn = document.getElementById('ai-minimize-btn');
    const sendBtn = document.getElementById('ai-send-btn');
    const detectBtn = document.getElementById('ai-detect-btn');
    const input = document.getElementById('ai-input');
    const logo = document.getElementById('ai-blur-logo');
    const container = document.getElementById('ai-widget-container');
    const apiKeyInput = document.getElementById('ai-apikey-input');
    const keyCheckBtn = document.getElementById('ai-key-check-btn');
    const keyInputRow = document.querySelector('.ai-key-input-row');
    const modeRow = document.querySelector('.ai-mode-row');
    const modeSelect = document.getElementById('ai-mode-select');
    const languageSelect = document.getElementById('ai-language-select');
    const keySection = document.getElementById('ai-key-section');
    const chatArea = document.getElementById('ai-chat-area');
    const inputRow = document.querySelector('.ai-input-row');
    const keyStatus = document.querySelector('.ai-key-status');
    
    // Drag
    header.addEventListener('mousedown', e => {
      this.isDragging = true;
      this.dragOffset.x = e.clientX - container.offsetLeft;
      this.dragOffset.y = e.clientY - container.offsetTop;
    });
    
    document.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      container.style.left = (e.clientX - this.dragOffset.x) + 'px';
      container.style.top = (e.clientY - this.dragOffset.y) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
    
    // Minimize
    minimizeBtn.addEventListener('click', () => {
      this.isMinimized = true;
      container.classList.add('ai-widget-hidden');
      logo.classList.add('ai-logo-visible');
    });
    
    // Logo click/hover to restore
    logo.addEventListener('click', () => {
      this.isMinimized = false;
      container.classList.remove('ai-widget-hidden');
      logo.classList.remove('ai-logo-visible');
    });
    
    let logoHoverTime = 0;
    logo.addEventListener('mouseenter', () => {
      logoHoverTime = Date.now();
    });
    logo.addEventListener('mouseleave', () => {
      logoHoverTime = 0;
    });
    setInterval(() => {
      if (logoHoverTime && Date.now() - logoHoverTime > 1500) {
        this.isMinimized = false;
        container.classList.remove('ai-widget-hidden');
        logo.classList.remove('ai-logo-visible');
        logoHoverTime = 0;
      }
    }, 100);
    
    // API Key Check
    keyCheckBtn.addEventListener('click', async () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        keyStatus.textContent = 'Tidak ada API key. Masukkan dulu.';
        const headerStatus2 = document.getElementById('ai-header-status');
        if(headerStatus2){ headerStatus2.textContent = 'Perlu API key'; headerStatus2.style.color = '#FCA5A5'; }
        keyStatus.style.color = '#ef4444';
        return;
      }
      keyCheckBtn.disabled = true;
      keyStatus.textContent = 'Memeriksa API key...';
      keyStatus.style.color = '#facc15';
      try {
        await this.checkApiKey(key);
        this.apiKey = key;
        this.hasValidKey = true;
        localStorage.setItem('ai-widget-apikey', key);
        keyStatus.textContent = 'API key valid.';
        const headerStatus = document.getElementById('ai-header-status');
        if(headerStatus){ headerStatus.textContent = 'API key valid'; headerStatus.style.color = ''; }
        keyStatus.style.color = '#22c55e';
        keyInputRow.style.display = 'none';
        modeRow.style.display = 'flex';
        chatArea.style.display = 'flex';
        inputRow.style.display = 'flex';
      } catch (error) {
        this.hasValidKey = false;
        keyStatus.textContent = 'API key gagal: ' + error.message;
        const headerStatus3 = document.getElementById('ai-header-status');
        if(headerStatus3){ headerStatus3.textContent = 'API key gagal'; headerStatus3.style.color = '#FCA5A5'; }
        keyStatus.style.color = '#ef4444';
      } finally {
        keyCheckBtn.disabled = false;
      }
    });
    
    const providerSelect = document.getElementById('ai-provider-select');
    const modelInput = document.getElementById('ai-model-input');
    const providerSection = document.getElementById('ai-provider-section');

    // restore saved provider+model
    providerSelect.value = this.provider;
    modelInput.value = this.model;
    this._updateModelPlaceholder(providerSelect.value, modelInput);
    const hs = document.getElementById('ai-header-status');
    if(hs){
      if(this.hasValidKey){ hs.textContent = 'API key valid'; hs.style.color = ''; }
      else if(this.apiKey){ hs.textContent = 'Cek API key'; hs.style.color = '#FCA5A5'; }
      else { hs.textContent = 'Belum ada API key'; hs.style.color = 'var(--text-secondary)'; }
    }

    providerSelect.addEventListener('change', () => {
      this.provider = providerSelect.value;
      localStorage.setItem('ai-widget-provider', this.provider);
      this._updateModelPlaceholder(this.provider, modelInput);
    });
    modelInput.addEventListener('input', () => {
      this.model = modelInput.value.trim() || this._defaultModel(this.provider);
      localStorage.setItem('ai-widget-model', this.model);
    });

        document.getElementById('ai-list-models-btn').addEventListener('click', async () => {
      const btn = document.getElementById('ai-list-models-btn');
      btn.textContent = '...'; btn.disabled = true;
      try {
        const models = await this._listModels();
        const messagesDiv = document.getElementById('ai-messages');
        const msg = document.createElement('div');
        msg.className = 'ai-message ai-assistant';
        if (!models.length) { msg.textContent = 'Tidak ada model'; }
        else {
          const groups = {};
          models.forEach(m => {
            const pref = m.id.includes('/') ? m.id.split('/')[0] : 'other';
            (groups[pref] = groups[pref] || []).push(m.id);
          });
          let html = '<b>Model tersedia</b><div class="ai-model-list">';
          Object.keys(groups).sort().forEach(g => {
            html += '<div class="ai-model-group"><div class="ai-model-group-label">' + g + '</div>';
            groups[g].forEach(id => {
              html += '<div class="ai-model-item ai-model-pick" data-id="' + id + '">' + id + '</div>';
            });
            html += '</div>';
          });
          html += '</div>';
          msg.innerHTML = html;
        }
        messagesDiv.appendChild(msg);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        msg.querySelectorAll('.ai-model-pick').forEach(el => el.addEventListener('click', () => {
          document.getElementById('ai-model-input').value = el.dataset.id;
          this.model = el.dataset.id;
          localStorage.setItem('ai-widget-model', this.model);
        }));
      } catch (e) {
        const messagesDiv = document.getElementById('ai-messages');
        const msg = document.createElement('div');
        msg.className = 'ai-message ai-error';
        msg.textContent = 'Gagal ambil model: ' + e.message;
        messagesDiv.appendChild(msg);
      } finally { btn.textContent = '?'; btn.disabled = false; }
    });

    modeSelect.addEventListener('change', () => { this.mode = modeSelect.value; });
    languageSelect.addEventListener('change', () => { this.language = languageSelect.value; });

    // Detect button - scrape page text
    detectBtn.addEventListener('click', () => {
      const selectors = ['article', 'main', '[role=\"main\"]', '.question', '.soal', 'p'];
      const text = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(el => el.innerText.trim())).filter(Boolean);
      const pageText = [...new Set(text)].join('\n\n').slice(0, 4000) || document.body.innerText.trim().slice(0, 4000);
      input.value = pageText ? 'Jawab soal berikut secara langsung. Berikan jawaban singkat terlebih dahulu, lalu penjelasan maksimal 2-3 kalimat. Jangan membuat analisis panjang, jangan mengulang soal, dan jangan membahas proses berpikir.\n\nSOAL:\n' + pageText : 'Tidak menemukan teks soal.';
    });
    
    // Send button
    sendBtn.addEventListener('click', () => this.sendMessage());
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.sendMessage();
    });
  }
  
  sendMessage() {
    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;
    
    const messagesDiv = document.getElementById('ai-messages');
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-message ai-user';
    userMsg.textContent = text;
    messagesDiv.appendChild(userMsg);
    input.value = '';
    this.history.push({ role: 'user', text });
    // Call LLM API dengan riwayat session
    this.callLLM();
  }
  
  async _listModels() {
    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey };
      chrome.runtime.sendMessage({ type: 'AI_LIST_MODELS', url: 'http://localhost:20128/v1/models', headers }, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response?.error || 'Gagal'));
        resolve(response.data?.data || []);
      });
    });
  }

  _defaultModel(provider) {
    return provider === '9router' ? 'kr/auto' : 'gemini-3.6-flash';
  }

  _updateModelPlaceholder(provider, input) {
    input.placeholder = provider === '9router' ? 'kr/auto atau model lain' : 'gemini-3.6-flash';
    if (!input.value || input.value === this._defaultModel(provider === '9router' ? 'gemini' : '9router')) {
      input.value = this._defaultModel(provider);
      this.model = input.value;
      localStorage.setItem('ai-widget-model', this.model);
    }
  }

  async _apiFetch(url, headers, body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'AI_FETCH', url, headers, body }, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response) return reject(new Error('Tidak ada response dari background'));
        if (response.error) return reject(new Error(response.error));
        if (!response.ok) {
          const msg = response.data?.error?.message || response.data?.error?.code || 'HTTP ' + response.status;
          return reject(new Error(msg));
        }
        resolve(response.data);
      });
    });
  }

  async checkApiKey(key) {
    if (this.provider === '9router') {
      await this._apiFetch('http://localhost:20128/v1/chat/completions',
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        { model: this.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 5 });
    } else {
      await this._apiFetch('https://generativelanguage.googleapis.com/v1beta/models/' + this.model + ':generateContent?key=' + encodeURIComponent(key),
        { 'Content-Type': 'application/json' },
        { contents: [{ parts: [{ text: 'Reply with OK.' }] }] });
    }
  }

  formatReply(text) {
    // extract code blocks FIRST (before HTML escaping) to preserve raw text
    var codeBlocks = [];
    var withPlaceholders = text.replace(/```[\w+#-]*\n?([\s\S]*?)```/g, function(_, code) {
      codeBlocks.push(code.trim());
      return '\x00CODEBLOCK' + (codeBlocks.length - 1) + '\x00';
    });
    // now escape HTML in non-code parts
    var escaped = withPlaceholders
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    // restore code blocks with proper HTML and raw encoded data
    return escaped.replace(/\x00CODEBLOCK(\d+)\x00/g, function(_, idx) {
      var raw = codeBlocks[parseInt(idx)];
      var displayed = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      var encoded = encodeURIComponent(raw);
      return '<pre><code>' + displayed + '</code></pre>'
        + '<button class="ai-copy-code">Copy</button>'
        + '<button class="ai-autotype-code" data-encoded="' + encoded + '" title="Ketik otomatis ke input aktif">Auto-Type</button>';
    });
  }

  async callLLM() {
    const messagesDiv = document.getElementById('ai-messages');
    const conversation = this.history.map(message =>
      `${message.role === 'user' ? 'Pengguna' : 'Asisten'}: ${message.text}`
    ).join('\n\n');
    const instruction = this.mode === 'coding'
      ? 'Mode Coding. Jawab bahasa Indonesia. Gunakan bahasa ' + this.language + '. Berikan kode lengkap dan valid dalam fenced code block Markdown. Pertahankan indentasi konsisten, gunakan 2 spasi, jangan campur kode dengan paragraf, dan jelaskan singkat setelah kode. Jangan menulis analisis panjang.'
      : 'Mode Belajar. Jawab bahasa Indonesia. Berikan Jawaban langsung, lalu Penjelasan maksimal 2-3 kalimat. Jika ada kode, wajib gunakan fenced code block Markdown dan pertahankan indentasi.';

    try {
      let reply;
      const systemPrompt = 'Kamu adalah asisten yang konsisten. ' + instruction + '\n\nKonteks percakapan:\n' + conversation;
      if (this.provider === '9router') {
        const data = await this._apiFetch('http://localhost:20128/v1/chat/completions',
          { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
          { model: this.model, messages: [{ role: 'user', content: systemPrompt }] });
        reply = data.choices?.[0]?.message?.content || 'Tidak ada response';
      } else {
        const data = await this._apiFetch('https://generativelanguage.googleapis.com/v1beta/models/' + this.model + ':generateContent?key=' + encodeURIComponent(this.apiKey),
          { 'Content-Type': 'application/json' },
          { contents: [{ parts: [{ text: systemPrompt }] }] });
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Tidak ada response';
      }
      this.history.push({ role: 'assistant', text: reply });

      const aiMsg = document.createElement('div');
      aiMsg.className = 'ai-message ai-assistant';
      aiMsg.innerHTML = this.formatReply(reply);
      messagesDiv.appendChild(aiMsg);
      aiMsg.querySelectorAll('.ai-autotype-code').forEach(button => button.addEventListener('click', () => {
        const text = decodeURIComponent(button.dataset.encoded || '');
        window.dispatchEvent(new CustomEvent('ai-widget-autotype', { detail: { text, delay: 25 } }));
        button.textContent = 'Typing...';
        setTimeout(() => { button.textContent = 'Auto-Type'; }, text.length * 25 + 500);
      }));
      aiMsg.querySelectorAll('.ai-autotype-code').forEach(btn => btn.addEventListener('click', () => {
        const text = decodeURIComponent(btn.dataset.encoded || '');
        window.dispatchEvent(new CustomEvent('ai-widget-autotype', { detail: { text, delay: 25 } }));
        btn.textContent = 'Typing...';
        setTimeout(() => { btn.textContent = 'Auto-Type'; }, text.length * 25 + 500);
      }));
      aiMsg.querySelectorAll('.ai-copy-code').forEach(button => button.addEventListener('click', () => {
        navigator.clipboard.writeText(button.previousElementSibling.textContent);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      }));
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (err) {
      this.history.pop();
      const errMsg = document.createElement('div');
      errMsg.className = 'ai-message ai-error';
      errMsg.textContent = 'Error: ' + err.message;
      messagesDiv.appendChild(errMsg);
    }
  }}

new AIWidget();
