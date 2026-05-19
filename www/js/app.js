/**
 * 书源生成器 - 主应用逻辑
 */
let analyzer = null;
let currentResult = null;
let lastExportedFileName = null;

/**
 * 开始分析
 */
async function startAnalysis() {
    const urlInput = document.getElementById('siteUrl');
    const nameInput = document.getElementById('siteName');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const loadingSection = document.getElementById('loadingSection');
    const resultSection = document.getElementById('resultSection');
    const errorSection = document.getElementById('errorSection');
    const loadingText = document.getElementById('loadingText');
    const progressFill = document.getElementById('progressFill');
    const filePathHint = document.getElementById('filePathHint');

    // 隐藏之前的结果和错误
    resultSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    filePathHint.classList.add('hidden');
    
    // 显示加载状态
    loadingSection.classList.remove('hidden');
    analyzeBtn.disabled = true;
    progressFill.style.width = '0%';

    const url = urlInput.value.trim();
    const siteName = nameInput.value.trim();

    try {
        // 步骤1: 验证URL
        loadingText.textContent = '正在验证URL...';
        progressFill.style.width = '20%';
        await sleep(300);

        // 步骤2: 初始化分析器
        loadingText.textContent = '正在初始化分析引擎...';
        progressFill.style.width = '30%';
        analyzer = new BookSourceAnalyzer();
        await sleep(300);

        // 步骤3: 获取并分析网页
        loadingText.textContent = '正在获取网页内容...';
        progressFill.style.width = '50%';
        
        const result = await analyzer.analyze(url, siteName);
        currentResult = result;

        // 步骤4: 生成书源
        loadingText.textContent = '正在分析网站结构...';
        progressFill.style.width = '70%';
        await sleep(500);

        loadingText.textContent = '正在生成书源规则...';
        progressFill.style.width = '85%';
        await sleep(300);

        // 步骤5: 完成
        loadingText.textContent = '✅ 分析完成！';
        progressFill.style.width = '100%';
        await sleep(500);

        // 显示结果
        loadingSection.classList.add('hidden');
        displayResult(result);
        resultSection.classList.remove('hidden');

    } catch (error) {
        loadingSection.classList.add('hidden');
        showError(error.message);
    } finally {
        analyzeBtn.disabled = false;
    }
}

/**
 * 显示分析结果
 */
function displayResult(result) {
    const resultJson = document.getElementById('resultJson');
    const sourcePreview = document.getElementById('sourcePreview');
    const ruleEditor = document.getElementById('ruleEditor');

    // 显示JSON
    const jsonStr = JSON.stringify(result.bookSource, null, 2);
    resultJson.textContent = jsonStr;

    // 显示预览
    displayPreview(result.bookSource);

    // 显示规则编辑器
    displayRuleEditor(result.bookSource);
}

/**
 * 显示书源预览
 */
function displayPreview(bookSource) {
    const preview = document.getElementById('sourcePreview');
    const fields = [
        { label: '书源名称', value: bookSource.bookSourceName },
        { label: '网站URL', value: bookSource.bookSourceUrl },
        { label: '搜索URL', value: bookSource.ruleSearchUrl || '未检测到' },
        { label: '搜索列表', value: bookSource.ruleSearchList || '未检测到' },
        { label: '搜索书名', value: bookSource.ruleSearchName || '未检测到' },
        { label: '搜索作者', value: bookSource.ruleSearchAuthor || '未检测到' },
        { label: '搜索封面', value: bookSource.ruleSearchCoverUrl || '未检测到' },
        { label: '书名规则', value: bookSource.ruleBookName || '未检测到' },
        { label: '作者规则', value: bookSource.ruleBookAuthor || '未检测到' },
        { label: '封面规则', value: bookSource.ruleCoverUrl || '未检测到' },
        { label: '章节列表', value: bookSource.ruleChapterList || '未检测到' },
        { label: '章节名称', value: bookSource.ruleChapterName || '未检测到' },
        { label: '内容规则', value: bookSource.ruleContent || '未检测到' }
    ];

    preview.innerHTML = fields.map(field => `
        <div class="preview-item">
            <div class="label">${field.label}</div>
            <div class="value">${escapeHtml(field.value)}</div>
        </div>
    `).join('');
}

/**
 * 显示规则编辑器
 */
