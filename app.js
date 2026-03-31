// State
let state = {
    keyword: '',
    selectedTitle: '',
    selectedLength: 400,
    generatedOutline: '',
    finalArticleRaw: '',
    finalArticleHtml: '',
    generatedImageUrl: ''
};

// DOM Elements
const els = {
    // Settings
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    apiKeyInput: document.getElementById('api-key-input'),
    
    // Steps
    stepKeyword: document.getElementById('step-keyword'),
    stepTitles: document.getElementById('step-titles'),
    stepOutline: document.getElementById('step-outline'),
    stepResult: document.getElementById('step-result'),
    
    // Step 1
    keywordInput: document.getElementById('keyword-input'),
    generateTitlesBtn: document.getElementById('generate-titles-btn'),
    keywordError: document.getElementById('keyword-error'),
    
    // Step 2
    titlesContainer: document.getElementById('titles-container'),
    generateOutlineBtn: document.getElementById('generate-outline-btn'),
    regenerateTitlesBtn: document.getElementById('regenerate-titles-btn'),
    
    // Step 3
    outlineTextarea: document.getElementById('outline-textarea'),
    lengthOptions: document.getElementsByName('article-length'),
    generateBodyBtn: document.getElementById('generate-body-btn'),
    regenerateOutlineBtn: document.getElementById('regenerate-outline-btn'),
    
    // Step 4
    resultContainer: document.getElementById('result-container'),
    copyBtn: document.getElementById('copy-btn'),
    
    // Step 4 Image Generation
    generateImageBtn: document.getElementById('generate-image-btn'),
    imageResultBox: document.getElementById('image-result-box'),
    generatedImage: document.getElementById('generated-image'),
    copyImageBtn: document.getElementById('copy-image-btn'),
    imageCopySuccess: document.getElementById('image-copy-success'),
    
    // Utilities
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    toast: document.getElementById('toast')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // APIキーの初期化(設定画面用)
    els.apiKeyInput.value = window.aiClient.apiKey;
    
    // Add Event Listeners
    setupEventListeners();
});

function setupEventListeners() {
    // モーダル制御
    els.settingsBtn.addEventListener('click', () => els.settingsModal.classList.remove('hidden'));
    els.modalCloseBtn.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
    els.saveSettingsBtn.addEventListener('click', () => {
        window.aiClient.setKey(els.apiKeyInput.value);
        els.settingsModal.classList.add('hidden');
        showToast('設定を保存しました');
    });

    // キーワード入力でEnter
    els.keywordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') els.generateTitlesBtn.click();
    });

    // Step 1 -> 2
    els.generateTitlesBtn.addEventListener('click', handleGenerateTitles);
    els.regenerateTitlesBtn.addEventListener('click', handleGenerateTitles);

    // Step 2 -> 3
    els.generateOutlineBtn.addEventListener('click', handleGenerateOutline);
    els.regenerateOutlineBtn.addEventListener('click', handleGenerateOutline);

    // Step 3 -> 4
    els.generateBodyBtn.addEventListener('click', handleGenerateBody);

    // Copy
    els.copyBtn.addEventListener('click', handleCopy);
    els.generateImageBtn.addEventListener('click', handleGenerateImage);
    els.copyImageBtn.addEventListener('click', handleCopyImage);
}

// --- Action Handlers ---

async function handleGenerateTitles() {
    const keyword = els.keywordInput.value.trim();
    if (!keyword) {
        els.keywordError.textContent = 'キーワードを入力してください。';
        return;
    }
    els.keywordError.textContent = '';
    state.keyword = keyword;

    showLoading('タイトル候補を生成中...');
    try {
        const titles = await window.aiClient.generateTitles(keyword);
        renderTitles(titles);
        enableStep(els.stepTitles);
        els.generateOutlineBtn.disabled = true; // wait for selection
        els.regenerateTitlesBtn.disabled = false;
        scrollToStep(els.stepTitles);
    } catch (e) {
        showToast('タイトルの生成に失敗しました: ' + e.message, true);
    } finally {
        hideLoading();
    }
}

