/**
 * 书源分析引擎 v3.0 - 智能检测网站结构并生成阅读App兼容书源
 * 
 * 输出格式兼容阅读App v3.x 的嵌套JSON格式：
 * {
 *   "ruleSearch": { "bookList": "...", "name": "...", ... },
 *   "ruleBookInfo": { "name": "...", "author": "...", ... },
 *   "ruleToc": { "chapterList": "...", "chapterName": "...", ... },
 *   "ruleContent": { "content": "..." }
 * }
 */
class BookSourceAnalyzer {
    constructor() {
        this.proxyUrl = 'https://api.allorigins.win/raw?url=';
        this.proxyUrl2 = 'https://corsproxy.io/?';
        this.proxyUrl3 = 'https://api.codetabs.com/v1/proxy?quest=';
    }

    /**
     * 分析网站并生成书源
     */
    async analyze(url, siteName) {
        // 获取网页内容
        const html = await this.fetchPage(url);
        
        // 解析HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 提取网站信息
        const title = doc.querySelector('title')?.textContent || '';
        const name = siteName || this.extractSiteName(url, title);
        
        // 检测搜索功能
        const searchInfo = this.detectSearch(url, doc, html);
        
        // 生成书源（新版嵌套格式）
        const bookSource = this.generateBookSource(url, name, doc, html, searchInfo);
        
        return {
            bookSource,
            detected: {
                title,
                name,
                searchUrl: searchInfo.url,
                hasSearchForm: searchInfo.hasForm
            }
        };
    }

