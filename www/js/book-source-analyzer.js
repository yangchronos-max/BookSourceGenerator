/**
 * 书源分析引擎 v3.0 - 智能检测网站结构并生成阅读App兼容书源
 * 
 * 参考项目：
 * - https://github.com/xy9144/auto_source_generator (Python版)
 * - 阅读App官方讨论: https://github.com/gedoor/legado/discussions/5765
 * 
 * 输出格式兼容阅读App v3.x 标准格式：
 * {
 *   "searchUrl": "URL,{'method':'POST','body':'key={{key}}'}",
 *   "ruleSearch": { "bookList": "...", "name": "...", ... },
 *   "ruleBookInfo": { "name": "...", "author": "...", ... },
 *   "ruleToc": { "chapterList": "...", "chapterName": "...", ... },
 *   "ruleContent": { "content": "..." }
 * }
 * 
 * 核心规则（来自教程和auto_source_generator）：
 * 1. POST搜索格式: URL,{'method':'POST','body':'key={{key}}'}
 *    - 单引号格式（教程写法）
 *    - 双引号格式也支持: URL,{"method":"POST","body":"key={{key}}"}
 * 2. GET搜索格式: URL?key={{key}}
 * 3. 解析规则支持: CSS选择器 / XPath(@XPath:) / JSONPath / JS(<js></js>)
 * 4. 文本替换: ##regex##新内容
 * 5. WebView加载: URL##$##,{"webView":true}
 * 6. 发现规则: 分类名称::路径
 * 7. 章节倒序: 规则前加"-"前缀
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
        
        // 生成书源（标准格式）
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
     * 返回 { url, hasForm, inputName, isPost, postBody }
     * 
     * 参考 auto_source_generator.py 的 analyze_search_function 方法
     * 和 _build_yuedu_search_url 方法
     */
    detectSearch(url, doc, html) {
        const baseUrl = this.cleanUrl(url);
        let result = {
            url: '',
            hasForm: false,
            inputName: 'key',
            isPost: false,
            postBody: ''
        };

        // 1. 查找搜索表单（参考 auto_source_generator 的 FormFinder）
        const forms = doc.querySelectorAll('form');
        for (const form of forms) {
            const action = (form.getAttribute('action') || '').trim();
            const method = (form.getAttribute('method') || 'get').toLowerCase();
            const inputs = form.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[type="hidden"]');
            
            for (const input of inputs) {
                const name = input.getAttribute('name') || '';
                const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                const id = (input.id || '').toLowerCase();
                const inputType = input.getAttribute('type') || 'text';
                
                // 判断是否是搜索输入框（参考 auto_source_generator 的判断逻辑）
                const isSearch = /search|key|keyword|word|query|q|s|so|book|novel|小说|搜索|keyboard|searchkey|searchword|wd/.test(name + placeholder + id);
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
                    
                    // 收集隐藏参数（参考 auto_source_generator 的 hidden_params）
                    const hiddenParams = {};
                    const hiddenInputs = form.querySelectorAll('input[type="hidden"][name]');
                    for (const hi of hiddenInputs) {
                        const hn = hi.getAttribute('name');
                        const hv = hi.getAttribute('value') || '';
                        if (hn) hiddenParams[hn] = hv;
                    }
                    
                    if (method === 'post') {
                        // POST请求：构建阅读App POST搜索格式
                        // 参考 auto_source_generator._build_yuedu_search_url()
                        // 格式1（教程写法，单引号）: URL,{'method':'POST','body':'key={{key}}'}
                        // 格式2（auto_source_generator写法，双引号）: URL,{"method":"POST","body":"key={{key}}"}
                        // 阅读App两种格式都支持
                        
                        // 构建body参数（参考 auto_source_generator）
                        let bodyParts = [];
                        const allInputs = form.querySelectorAll('input[name]');
                        for (const fi of allInputs) {
                            const fn = fi.getAttribute('name');
                            const fv = fi.getAttribute('value') || '';
                            if (fn === name) {
                                bodyParts.push(fn + '={{key}}');
                            } else if (fn && fv) {
                                bodyParts.push(fn + '=' + fv);
                            } else if (fn) {
                                bodyParts.push(fn + '=');
                            }
                        }
                        const body = bodyParts.join('&');
                        
                        // 使用单引号格式（教程推荐写法）
                        result.url = searchUrl + ",{'method':'POST','body':'" + body + "'}";
                        result.hasForm = true;
                        result.inputName = name;
                        result.isPost = true;
                        result.postBody = body;
                    } else {
                        // GET请求：添加查询参数（参考 auto_source_generator）
                        const params = [name + '={{key}}'];
                        for (const [hk, hv] of Object.entries(hiddenParams)) {
                            params.push(hk + '=' + hv);
                        }
                        const paramStr = params.join('&');
                        const separator = searchUrl.includes('?') ? '&' : '?';
                        result.url = searchUrl + separator + paramStr;
                        result.hasForm = true;
                        result.inputName = name;
                        result.isPost = false;
                    }
                    return result;
                }
            }
        }

        // 2. 查找搜索链接
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
     * 生成书源规则（阅读App v3.x 标准格式）
     * 参考 auto_source_generator.generate_source() 方法
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
     * 参考 auto_source_generator.JSOUPRuleExtractor.extract_search_rules()
     */
    buildSearchRule(doc, html) {
        const rule = {};
        
        // 检测搜索结果列表容器（参考 auto_source_generator.find_book_list_container）
        const listSelectors = [
            '.search-list', '.search_result', '.result-list',
            '.book-list', '.booklist', '.books-list',
            '.novelslist', '.s-list', '.so-list',
            '.list', '.item-list',
            'ul.list', 'ul.book-list',
            '.item', '.result-item',
            'table.grid', 'table.list',
            'ul.txt-list', 'div.search-result'
        ];

        for (const sel of listSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                const children = el.children.length > 0 ? el.children : el.querySelectorAll('li, tr, .item, div');
                if (children.length >= 2) {
                    rule.bookList = sel;
                    break;
                }
            }
        }

        // 如果没找到，尝试更通用的选择器
        if (!rule.bookList) {
            const containers = doc.querySelectorAll('div.container, div.main, div.content, div.body');
            for (const container of containers) {
                const links = container.querySelectorAll('a[href]');
                if (links.length >= 5) {
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

        // 检测书名（参考 auto_source_generator._find_name_rule）
        if (rule.bookList) {
            const sampleItems = doc.querySelectorAll(rule.bookList);
            if (sampleItems.length > 0) {
                const firstItem = sampleItems[0];
                const links = firstItem.querySelectorAll('a[href]');
                
                let bestLink = null;
                let bestScore = -1;
                for (const link of links) {
                    const text = (link.textContent || '').trim();
                    const href = link.getAttribute('href') || '';
                    if (text.length >= 2 && text.length < 50) {
                        let score = text.length;
                        if (/\/\d+\//.test(href)) score += 10;
                        if (!/^\d+$/.test(text)) score += 5;
                        if (score > bestScore) {
                            bestScore = score;
                            bestLink = link;
                        }
                    }
                }
                
                if (bestLink) {
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

        // 兜底
        if (!rule.bookList) {
            rule.bookList = 'div.item, li, tr';
        }
        if (!rule.name) {
            rule.name = 'a@text';
            rule.bookUrl = 'a@href';
        }

        // 检测作者（参考 auto_source_generator._find_author_rule）
        const authorSelectors = [
            '.author', 'p.author', 'span.author',
            '.bookauthor', '.book-author',
            'td.author', 'td:nth-child(3)',
            '.s4', '.au', '.writer', '.zz'
        ];
        for (const sel of authorSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent.trim()) {
                let text = el.textContent.trim();
                rule.author = sel;
                // 如果包含"作者"前缀，添加替换规则
                if (text.includes('作者')) {
                    rule.author += '##作者：##';
                }
                break;
            }
        }

        // 检测封面（参考 auto_source_generator._find_cover_rule）
        const coverSelectors = [
            'img.cover', '.cover img', '.item img',
            'img[src*="cover"]', 'img[src*="book"]',
            'li img', 'td img',
            'img[data-src]'
        ];
        for (const sel of coverSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                // 优先使用data-src（懒加载）
                if (el.getAttribute('data-src')) {
                    rule.coverUrl = sel + '@data-src';
                } else {
                    rule.coverUrl = sel + '@src';
                }
                break;
            }
        }

        // 检测最新章节（参考 auto_source_generator._find_last_chapter_rule）
        const lastChapterSelectors = [
            '.s3', '.last', '.chapter', '.new', '.update',
            '.lastchapter', '.last-chapter',
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

        // 检测分类（参考 auto_source_generator._find_kind_rule）
        const kindSelectors = [
            '.s1', '.kind', '.category', '.type', '.sort'
        ];
        for (const sel of kindSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent.trim()) {
                rule.kind = sel;
                break;
            }
        }

        // 检测简介（参考 auto_source_generator._find_intro_rule）
        const introSelectors = [
            '.intro', '.desc', '.summary', '.jianjie', '.jj'
        ];
        for (const sel of introSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent.trim().length > 20) {
                rule.intro = sel;
                break;
            }
        }

        return rule;
    }

    /**
     * 构建书籍信息规则 (ruleBookInfo)
     * 参考 auto_source_generator.JSOUPRuleExtractor.extract_book_info_rules()
     */
    buildBookInfoRule(doc) {
        const rule = {};

        // 书名（参考 auto_source_generator._find_detail_name_rule）
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

        // 作者（参考 auto_source_generator._find_detail_author_rule）
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
                    // 如果包含"作者"前缀，添加替换规则
                    if (val.includes('作者')) {
                        rule.author += '##作者：##';
                    }
                    break;
                }
            }
        }

        // 封面（参考 auto_source_generator._find_detail_cover_rule）
        const coverSelectors = [
            'meta[property="og:image"]@content',
            '.cover img@src', '.bookcover img@src',
            '.bookimg img@src', '.pic img@src',
            'img.cover@src',
            'img[data-src]@data-src'
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

        // 简介（参考 auto_source_generator._find_detail_intro_rule）
        const introSelectors = [
            'meta[property="og:description"]@content',
            'meta[name="description"]@content',
            '.intro', '.introduce', '.description',
            '.desc', '.bookdesc', '.summary',
            '#intro', '#description',
            '.jianjie', '#desc'
        ];
        for (const sel of introSelectors) {
            const [selector, attr] = sel.includes('@') ? sel.split('@') : [sel, 'text'];
            const el = doc.querySelector(selector);
            if (el) {
                const val = attr === 'content' ? el.getAttribute('content') : el.textContent;
                if (val && val.trim().length > 20) {
                    rule.intro = sel;
                    break;
                }
            }
        }

        // 分类（参考 auto_source_generator._find_detail_kind_rule）
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

        // 最新章节（参考 auto_source_generator._find_detail_last_chapter_rule）
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

        // 字数（参考 auto_source_generator._find_word_count_rule）
        const wordCountSelectors = [
            '.wordcount', '.count', '.words',
            'span.word', 'span.count'
        ];
        for (const sel of wordCountSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent.trim().includes('字')) {
                rule.wordCount = sel;
                break;
            }
        }

        // 目录URL（参考 auto_source_generator._find_toc_url_rule）
        const tocUrlSelectors = [
            'a[href*="catalog"]', 'a[href*="chapter"]',
            'a[href*="directory"]', 'a[href*="index"]',
            'a[href*="list"]'
        ];
        for (const sel of tocUrlSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                const text = el.textContent.trim();
                if (text.includes('目录') || text.includes('阅读')) {
                    rule.tocUrl = sel + '@href';
                    break;
                }
            }
        }

        return rule;
    }

    /**
     * 构建目录规则 (ruleToc)
     * 参考 auto_source_generator.JSOUPRuleExtractor.extract_toc_rules()
     */
    buildTocRule(doc) {
        const rule = {};

        // 章节列表容器（参考 auto_source_generator._find_chapter_list_rule）
        const listSelectors = [
            '#list', '.list', '.chapter-list', '.chapters',
            '.chapterlist', '.chapter_list', '.catalog',
            '.directory', '.index',
            '#chapters', '#chapter-list', '#catalog',
            'ul.chapter', 'ul.chapters', 'ul.list',
            'div[class*="list"]', 'div[id*="list"]',
            'div[class*="chapter"]', 'div[id*="chapter"]',
            'dl', 'dd'
        ];

        for (const sel of listSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                const items = el.querySelectorAll('li, tr, dd');
                if (items.length >= 2) {
                    rule.chapterList = sel + ' li, ' + sel + ' tr, ' + sel + ' dd';
                    break;
                }
                const directLinks = el.querySelectorAll('a');
                if (directLinks.length >= 2) {
                    rule.chapterList = sel + ' a';
                    break;
                }
            }
        }

        // 兜底
        if (!rule.chapterList) {
            const allLinks = doc.querySelectorAll('a[href]');
            const linkGroups = {};
            for (const link of allLinks) {
                const parent = link.parentElement;
                if (parent) {
                    const key = parent.tagName + (parent.className ? '.' + parent.className.split(' ').join('.') : '');
                    linkGroups[key] = (linkGroups[key] || 0) + 1;
                }
            }
            
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
     * 参考 auto_source_generator.JSOUPRuleExtractor.extract_content_rules()
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

        // 内容替换规则（清理广告等，参考 auto_source_generator._find_ads_pattern）
        const adsKeywords = [
            '本章未完', '点击下一页', '手机阅读', '最新网址',
            '请记住', '首发域名', '笔趣阁', '阅读更多'
        ];
        const foundAds = adsKeywords.filter(k => doc.body?.textContent?.includes(k));
        if (foundAds.length > 0) {
            rule.replaceRegex = '##' + foundAds.join('|') + '.*?##';
        }

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