async function handleGenerateOutline() {
    if (!state.selectedTitle) return;

    // ここで選択された文字数を取得して保持
    let selectedLength = 400; // default
    els.lengthOptions.forEach(opt => {
        if(opt.checked) selectedLength = parseInt(opt.value, 10);
    });
    state.selectedLength = selectedLength;

    showLoading(`構成案を生成中... (指定: ${selectedLength}文字対応)`);
    try {
        const outline = await window.aiClient.generateOutline(state.selectedTitle, state.selectedLength);
        state.generatedOutline = outline;
        renderOutline(outline);
        enableStep(els.stepOutline);
        els.generateBodyBtn.disabled = false;
        els.regenerateOutlineBtn.disabled = false;
        scrollToStep(els.stepOutline);
    } catch (e) {
        showToast('構成案の生成に失敗しました: ' + e.message, true);
    } finally {
        hideLoading();
    }
}

async function handleGenerateBody() {
    state.generatedOutline = els.outlineTextarea.value.trim();
    if (!state.selectedTitle || !state.generatedOutline) {
        showToast('構成案が入力されていません。', true);
        return;
    }

    showLoading(`記事本文を生成中... (目安: ${state.selectedLength}文字)`);
    try {
        const articleRaw = await window.aiClient.generateBody(state.selectedTitle, state.generatedOutline, state.selectedLength);
        state.finalArticleRaw = articleRaw;
        
        // markedが読み込まれている場合はHTML変換を利用
        if (typeof marked !== 'undefined') {
            state.finalArticleHtml = marked.parse(articleRaw);
        } else {
            // markedがない場合のフォールバック（簡易改行=>br）
            state.finalArticleHtml = articleRaw.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
            state.finalArticleHtml = `<p>${state.finalArticleHtml}</p>`;
        }
        
        renderResult(state.finalArticleHtml);
        enableStep(els.stepResult);
        els.copyBtn.disabled = false;
        scrollToStep(els.stepResult);
        showToast('記事の作成が完了しました！🎊');
    } catch (e) {
        showToast('本文の生成に失敗しました: ' + e.message, true);
    } finally {
        hideLoading();
    }
}

