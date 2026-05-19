/**
 * 书源生成器 - 主应用逻辑
 * 分析引擎由Android原生Java实现（Jsoup），前端只负责UI
 */
let currentResult = null;
let lastExportedFileName = null;

/**
 * 开始分析 - 调用Android原生分析引擎
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
        await sleep(200);

        // 步骤2: 调用原生分析引擎
        loadingText.textContent = '正在获取网页内容...';
        progressFill.style.width = '40%';
        
        let result;
        if (window.Android && window.Android.analyzeUrl) {
            // Android原生分析（Jsoup，无CORS限制）
            const jsonStr = window.Android.analyzeUrl(url, siteName);
            const parsed = JSON.parse(jsonStr);
            if (parsed.error) {
                throw new Error(parsed.error);
            }
            result = parsed;
        } else {
            // 浏览器环境：使用前端分析引擎
            loadingText.textContent = '正在初始化分析引擎...';
            const analyzer = new BookSourceAnalyzer();
            result = await analyzer.analyze(url, siteName);
        }
        
        currentResult = result;

        // 步骤3: 生成书源
        loadingText.textContent = '正在分析网站结构...';
        progressFill.style.width = '70%';
        await sleep(300);

        loadingText.textContent = '正在生成书源规则...';
        progressFill.style.width = '85%';
        await sleep(200);

        // 步骤4: 完成
        loadingText.textContent = '✅ 分析完成！';
        progressFill.style.width = '100%';
        await sleep(400);

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
 * 从嵌套规则对象中获取值
 */
function getRuleValue(bookSource, rulePath) {
    const parts = rulePath.split('.');
    let obj = bookSource;
    for (const part of parts) {
        if (obj && typeof obj === 'object' && part in obj) {
            obj = obj[part];
        } else {
            return '未检测到';
        }
    }
    return obj || '未检测到';
}

/**
 * 显示书源预览
 */
function displayPreview(bookSource) {
    const preview = document.getElementById('sourcePreview');
    const fields = [
        { label: '书源名称', value: bookSource.bookSourceName },
        { label: '网站URL', value: bookSource.bookSourceUrl },
        { label: '搜索URL', value: bookSource.searchUrl || '未检测到' },
        { label: '搜索列表', value: getRuleValue(bookSource, 'ruleSearch.bookList') },
        { label: '搜索书名', value: getRuleValue(bookSource, 'ruleSearch.name') },
        { label: '搜索作者', value: getRuleValue(bookSource, 'ruleSearch.author') },
        { label: '搜索封面', value: getRuleValue(bookSource, 'ruleSearch.coverUrl') },
        { label: '书名规则', value: getRuleValue(bookSource, 'ruleBookInfo.name') },
        { label: '作者规则', value: getRuleValue(bookSource, 'ruleBookInfo.author') },
        { label: '封面规则', value: getRuleValue(bookSource, 'ruleBookInfo.coverUrl') },
        { label: '分类规则', value: getRuleValue(bookSource, 'ruleBookInfo.kind') },
        { label: '简介规则', value: getRuleValue(bookSource, 'ruleBookInfo.intro') },
        { label: '章节列表', value: getRuleValue(bookSource, 'ruleToc.chapterList') },
        { label: '章节名称', value: getRuleValue(bookSource, 'ruleToc.chapterName') },
        { label: '章节URL', value: getRuleValue(bookSource, 'ruleToc.chapterUrl') },
        { label: '内容规则', value: getRuleValue(bookSource, 'ruleContent.content') }
    ];

    preview.innerHTML = fields.map(field => `
        <div class="preview-item">
            <div class="label">${field.label}</div>
            <div class="value">${escapeHtml(field.value)}</div>
        </div>
    `).join('');
}

/**
 * 从嵌套对象中获取值
 */
function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return '';
        }
    }
    return typeof current === 'string' ? current : '';
}