    /**
     * 获取网页内容（带重试）
     */
    async fetchPage(url, retries = 3) {
        const proxies = [
            url,
            this.proxyUrl + encodeURIComponent(url),
            this.proxyUrl2 + encodeURIComponent(url),
            this.proxyUrl3 + encodeURIComponent(url)
        ];

        for (let i = 0; i < proxies.length; i++) {
            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    const response = await fetch(proxies[i], {
                        signal: AbortSignal.timeout(15000)
                    });
                    if (response.ok) {
                        return await response.text();
                    }
                } catch (e) {
                    if (attempt === retries - 1 && i === proxies.length - 1) {
                        throw new Error(`无法获取网页内容: ${e.message}`);
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        throw new Error('所有代理都失败了');
    }

    /**
     * 提取网站名称
     */
    extractSiteName(url, title) {
        // 从标题提取
        if (title) {
            const clean = title.replace(/[-_|].*$/, '').trim();
            if (clean.length > 0 && clean.length < 50) return clean;
        }
        
        // 从URL提取
        try {
            const hostname = new URL(url).hostname;
            const parts = hostname.replace('www.', '').split('.');
            return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        } catch {
            return '未知网站';
        }
    }

    /**
     * 检测搜索功能
     * 返回 { url, hasForm, inputName }
     */
    detectSearch(url, doc, html) {
        const baseUrl = this.cleanUrl(url);
        let result = {
            url: '',
            hasForm: false,
            inputName: 'key'
        };

        // 1. 查找搜索表单
        const forms = doc.querySelectorAll('form');
        for (const form of forms) {
            const action = (form.getAttribute('action') || '').trim();
            const inputs = form.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
            
            for (const input of inputs) {
                const name = input.getAttribute('name') || '';
                const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                const id = (input.id || '').toLowerCase();
                
                // 判断是否是搜索输入框
                const isSearch = /search|key|keyword|word|query|q|s|so|book|novel|小说|搜索/.test(name + placeholder + id);
                if (isSearch && name) {
                    let searchUrl = action;
                    
                    // 处理相对路径
                    if (searchUrl && !searchUrl.startsWith('http')) {
                        if (searchUrl.startsWith('/')) {
                            searchUrl = baseUrl + searchUrl;
                        } else {
                            searchUrl = baseUrl + '/' + searchUrl;
                        }
                    }
                    
                    // 如果没有action，使用当前页面
                    if (!searchUrl) {
                        searchUrl = window.location.href || baseUrl;
                    }
                    
                    // 添加查询参数
                    const separator = searchUrl.includes('?') ? '&' : '?';
                    result.url = searchUrl + separator + name + '={{key}}';
                    result.hasForm = true;
                    result.inputName = name;
                    return result;
                }
            }
        }

        // 2. 查找搜索链接（如 /i/so.aspx）
        const searchLinkSelectors = [
            'a[href*="so"]', 'a[href*="search"]', 'a[href*="s?key"]',
            'a[href*="s?word"]', 'a[href*="find"]', 'a[href*="query"]'
        ];
        
        for (const selector of searchLinkSelectors) {
            const links = doc.querySelectorAll(selector);
            for (const link of links) {
                const href = link.getAttribute('href') || '';
                const text = (link.textContent || '').toLowerCase();
                if (/搜索|search|查找|找书/.test(text) || /so|search/.test(href)) {
                    let searchPageUrl = href;
                    if (!searchPageUrl.startsWith('http')) {
                        searchPageUrl = (searchPageUrl.startsWith('/') ? baseUrl : baseUrl + '/') + searchPageUrl;
                    }
                    // 返回搜索页面URL，让用户手动确认参数
                    result.url = searchPageUrl + '?key={{key}}';
                    result.hasForm = false;
                    return result;
                }
            }
        }

        // 3. 常见搜索URL模式
        const commonPatterns = [
            '/search?keyword={{key}}',
            '/search?key={{key}}',
            '/search?q={{key}}',
            '/search?searchkey={{key}}',
            '/s?q={{key}}',
            '/s?wd={{key}}',
            '/s?key={{key}}',
            '/so?key={{key}}',
            '/so?keyword={{key}}',
            '/i/so.aspx?key={{key}}',
            '/modules/article/search.php?searchkey={{key}}',
            '/book/search?keyword={{key}}'
        ];

        for (const pattern of commonPatterns) {
            result.url = baseUrl + pattern;
        }

        return result;
    }

    /**
     * 清理URL
     */
    cleanUrl(url) {
        try {
            const u = new URL(url);
            return `${u.protocol}//${u.hostname}`;
        } catch {
            return url;
        }
    }

    /**
     * 生成书源规则（阅读App v3.x 嵌套格式）
     */
    generateBookSource(url, name, doc, html, searchInfo) {
        // 构建嵌套规则
        const ruleSearch = this.buildSearchRule(doc, html);
        const ruleBookInfo = this.buildBookInfoRule(doc);
        const ruleToc = this.buildTocRule(doc);
        const ruleContent = this.buildContentRule(doc);

        const bookSource = {
            bookSourceGroup: "自动生成",
            bookSourceName: name,
            bookSourceUrl: this.cleanUrl(url),
            bookSourceType: 0,
            bookSourceComment: "由书源生成器自动生成",
            header: JSON.stringify({
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            }),
            enabled: true,
            enabledExplore: true,
            enabledCookieJar: true,
            concurrentRate: "1",
            searchUrl: searchInfo.url,
            ruleSearch: ruleSearch,
            ruleBookInfo: ruleBookInfo,
            ruleToc: ruleToc,
            ruleContent: ruleContent
        };

        // 清理空值
        this.cleanEmptyValues(bookSource);
        
        return bookSource;
    }

    /**
     * 构建搜索规则 (ruleSearch)
     */
    buildSearchRule(doc, html) {
        const rule = {};
        
        // 检测搜索结果列表容器
        const listSelectors = [
            // 精确匹配
            '.search-list', '.search_result', '.result-list', '.result-list',
            '.book-list', '.booklist', '.books-list',
            '.novelslist', '.s-list', '.so-list',
            // 通用
            '.list', '.item-list',
            'ul.list', 'ul.book-list',
            // 最通用
            '.item', '.result-item',
            // 表格
            'table.grid', 'table.list'
        ];

        for (const sel of listSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                // 检查是否有多个子元素
                const children = el.children.length > 0 ? el.children : el.querySelectorAll('li, tr, .item, div');
                if (children.length >= 2) {
                    rule.bookList = sel;
                    break;
                }
            }
        }

        // 如果没找到，尝试更通用的选择器
        if (!rule.bookList) {
            // 查找包含多个链接的容器
            const containers = doc.querySelectorAll('div.container, div.main, div.content, div.body');
            for (const container of containers) {
                const links = container.querySelectorAll('a[href]');
                if (links.length >= 5) {
                    // 检查是否有重复结构
                    const items = container.querySelectorAll(':scope > div, :scope > ul > li, :scope > table > tr');
                    if (items.length >= 3) {
                        rule.bookList = container.tagName.toLowerCase() + 
                            (container.className ? '.' + container.className.split(' ').join('.') : '') + 
                            ' > div, ' + 
                            container.tagName.toLowerCase() + 
                            (container.className ? '.' + container.className.split(' ').join('.') : '') + 
                            ' > ul > li';
                        break;
                    }
                }
            }
        }

        // 检测书名
        if (rule.bookList) {
            // 在列表项中查找链接
            const sampleItems = doc.querySelectorAll(rule.bookList);
            if (sampleItems.length > 0) {
                const firstItem = sampleItems[0];
                const links = firstItem.querySelectorAll('a[href]');
                
                // 找最可能是书名的链接（文本较长、没有数字特征）
                let bestLink = null;
                let bestScore = -1;
                for (const link of links) {
                    const text = (link.textContent || '').trim();
                    const href = link.getAttribute('href') || '';
                    if (text.length >= 2 && text.length < 50) {
                        let score = text.length;
                        // 优先选择包含数字ID路径的链接（如 /123/）
                        if (/\/\d+\//.test(href)) score += 10;
                        // 优先选择文本不是纯数字的
                        if (!/^\d+$/.test(text)) score += 5;
                        if (score > bestScore) {
                            bestScore = score;
                            bestLink = link;
                        }
                    }
                }
                
                if (bestLink) {
                    // 确定唯一选择器
                    const tag = bestLink.tagName.toLowerCase();
                    const parentTag = bestLink.parentElement.tagName.toLowerCase();
                    const parentClass = bestLink.parentElement.className;
                    
                    if (parentClass) {
                        rule.name = parentTag + '.' + parentClass.split(' ')[0] + ' ' + tag + '@text';
                        rule.bookUrl = parentTag + '.' + parentClass.split(' ')[0] + ' ' + tag + '@href';
                    } else {
                        rule.name = tag + '@text';
                        rule.bookUrl = tag + '@href';
                    }
                }
            }
        }

        // 兜底：使用通用选择器
        if (!rule.bookList) {
            rule.bookList = 'div.item, li, tr';
        }
        if (!rule.name) {
            rule.name = 'a@text';
            rule.bookUrl = 'a@href';
        }

        // 检测作者
        const authorSelectors = [
            '.author', 'p.author', 'span.author',
            '.bookauthor', '.book-author',
            'td.author', 'td:nth-child(3)'
        ];
        for (const sel of authorSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent.trim()) {
                rule.author = sel;
                break;
            }
        }

        // 检测封面
        const coverSelectors = [
            'img.cover', '.cover img', '.item img',
            'img[src*="cover"]', 'img[src*="book"]',
            'li img', 'td img'
        ];
        for (const sel of coverSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                rule.coverUrl = sel + '@src';
                break;
            }
        }

        return rule;
    }