async function handleCopy() {
    if (!state.finalArticleRaw) return;
    
    try {
        // クリップボードAPIを使用してコピー
        await navigator.clipboard.writeText(state.finalArticleRaw);
        showToast('記事全文をコピーしました！');
        
        // ボタンの見た目を変える
        const originalText = els.copyBtn.innerHTML;
        els.copyBtn.innerHTML = '✅ コピー完了！';
        els.copyBtn.classList.add('success-text');
        setTimeout(() => {
            els.copyBtn.innerHTML = originalText;
            els.copyBtn.classList.remove('success-text');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = state.finalArticleRaw;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast('記事全文をコピーしました！');
        } catch(e) {
            showToast('コピーに失敗しました。手動でコピーしてください。', true);
        }
        document.body.removeChild(textarea);
    }
}

// --- Render Functions ---

function renderTitles(titles) {
    els.titlesContainer.innerHTML = '';
    state.selectedTitle = ''; // Reset selection
    
    titles.forEach((title, index) => {
        const id = `title-opt-${index}`;
        
        const label = document.createElement('label');
        label.className = 'title-card';
        label.setAttribute('for', id);
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'title-selection';
        radio.id = id;
        radio.value = title;
        
        radio.addEventListener('change', (e) => {
            // Handle selection visual state
            document.querySelectorAll('.title-card').forEach(c => c.classList.remove('selected'));
            label.classList.add('selected');
            
            state.selectedTitle = e.target.value;
            els.generateOutlineBtn.disabled = false;
        });

        const text = document.createTextNode(title);
        
        label.appendChild(radio);
        label.appendChild(text);
        els.titlesContainer.appendChild(label);
    });
}

function renderOutline(outlineMarkdown) {
    els.outlineTextarea.value = outlineMarkdown;
}

function renderResult(articleHtml) {
    els.resultContainer.innerHTML = articleHtml;
}

// --- Image Generation Functions (Ver1.3) ---

async function handleGenerateImage() {
    if (!state.finalArticleRaw) return;

    showLoading('見出し用画像を生成中... (約10〜20秒かかります)');
    try {
        // Gemini APIで記事から英語のプロンプトを生成
        const englishPrompt = await window.aiClient.generateImagePrompt(state.finalArticleRaw);
        
        // Pollinations AIで画像を生成 (1280x670 is highly compatible with note headers)
        const encodedPrompt = encodeURIComponent(englishPrompt);
        const seed = Math.floor(Math.random() * 1000000); // 毎回異なる画像を生成するためのシード値
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=670&nologo=true&seed=${seed}`;

        // 画像をプリロード
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            els.generatedImage.src = imageUrl;
            els.generatedImage.style.display = 'block';
            els.imageResultBox.classList.remove('hidden');
            state.generatedImageUrl = imageUrl;
            
            hideLoading();
            showToast('画像を生成しました！✨');
            
            // スムーズスクロールで画像を見せる
            els.imageResultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
        img.onerror = () => {
            hideLoading();
            showToast('画像の読み込みに失敗しました。', true);
        };
        
        // プリロード開始（リクエスト発火）
        img.src = imageUrl;
        
    } catch (e) {
        hideLoading();
        showToast('画像生成用のプロンプト作成に失敗しました: ' + e.message, true);
    }
}

async function handleCopyImage() {
    if (!state.generatedImageUrl) return;

    const originalText = els.copyImageBtn.innerHTML;
    try {
        els.copyImageBtn.innerHTML = 'コピー処理中...';
        els.copyImageBtn.disabled = true;

        // Safari対応：Canvasを使って確実にPNG Blobにする
        const canvas = document.createElement('canvas');
        canvas.width = els.generatedImage.naturalWidth || 1280;
        canvas.height = els.generatedImage.naturalHeight || 670;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(els.generatedImage, 0, 0);

        // Safariの厳格なClipboard API要件を満たすため、Promiseを直接渡す
        const makeImagePromise = new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/png');
        });

        // ClipboardItemを使ってクリップボードにコピー
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': makeImagePromise })
        ]);

        els.imageCopySuccess.textContent = '見出し画像をクリップボードにコピーしました！そのまま貼り付けが可能です。';
        els.copyImageBtn.innerHTML = '✓ コピー完了';
        
        setTimeout(() => {
            els.imageCopySuccess.textContent = '';
            els.copyImageBtn.innerHTML = originalText;
            els.copyImageBtn.disabled = false;
        }, 4000);
    } catch (e) {
        console.error('Image Copy Error:', e);
        showToast('ブラウザのセキュリティ設定等により、画像のクリップボード自動コピーに失敗しました。画像を右クリックしてコピーしてください。', true);
        els.copyImageBtn.innerHTML = originalText;
        els.copyImageBtn.disabled = false;
    }
}

// --- UI Utilities ---

function enableStep(stepEl) {
    stepEl.classList.remove('disabled');
}

function scrollToStep(stepEl) {
    setTimeout(() => {
        stepEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

function showLoading(text) {
    els.loadingText.textContent = text;
    els.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    els.loadingOverlay.classList.add('hidden');
}

let toastTimeout;
function showToast(message, isError = false) {
    els.toast.textContent = message;
    if (isError) {
        els.toast.style.backgroundColor = 'var(--error-color)';
    } else {
        els.toast.style.backgroundColor = '#333';
    }
    
    els.toast.classList.remove('hidden');
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        els.toast.classList.add('hidden');
    }, 3000);
}
