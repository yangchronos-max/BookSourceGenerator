/**
 * 书源生成器 - 主应用逻辑
 * 分析引擎由Android原生Java实现（Jsoup），前端只负责UI
 * 
 * 搜索URL捕获流程（半自动化）：
 * 1. 用户输入网站URL → 点击"开始分析"
 * 2. 分析完成后，优先显示手动捕获界面（自动检测的搜索URL作为备选）
 * 3. 手动捕获：点击按钮打开网站 + 自动复制搜索词到剪贴板
 * 4. 用户在网站上搜索后，把结果URL粘贴回来
 * 5. 自动解析出搜索格式
 * 6. 如果用户不想手动捕获，可以一键跳过使用自动检测的URL
 */
let currentResult = null;
let lastExportedFileName = null;
let capturedSearchUrl = null; // 用户手动捕获的搜索URL
let autoDetectedSearchUrl = null; // 自动检测的搜索URL（备选）

// 预设搜索词（用户可修改，Android原生可覆盖）
const DEFAULT_SEARCH_KEYWORD = (window.Android && window.Android.getSearchKeyword) 
    ? window.Android.getSearchKeyword() 
    : '凡人修仙';

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
    const searchCaptureSection = document.getElementById('searchCaptureSection');
    const loadingText = document.getElementById('loadingText');
    const progressFill = document.getElementById('progressFill');
    const filePathHint = document.getElementById('filePathHint');

    // 隐藏之前的结果和错误
    resultSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    searchCaptureSection.classList.add('hidden');
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

        // 步骤2: 调用分析引擎
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

        // 步骤3: 保存自动检测的搜索URL（作为备选）
        loadingText.textContent = '正在检测搜索功能...';
        progressFill.style.width = '60%';
        await sleep(200);

        autoDetectedSearchUrl = result.bookSource.searchUrl || '';
        
        // 步骤4: 分析网站结构
        loadingText.textContent = '正在分析网站结构...';
        progressFill.style.width = '70%';
        await sleep(300);

        loadingText.textContent = '正在生成书源规则...';
        progressFill.style.width = '85%';
        await sleep(200);

        // 步骤5: 完成分析，优先显示手动捕获界面
        loadingText.textContent = '✅ 分析完成！';
        progressFill.style.width = '100%';
        await sleep(400);

        // 隐藏加载，显示手动捕获界面
        loadingSection.classList.add('hidden');
        showSearchCaptureSection(url);

    } catch (error) {
        loadingSection.classList.add('hidden');
        showError(error.message);
    } finally {
        analyzeBtn.disabled = false;
    }
}

/**
 * 显示搜索URL捕获界面
 * 优先让用户手动捕获，不愿意的可以跳过用自动检测的
 */
function showSearchCaptureSection(siteUrl) {
    const section = document.getElementById('searchCaptureSection');
    section.classList.remove('hidden');
    
    // 重置步骤状态
    document.querySelectorAll('#captureStepList li').forEach(li => {
        li.classList.remove('done', 'active');
    });
    document.getElementById('step1').classList.add('active');
    
    // 重置输入
    const urlInput = document.getElementById('searchResultUrl');
    urlInput.value = '';
    urlInput.classList.remove('has-value');
    
    // 隐藏解析结果
    document.getElementById('parsedSearchResult').classList.add('hidden');
    
    // 禁用解析按钮
    document.getElementById('parseSearchUrlBtn').disabled = true;
    document.getElementById('parseSearchUrlBtn').textContent = '🔄 解析搜索URL';
    document.getElementById('parseSearchUrlBtn').onclick = parseSearchUrl;
    
    // 启用打开网站按钮
    document.getElementById('openSiteBtn').disabled = false;
    document.getElementById('openSiteBtn').textContent = '🌐 打开网站并复制搜索词';
    
    // 保存网站URL供后续使用
    document.getElementById('openSiteBtn').dataset.siteUrl = siteUrl;
    
    // 更新跳过按钮文案，显示自动检测的URL
    const skipBtn = document.querySelector('.btn-skip-capture');
    if (autoDetectedSearchUrl && autoDetectedSearchUrl.includes('{{key}}')) {
        skipBtn.textContent = '⏭ 跳过，使用自动检测的搜索URL';
        skipBtn.style.display = 'block';
    } else {
        skipBtn.textContent = '⏭ 跳过，稍后手动设置搜索URL';
        skipBtn.style.display = 'block';
    }
    
    // 自动复制搜索词到剪贴板
    copySearchKeyword();
}