function displayRuleEditor(bookSource) {
    const editor = document.getElementById('ruleEditor');
    const editableRules = [
        { key: 'ruleSearchUrl', label: '搜索URL', value: bookSource.ruleSearchUrl || '' },
        { key: 'ruleSearchList', label: '搜索列表选择器', value: bookSource.ruleSearchList || '' },
        { key: 'ruleSearchName', label: '搜索书名选择器', value: bookSource.ruleSearchName || '' },
        { key: 'ruleSearchAuthor', label: '搜索作者选择器', value: bookSource.ruleSearchAuthor || '' },
        { key: 'ruleSearchCoverUrl', label: '搜索封面选择器', value: bookSource.ruleSearchCoverUrl || '' },
        { key: 'ruleBookName', label: '书名选择器', value: bookSource.ruleBookName || '' },
        { key: 'ruleBookAuthor', label: '作者选择器', value: bookSource.ruleBookAuthor || '' },
        { key: 'ruleCoverUrl', label: '封面选择器', value: bookSource.ruleCoverUrl || '' },
        { key: 'ruleChapterList', label: '章节列表选择器', value: bookSource.ruleChapterList || '' },
        { key: 'ruleChapterName', label: '章节名称选择器', value: bookSource.ruleChapterName || '' },
        { key: 'ruleContent', label: '内容选择器', value: bookSource.ruleContent || '' }
    ];

    editor.innerHTML = editableRules.map(rule => `
        <div class="rule-field">
            <label for="rule_${rule.key}">${rule.label}</label>
            <input type="text" id="rule_${rule.key}" value="${escapeHtml(rule.value)}" 
                   placeholder="输入CSS选择器或URL规则" />
        </div>
    `).join('');
}

/**
 * 从规则编辑器重新生成书源
 */
function regenerateFromRules() {
    if (!currentResult) return;

    const bookSource = currentResult.bookSource;
    const editableRules = [
        'ruleSearchUrl', 'ruleSearchList', 'ruleSearchName', 'ruleSearchAuthor',
        'ruleSearchCoverUrl', 'ruleBookName', 'ruleBookAuthor', 'ruleCoverUrl',
        'ruleChapterList', 'ruleChapterName', 'ruleContent'
    ];

    editableRules.forEach(key => {
        const input = document.getElementById(`rule_${key}`);
        if (input) {
            const value = input.value.trim();
            if (value) {
                bookSource[key] = value;
            } else {
                delete bookSource[key];
            }
        }
    });

    // 更新显示
    displayResult(currentResult);
    showToast('✅ 书源已更新');
}

/**
 * 复制结果到剪贴板
 */
async function copyResult() {
    const jsonText = document.getElementById('resultJson').textContent;
    try {
        // 尝试使用Android原生接口
        if (window.Android && window.Android.copyToClipboard) {
            window.Android.copyToClipboard(jsonText);
            showToast('📋 已复制到剪贴板！');
            return;
        }
        await navigator.clipboard.writeText(jsonText);
        showToast('📋 已复制到剪贴板！');
    } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = jsonText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('📋 已复制到剪贴板！');
    }
}

/**
 * 导出JSON文件 - 使用Android原生保存
 */
function exportJson() {
    if (!currentResult) return;

    const jsonStr = JSON.stringify(currentResult.bookSource, null, 2);
    const fileName = `${currentResult.bookSource.bookSourceName || 'book-source'}.json`;
    
    // 使用Android原生接口保存
    if (window.Android && window.Android.saveJsonFile) {
        const result = window.Android.saveJsonFile(fileName, jsonStr);
        lastExportedFileName = fileName;
        
        // 显示真实文件路径
        const filePathHint = document.getElementById('filePathHint');
        const downloadPath = window.Android.getDownloadPath ? window.Android.getDownloadPath() : '下载文件夹';
        filePathHint.innerHTML = `
            💾 文件已导出：<strong>${fileName}</strong><br>
            📁 保存位置：<strong>${downloadPath}</strong><br>
            💡 提示：用文件管理器打开此目录，找到文件后分享到阅读App即可导入
        `;
        filePathHint.classList.remove('hidden');
        
        showToast(`💾 已保存到 ${downloadPath}`);
    } else {
        // 浏览器备用方案
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`💾 已导出 ${fileName}`);
    }
}

/**
 * 一键导入阅读App - 使用legado协议直接导入
 */
function importToReader() {
    if (!currentResult) return;

    const jsonStr = JSON.stringify(currentResult.bookSource, null, 2);
    
    // 使用Android原生接口
    if (window.Android && window.Android.openReaderApp) {
        window.Android.openReaderApp(jsonStr);
        showToast('📲 正在打开阅读App...');
        return;
    }
    
    // 使用legado协议直接导入书源
    try {
        const encoded = encodeURIComponent(jsonStr);
        const legadoUrl = `legado://import/bookSource?src=${encoded}`;
        window.location.href = legadoUrl;
        showToast('📲 正在导入书源到阅读App...');
    } catch (e) {
        showToast('📲 请先导出JSON，然后在阅读App中手动导入');
    }
}

/**
 * 显示错误信息
 */
function showError(message) {
    const errorSection = document.getElementById('errorSection');
    const errorText = document.getElementById('errorText');
    errorText.textContent = message;
    errorSection.classList.remove('hidden');
}

/**
 * 重置UI
 */
function resetUI() {
    document.getElementById('errorSection').classList.add('hidden');
    document.getElementById('resultSection').classList.add('hidden');
    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('filePathHint').classList.add('hidden');
}

/**
 * 显示Toast提示
 */
function showToast(message) {
    // 优先使用Android原生Toast
    if (window.Android && window.Android.showToast) {
        window.Android.showToast(message);
        return;
    }
    
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/**
 * 工具函数：休眠
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 工具函数：HTML转义
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