    /**
     * 构建书籍信息规则 (ruleBookInfo)
     */
    buildBookInfoRule(doc) {
        const rule = {};

        // 书名
        const nameSelectors = [
            'meta[property="og:novel:book_name"]@content',
            'meta[property="og:title"]@content',
            'h1', '.bookname', '.book-name', '.book_name',
            '.name', '.title', '.bookInfo .name',
            '.detail h1', '.info h1'
        ];
        for (const sel of nameSelectors) {
            const [selector, attr] = sel.includes('@') ? sel.split('@') : [sel, 'text'];
            const el = doc.querySelector(selector);
            if (el) {
                const val = attr === 'content' ? el.getAttribute('content') : el.textContent;
                if (val && val.trim()) {
                    rule.name = sel;
                    break;
                }
            }
        }

        // 作者
        const authorSelectors = [
            'meta[property="og:novel:author"]@content',
            '.author', '.bookauthor', '.writer',
            '.info .author', '.detail .author',
            'span.author', 'p.author'
        ];
        for (const sel of authorSelectors) {
            const [selector, attr] = sel.includes('@') ? sel.split('@') : [sel, 'text'];
            const el = doc.querySelector(selector);
            if (el) {
                const val = attr === 'content' ? el.getAttribute('content') : el.textContent;
                if (val && val.trim()) {
                    rule.author = sel;
                    break;
                }
            }
        }

        // 封面
        const coverSelectors = [
            'meta[property="og:image"]@content',
            '.cover img@src', '.bookcover img@src',
            '.bookimg img@src', '.pic img@src',
            'img.cover@src'
        ];
        for (const sel of coverSelectors) {
            const [selector, attr] = sel.split('@');
            const el = doc.querySelector(selector);
            if (el) {
                const val = el.getAttribute(attr);
                if (val) {
                    rule.coverUrl = sel;
                    break;
                }
            }
        }

        // 简介
        const introSelectors = [
            'meta[property="og:description"]@content',
            'meta[name="description"]@content',
            '.intro', '.introduce', '.description',
            '.desc', '.bookdesc', '.summary',
            '#intro', '#description'
        ];
        for (const sel of introSelectors) {
            const [selector, attr] = sel.includes('@') ? sel.split('@') : [sel, 'text'];
            const el = doc.querySelector(selector);
            if (el) {
                const val = attr === 'content' ? el.getAttribute('content') : el.textContent;
                if (val && val.trim()) {
                    rule.intro = sel;
                    break;
                }
            }
        }

        // 分类
        const kindSelectors = [
            'meta[property="og:novel:category"]@content',
            '.kind', '.category', '.type',
            'span.kind', 'span.category',
            '.info .kind', '.detail .kind'
        ];
        for (const sel of kindSelectors) {
            const [selector, attr] = sel.includes('@') ? sel.split('@') : [sel, 'text'];
            const el = doc.querySelector(selector);
            if (el) {
                const val = attr === 'content' ? el.getAttribute('content') : el.textContent;
                if (val && val.trim()) {
                    rule.kind = sel;
                    break;
                }
            }
        }

        // 最新章节
        const lastChapterSelectors = [
            '.last', '.lastchapter', '.last-chapter',
            '.newest', '.newchapter', '.new-chapter',
            '.update .chapter', '.latest .chapter',
            'span.last', 'p.last'
        ];
        for (const sel of lastChapterSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent.trim()) {
                rule.lastChapter = sel;
                break;
            }
        }