/**
 * 打开网站并复制搜索词
 * 在Android App中，这会调用原生方法打开WebView
 */
function openSiteForSearch() {
    const btn = document.getElementById('openSiteBtn');
    const siteUrl = btn.dataset.siteUrl;
    
    if (!siteUrl) {
        showToast('⚠️ 请先输入网站URL');
        return;
    }
    
    // 标记步骤1完成，步骤2激活
    document.getElementById('step1').classList.remove('active');
    document.getElementById('step1').classList.add('done');
    document.getElementById('step2').classList.add('active');
    
    // 复制搜索词到剪贴板
    copySearchKeyword();
    
    if (window.Android && window.Android.openUrl) {
        // Android原生：打开系统浏览器
        window.Android.openUrl(siteUrl);
        showToast('🌐 已打开网站，请粘贴搜索词进行搜索');
    } else {
        // 浏览器环境：打开新标签页
        window.open(siteUrl, '_blank');
        showToast('🌐 已打开网站，请粘贴搜索词进行搜索');
    }
    
    // 禁用按钮防止重复点击
    btn.disabled = true;
    btn.textContent = '✅ 网站已打开，请搜索';
}

/**
 * 复制搜索词到剪贴板
 */
function copySearchKeyword() {
    const keyword = DEFAULT_SEARCH_KEYWORD;
    const btn = document.getElementById('copyKeywordBtn');
    
    if (window.Android && window.Android.copyToClipboard) {
        window.Android.copyToClipboard(keyword);
    } else {
        navigator.clipboard.writeText(keyword).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = keyword;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        });
    }
    
    // 按钮反馈
    btn.textContent = '✅ 已复制 "' + keyword + '"';
    btn.classList.add('copied');
    setTimeout(() => {
        btn.textContent = '📝 复制搜索词';
        btn.classList.remove('copied');
    }, 3000);
    
    showToast('📋 已复制搜索词 "' + keyword + '" 到剪贴板');
}

/**
 * 搜索URL输入框变化时
 */
function onSearchUrlInput(textarea) {
    const value = textarea.value.trim();
    const parseBtn = document.getElementById('parseSearchUrlBtn');
    
    if (value) {
        textarea.classList.add('has-value');
        parseBtn.disabled = false;
        
        // 标记步骤3完成，步骤4激活
        document.getElementById('step3').classList.remove('active');
        document.getElementById('step3').classList.add('done');
        document.getElementById('step4').classList.add('active');
    } else {
        textarea.classList.remove('has-value');
        parseBtn.disabled = true;
    }
}

/**
 * 解析搜索URL
 * 从用户粘贴的搜索结果URL中提取搜索格式
 * 注意：搜索结果URL中不一定包含原始搜索词（如"凡人修仙"），
 * 所以不能依赖关键词匹配，而是通过URL参数结构来智能解析
 */
function parseSearchUrl() {
    const urlInput = document.getElementById('searchResultUrl');
    const url = urlInput.value.trim();
    const parseBtn = document.getElementById('parseSearchUrlBtn');
    const resultDiv = document.getElementById('parsedSearchResult');
    
    if (!url) {
        showToast('⚠️ 请先粘贴搜索结果URL');
        return;
    }
    
    parseBtn.disabled = true;
    parseBtn.textContent = '⏳ 解析中...';
    
    try {
        // 使用分析引擎解析搜索URL
        // 传入搜索词作为参考，但不会硬依赖它
        const analyzer = new BookSourceAnalyzer();
        const parsed = analyzer.parseSearchUrl(url, DEFAULT_SEARCH_KEYWORD);
        
        if (!parsed || !parsed.url) {
            throw new Error('无法解析搜索URL');
        }
        
        // 保存解析结果
        capturedSearchUrl = parsed.url;
        
        // 显示解析结果
        const methodBadge = parsed.method === 'POST' 
            ? '<span class="method-badge post">POST</span>' 
            : '<span class="method-badge get">GET</span>';
        
        let detailHtml = '';
        if (parsed.method === 'POST' && parsed.body) {
            detailHtml = `<br><small>Body: ${escapeHtml(parsed.body)}</small>`;
        }
        if (parsed.charset && parsed.charset !== 'utf-8') {
            detailHtml += `<br><small>编码: ${parsed.charset}</small>`;
        }
        
        resultDiv.innerHTML = `
            ✅ 解析成功！
            <div style="margin-top:8px;font-size:12px;color:#555;">
                ${methodBadge} 搜索方式
            </div>
            <code>${escapeHtml(parsed.url)}</code>
            ${detailHtml}
            <div style="margin-top:8px;font-size:12px;color:#555;">
                💡 阅读App将用 <strong>{{key}}</strong> 替换搜索关键词
            </div>
        `;
        resultDiv.classList.remove('hidden');
        resultDiv.style.background = '#e8f5e9';
        resultDiv.style.color = '#2e7d32';
        
        // 标记步骤4完成
        document.getElementById('step4').classList.remove('active');
        document.getElementById('step4').classList.add('done');
        
        // 更新书源中的搜索URL
        if (currentResult && currentResult.bookSource) {
            currentResult.bookSource.searchUrl = parsed.url;
        }
        
        // 按钮变为"继续生成书源"，点击后跳转到结果页
        parseBtn.textContent = '✅ 继续生成书源';
        parseBtn.disabled = false;
        parseBtn.onclick = continueWithCapturedUrl;
        
        showToast('✅ 搜索URL解析成功！');
        
    } catch (error) {
        resultDiv.innerHTML = `
            ❌ 解析失败：${escapeHtml(error.message)}
            <div style="margin-top:8px;font-size:12px;color:#999;">
                请确认粘贴的是完整的搜索结果URL（包含搜索关键词）
            </div>
        `;
        resultDiv.classList.remove('hidden');
        resultDiv.style.background = '#ffebee';
        resultDiv.style.color = '#c62828';
        
        parseBtn.disabled = false;
        parseBtn.textContent = '🔄 重新解析';
        parseBtn.onclick = parseSearchUrl;
    }
}