/**
 * 设置嵌套对象的值
 */
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    if (value) {
        current[parts[parts.length - 1]] = value;
    } else {
        delete current[parts[parts.length - 1]];
    }
}

/**
 * 显示规则编辑器
 */
function displayRuleEditor(bookSource) {
    const editor = document.getElementById('ruleEditor');
    const editableRules = [
        { key: 'searchUrl', label: '搜索URL', value: bookSource.searchUrl || '' },
        { key: 'ruleSearch.bookList', label: '搜索列表选择器', value: getNestedValue(bookSource, 'ruleSearch.bookList') },
        { key: 'ruleSearch.name', label: '搜索书名选择器', value: getNestedValue(bookSource, 'ruleSearch.name') },
        { key: 'ruleSearch.author', label: '搜索作者选择器', value: getNestedValue(bookSource, 'ruleSearch.author') },
        { key: 'ruleSearch.coverUrl', label: '搜索封面选择器', value: getNestedValue(bookSource, 'ruleSearch.coverUrl') },
        { key: 'ruleBookInfo.name', label: '书名选择器', value: getNestedValue(bookSource, 'ruleBookInfo.name') },
        { key: 'ruleBookInfo.author', label: '作者选择器', value: getNestedValue(bookSource, 'ruleBookInfo.author') },
        { key: 'ruleBookInfo.coverUrl', label: '封面选择器', value: getNestedValue(bookSource, 'ruleBookInfo.coverUrl') },
        { key: 'ruleBookInfo.kind', label: '分类选择器', value: getNestedValue(bookSource, 'ruleBookInfo.kind') },
        { key: 'ruleBookInfo.intro', label: '简介选择器', value: getNestedValue(bookSource, 'ruleBookInfo.intro') },
        { key: 'ruleToc.chapterList', label: '章节列表选择器', value: getNestedValue(bookSource, 'ruleToc.chapterList') },
        { key: 'ruleToc.chapterName', label: '章节名称选择器', value: getNestedValue(bookSource, 'ruleToc.chapterName') },
        { key: 'ruleToc.chapterUrl', label: '章节URL选择器', value: getNestedValue(bookSource, 'ruleToc.chapterUrl') },
        { key: 'ruleContent.content', label: '内容选择器', value: getNestedValue(bookSource, 'ruleContent.content') }
    ];

    editor.innerHTML = editableRules.map(rule => `
        <div class="rule-field">
            <label for="rule_${rule.key.replace(/\./g, '_')}">${rule.label}</label>
            <input type="text" id="rule_${rule.key.replace(/\./g, '_')}" value="${escapeHtml(rule.value)}" 
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
        'searchUrl',
        'ruleSearch.bookList', 'ruleSearch.name', 'ruleSearch.author', 'ruleSearch.coverUrl',
        'ruleBookInfo.name', 'ruleBookInfo.author', 'ruleBookInfo.coverUrl', 'ruleBookInfo.kind', 'ruleBookInfo.intro',
        'ruleToc.chapterList', 'ruleToc.chapterName', 'ruleToc.chapterUrl',
        'ruleContent.content'
    ];

    editableRules.forEach(key => {
        const input = document.getElementById(`rule_${key.replace(/\./g, '_')}`);
        if (input) {
            const value = input.value.trim();
            setNestedValue(bookSource, key, value);
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

    // 阅读App需要数组格式 [{...}]
    const jsonStr = JSON.stringify([currentResult.bookSource], null, 2);
    const fileName = `${currentResult.bookSource.bookSourceName || 'book-source'}.json`;
    
    if (window.Android && window.Android.saveJsonFile) {
        const result = window.Android.saveJsonFile(fileName, jsonStr);
        lastExportedFileName = fileName;
        
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

    // 阅读App需要数组格式 [{...}]
    const jsonStr = JSON.stringify([currentResult.bookSource], null, 2);
    
    if (window.Android && window.Android.openReaderApp) {
        window.Android.openReaderApp(jsonStr);
        showToast('📲 正在打开阅读App...');
        return;
    }
    
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