        return rule;
    }

    /**
     * 构建目录规则 (ruleToc)
     */
    buildTocRule(doc) {
        const rule = {};

        // 章节列表容器
        const listSelectors = [
            '#list', '.list', '.chapter-list', '.chapters',
            '.chapterlist', '.chapter_list', '.catalog',
            '.directory', '.index',
            '#chapters', '#chapter-list', '#catalog',
            'ul.chapter', 'ul.chapters', 'ul.list',
            'div[class*="list"]', 'div[id*="list"]',
            'div[class*="chapter"]', 'div[id*="chapter"]'
        ];

        for (const sel of listSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                const items = el.querySelectorAll('li, tr');
                if (items.length >= 2) {
                    rule.chapterList = sel + ' li, ' + sel + ' tr';
                    break;
                }
                // 如果容器本身包含直接链接
                const directLinks = el.querySelectorAll('a');
                if (directLinks.length >= 2) {
                    rule.chapterList = sel + ' a';
                    break;
                }
            }
        }

        // 兜底
        if (!rule.chapterList) {
            // 查找包含大量链接的区域
            const allLinks = doc.querySelectorAll('a[href]');
            const linkGroups = {};
            for (const link of allLinks) {
                const parent = link.parentElement;
                if (parent) {
                    const key = parent.tagName + (parent.className ? '.' + parent.className.split(' ').join('.') : '');
                    linkGroups[key] = (linkGroups[key] || 0) + 1;
                }
            }
            
            // 找到链接最多的父容器
            let maxCount = 0;
            let bestKey = '';
            for (const [key, count] of Object.entries(linkGroups)) {
                if (count > maxCount && count >= 5) {
                    maxCount = count;
                    bestKey = key;
                }
            }
            
            if (bestKey) {
                rule.chapterList = bestKey;
            } else {
                rule.chapterList = 'li';
            }
        }

        // 章节名和URL
        rule.chapterName = 'a@text';
        rule.chapterUrl = 'a@href';

        // 检查是否有分页
        const pageLinks = doc.querySelectorAll('.page a, .pagelink a, #pagelink a, a[href*="page"], a[href*="index"]');
        if (pageLinks.length > 1) {
            rule.chapterList = rule.chapterList + ', ' + rule.chapterList;
        }

        return rule;
    }

    /**
     * 构建内容规则 (ruleContent)
     */
    buildContentRule(doc) {
        const rule = {};

        const contentSelectors = [
            '#content', '.content', '.bookcontent', '.book-content',
            '.text', '.article', '.chapter-content',
            '#bookcontent', '#chaptercontent', '#textcontent',
            '.read-content', '.novel-content', '.txt',
            'article', 'main',
            'div[class*="content"]', 'div[id*="content"]',
            'div[class*="text"]', 'div[id*="text"]',
            'div[class*="chapter"]', 'div[id*="chapter"]',
            '.container p', '.content p',
            'p'
        ];

        for (const sel of contentSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                const text = el.textContent.trim();
                if (text.length > 100) {
                    rule.content = sel;
                    break;
                }
            }
        }

        // 内容替换规则（清理广告等）
        rule.contentReplace = null;

        return rule;
    }

    /**
     * 清理空值
     */
    cleanEmptyValues(obj) {
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val === null || val === undefined || val === '') {
                delete obj[key];
            } else if (typeof val === 'object' && !Array.isArray(val)) {
                this.cleanEmptyValues(val);
                if (Object.keys(val).length === 0) {
                    delete obj[key];
                }
            }
        }
    }
}