/**
 * 使用捕获的URL继续生成书源
 */
function continueWithCapturedUrl() {
    if (!currentResult) {
        showToast('⚠️ 请先分析网站');
        return;
    }
    
    // 更新搜索URL
    if (capturedSearchUrl) {
        currentResult.bookSource.searchUrl = capturedSearchUrl;
    }
    
    // 隐藏搜索捕获界面
    document.getElementById('searchCaptureSection').classList.add('hidden');
    
    // 显示结果
    displayResult(currentResult);
    document.getElementById('resultSection').classList.remove('hidden');
    
    showToast('✅ 书源生成完成！');
}

/**
 * 跳过搜索URL捕获，使用自动检测的URL
 * 用户不想手动捕获时，一键使用自动检测的搜索URL
 */
function skipSearchCapture() {
    if (!currentResult) {
        showToast('⚠️ 请先分析网站');
        return;
    }
    
    // 使用自动检测的搜索URL
    if (autoDetectedSearchUrl && autoDetectedSearchUrl.includes('{{key}}')) {
        currentResult.bookSource.searchUrl = autoDetectedSearchUrl;
        showToast('ℹ️ 已使用自动检测的搜索URL');
    } else {
        showToast('ℹ️ 未检测到搜索URL，请在规则编辑器中手动填写');
    }
    
    // 隐藏搜索捕获界面
    document.getElementById('searchCaptureSection').classList.add('hidden');
    
    // 显示结果
    displayResult(currentResult);
    document.getElementById('resultSection').classList.remove('hidden');
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

    // 添加书源格式说明
    const formatNote = document.createElement('div');
    formatNote.className = 'format-note';
    formatNote.innerHTML = `
        <p>📖 <strong>阅读App书源格式说明：</strong></p>
        <ul>
            <li><code>searchUrl</code> - 搜索URL，用 <code>{{key}}</code> 代替关键词</li>
            <li><code>ruleSearch.bookUrl</code> - <strong>关键！</strong>搜索结果中每本书的详情页链接</li>
            <li><code>ruleBookInfo.tocUrl</code> - 目录页链接（如果详情页和目录页不同）</li>
            <li><code>ruleToc.chapterUrl</code> - 章节链接，用 <code>@href</code> 获取URL</li>
        </ul>
        <p>💡 如果搜索无结果，请检查 <code>ruleSearch.bookList</code> 和 <code>ruleSearch.bookUrl</code></p>
    `;
    preview.appendChild(formatNote);
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
    document.getElementById('searchCaptureSection').classList.add('hidden');
    document.getElementById('filePathHint').classList.add('hidden');
    
    // 重置搜索捕获状态
    capturedSearchUrl = null;
    autoDetectedSearchUrl = null;
    const parseBtn = document.getElementById('parseSearchUrlBtn');
    parseBtn.disabled = true;
    parseBtn.textContent = '🔄 解析搜索URL';
    parseBtn.onclick = parseSearchUrl;
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
