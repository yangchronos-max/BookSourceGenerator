/**
 * 书源分析引擎 - 自动分析小说网站结构并生成 Legado 3.0 书源
 */
class BookSourceAnalyzer {
    constructor() {
        this.proxyUrl = '';
        this.analysisResult = null;
    }

    /**
     * 通过代理获取网页内容（绕过CORS限制）
     */
    async fetchPage(url) {
        // 尝试多种方式获取页面内容
        const methods = [
            () => this.fetchWithCorsProxy(url),
            () => this.fetchWithJsonp(url),
            () => this.fetchWithDirect(url)
        ];

        for (const method of methods) {
            try {
                const result = await method();
                if (result) return result;
            } catch (e) {
                console.warn('Fetch method failed:', e.message);
            }
        }
        throw new Error('无法获取网页内容，请检查URL是否正确');
    }

    /**
     * 使用CORS代理获取
     */
    async fetchWithCorsProxy(url) {
        const proxies = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
        ];

        for (const proxy of proxies) {
            try {
                const response = await fetch(proxy, {
                    signal: AbortSignal.timeout(10000)
                });
                if (response.ok) {
                    const text = await response.text();
                    if (text && text.length > 100) return text;
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    /**
     * 直接获取（适用于同源或CORS允许的站点）
     */
    async fetchWithDirect(url) {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (response.ok) {
            return await response.text();
        }
        return null;
    }

    /**
     * JSONP方式获取（备用）
     */
    async fetchWithJsonp(url) {
        return new Promise((resolve, reject) => {
            const callbackName = 'jsonp_' + Date.now();
            const script = document.createElement('script');
            
            window[callbackName] = (data) => {
                delete window[callbackName];
                document.body.removeChild(script);
                resolve(typeof data === 'string' ? data : JSON.stringify(data));
            };

            script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + callbackName;
            script.onerror = () => {
                delete window[callbackName];
                document.body.removeChild(script);
                reject(new Error('JSONP failed'));
            };
            
            document.body.appendChild(script);
            setTimeout(() => {
                delete window[callbackName];
                document.body.removeChild(script);
                reject(new Error('JSONP timeout'));
            }, 8000);
        });
    }

    /**
     * 解析HTML并分析网站结构
     */
    analyzeHTML(html, baseUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const baseHost = new URL(baseUrl).hostname;

        return {
            doc: doc,
            baseUrl: baseUrl,
            baseHost: baseHost,
            title: doc.title,
            meta: this.extractMeta(doc),
            links: this.extractLinks(doc, baseUrl),
            commonPatterns: this.detectCommonPatterns(doc),
            likelyStructure: this.detectSiteStructure(doc, baseUrl)
        };
    }

    /**
     * 提取页面元数据
     */
    extractMeta(doc) {
        const meta = {};
        
        // 从meta标签提取
        doc.querySelectorAll('meta').forEach(el => {
            const name = el.getAttribute('name') || el.getAttribute('property') || '';
            const content = el.getAttribute('content') || '';
            if (name && content) meta[name.toLowerCase()] = content;
        });

        return meta;
    }

    /**
     * 提取所有链接并分类
     */
    extractLinks(doc, baseUrl) {
        const links = {
            internal: [],
            external: [],
            likelyNovel: [],
            likelyChapter: [],
            likelySearch: []
        };

        const baseHost = new URL(baseUrl).hostname;
        const seenUrls = new Set();

        doc.querySelectorAll('a[href]').forEach(el => {
            let href = el.getAttribute('href');
            if (!href || href.startsWith('javascript:') || href === '#') return;

            try {
                const fullUrl = new URL(href, baseUrl).href;
                if (seenUrls.has(fullUrl)) return;
                seenUrls.add(fullUrl);

                const text = (el.textContent || '').trim().substring(0, 50);
                const urlHost = new URL(fullUrl).hostname;

                const linkInfo = { url: fullUrl, text, host: urlHost };

                if (urlHost === baseHost) {
                    links.internal.push(linkInfo);
                    
                    // 检测是否可能是小说链接
                    if (this.isLikelyNovelLink(fullUrl, text)) {
                        links.likelyNovel.push(linkInfo);
                    }
                    
                    // 检测是否可能是章节链接
                    if (this.isLikelyChapterLink(fullUrl, text)) {
                        links.likelyChapter.push(linkInfo);
                    }
                } else {
                    links.external.push(linkInfo);
                }
            } catch (e) {
                // 忽略无效URL
            }
        });

        return links;
    }

    /**
     * 检测是否可能是小说链接
     */
    isLikelyNovelLink(url, text) {
        const novelKeywords = ['book', 'novel', '小说', 'novel', 'story', 'read', 'info', 'detail', 'bookinfo',
                              'chapter', '目录', 'list', 'index', 'article', 'content', 'view'];
        const urlLower = url.toLowerCase();
        const textLower = text.toLowerCase();

        // 检查URL模式
        const urlPatterns = [
            /\/book\//i, /\/novel\//i, /\/info\//i, /\/detail\//i,
            /\/read\//i, /\/story\//i, /bookinfo/i, /novelinfo/i,
            /\/(\d+)\.html$/, /id=\d+/i, /bookid=/i
        ];

        for (const pattern of urlPatterns) {
            if (pattern.test(urlLower)) return true;
        }

        // 检查文本内容
        const textPatterns = ['章', '节', '卷', '篇', '部', '集'];
        for (const keyword of textPatterns) {
            if (textLower.includes(keyword)) return true;
        }

        // 检查URL中是否包含数字ID（可能是小说ID）
        const idMatch = url.match(/\/(\d{4,})\//);
        if (idMatch) return true;

        return false;
    }

    /**
     * 检测是否可能是章节链接
     */
    isLikelyChapterLink(url, text) {
        const chapterPatterns = [
            /\/chapter\//i, /\/read\//i, /\/content\//i,
            /chapter_\d+/i, /read_\d+/i,
            /(\d+)\.html$/,
            /第[0-9一二三四五六七八九十百千万]+[章节卷篇部集]/
        ];

        for (const pattern of chapterPatterns) {
            if (pattern.test(url) || pattern.test(text)) return true;
        }

        return false;
    }

    /**
     * 检测常见网站模式
     */
    detectCommonPatterns(doc) {
        const patterns = {};

        // 检测导航菜单
        const navs = doc.querySelectorAll('nav, .nav, .menu, #nav, #menu, .navigation, .navbar');
        patterns.hasNavigation = navs.length > 0;

        // 检测搜索框
        const searchInputs = doc.querySelectorAll('input[type="text"], input[type="search"], input[name*="search"], input[id*="search"], input[class*="search"]');
        patterns.hasSearch = searchInputs.length > 0;
        if (searchInputs.length > 0) {
            patterns.searchInput = {
                selector: this.generateSelector(searchInputs[0]),
                name: searchInputs[0].getAttribute('name') || searchInputs[0].getAttribute('id') || ''
            };
        }

        // 检测搜索按钮
        const searchBtns = doc.querySelectorAll('button[type="submit"], input[type="submit"], button:has(input[name*="search"]), a[href*="search"], a[href*="so"]');
        patterns.hasSearchButton = searchBtns.length > 0;

        // 检测列表结构
        const lists = doc.querySelectorAll('ul.list, ol.list, .list, .book-list, .novel-list, .chapter-list, .booklist, .novellist');
        patterns.hasList = lists.length > 0;

        // 检测分页
        const paginations = doc.querySelectorAll('.pagination, .page, .pages, #pages, .pager, .page-nav');
        patterns.hasPagination = paginations.length > 0;

        // 检测可能的小说列表容器
        const possibleContainers = doc.querySelectorAll('.book, .novel, .item, .card, .post, .article, li, tr');
        patterns.containerCount = possibleContainers.length;

        // 检测图片（可能是封面）
        const images = doc.querySelectorAll('img[src*="cover"], img[class*="cover"], img[class*="book"], img[class*="thumb"], img[class*="pic"]');
        patterns.hasCoverImages = images.length > 0;

        return patterns;
    }

    /**
     * 检测网站结构类型
     */
    detectSiteStructure(doc, baseUrl) {
        const structure = {
            type: 'unknown',
            searchUrl: null,
            searchListSelector: null,
            bookUrlPattern: null,
            confidence: 0
        };

        const html = doc.documentElement.outerHTML;

        // 检测是否为通用小说站
        if (this.isNovelSite(doc, html)) {
            structure.type = 'novel-site';
            structure.confidence = 0.7;
            
            // 尝试检测搜索URL模式
            structure.searchUrl = this.detectSearchUrl(doc, baseUrl);
            
            // 尝试检测列表选择器
            structure.searchListSelector = this.detectListSelector(doc);
            
            // 尝试检测书籍URL模式
            structure.bookUrlPattern = this.detectBookUrlPattern(doc);
        }

        return structure;
    }

    /**
     * 判断是否为小说网站
     */
    isNovelSite(doc, html) {
        const novelIndicators = [
            '小说', 'novel', 'book', '阅读', 'read', '章节', 'chapter',
            '作者', 'author', '连载', '完本', '玄幻', '修真', '都市',
            '言情', '穿越', '重生', '武侠', '奇幻'
        ];

        let score = 0;
        const text = (doc.title + ' ' + html).toLowerCase();

        for (const indicator of novelIndicators) {
            if (text.includes(indicator.toLowerCase())) {
                score++;
            }
        }

        return score >= 3;
    }

    /**
     * 检测搜索URL
     */
    detectSearchUrl(doc, baseUrl) {
        // 查找搜索表单
        const forms = doc.querySelectorAll('form');
        for (const form of forms) {
            const action = form.getAttribute('action');
            const hasSearchInput = form.querySelector('input[type="text"], input[type="search"], input[name*="search"], input[id*="search"]');
            
            if (hasSearchInput) {
                let searchUrl = action || '';
                if (searchUrl && !searchUrl.startsWith('http')) {
                    searchUrl = new URL(searchUrl, baseUrl).href;
                }
                return searchUrl || baseUrl;
            }
        }

        // 查找搜索链接
        const searchLinks = doc.querySelectorAll('a[href*="search"], a[href*="so"], a[href*="find"], a[href*="query"]');
        if (searchLinks.length > 0) {
            const href = searchLinks[0].getAttribute('href');
            return new URL(href, baseUrl).href;
        }

        return null;
    }

    /**
     * 检测列表选择器
     */
    detectListSelector(doc) {
        // 尝试多种常见列表选择器
        const selectors = [
            '.book-list', '.novel-list', '.list', '.booklist', '.novellist',
            'ul.list', 'ol.list', '.items', '.book-items',
            'table:has(a)', 'ul:has(a)', '.recommend-list',
            '.hot-list', '.update-list', '.rank-list'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0 && elements.length < 50) {
                return selector;
            }
        }

        // 尝试自动检测：查找包含多个链接的容器
        const containers = doc.querySelectorAll('ul, ol, .list, .items, .content, .main');
        for (const container of containers) {
            const links = container.querySelectorAll('a');
            if (links.length >= 5 && links.length <= 100) {
                return this.generateSelector(container);
            }
        }

        return null;
    }

    /**
     * 检测书籍URL模式
     */
    detectBookUrlPattern(doc) {
        const links = doc.querySelectorAll('a[href]');
        const patterns = new Map();

        for (const link of links) {
            const href = link.getAttribute('href');
            if (!href || href.startsWith('javascript:') || href === '#') continue;

            // 提取URL模式
            const normalized = href.replace(/\d+/g, '{id}');
            patterns.set(normalized, (patterns.get(normalized) || 0) + 1);
        }

        // 找出最常见的模式
        let bestPattern = null;
        let bestCount = 0;

        for (const [pattern, count] of patterns) {
            if (count > bestCount && count >= 3) {
                bestPattern = pattern;
                bestCount = count;
            }
        }

        return bestPattern;
    }

    /**
     * 生成CSS选择器
     */
    generateSelector(element) {
        if (element.id) {
            return '#' + element.id;
        }

        if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/).filter(c => c);
            if (classes.length > 0) {
                return '.' + classes.join('.');
            }
        }

        const tag = element.tagName.toLowerCase();
        const parent = element.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
            const index = siblings.indexOf(element) + 1;
            return `${this.generateSelector(parent)} > ${tag}:nth-child(${index})`;
        }

        return tag;
    }

    /**
     * 生成Legado 3.0书源JSON
     */
    generateBookSource(analysis, siteName) {
        const { doc, baseUrl, baseHost, title, links, commonPatterns, likelyStructure } = analysis;
        
        // 构建书源
        const bookSource = {
            bookSourceUrl: baseUrl,
            bookSourceName: siteName || title || baseHost,
            bookSourceType: 0,
            bookSourceGroup: "自动生成",
            loginUrl: null,
            ruleSearchUrl: this.buildSearchRule(commonPatterns, baseUrl),
            ruleSearchList: likelyStructure.searchListSelector || '',
            ruleSearchName: this.detectTextSelector(doc, 'h2 a, h3 a, .title a, .name a, .book-name a'),
            ruleSearchAuthor: this.detectTextSelector(doc, '.author, .writer, .info .author'),
            ruleSearchCoverUrl: this.detectImageSelector(doc, 'img.cover, img[src*="cover"], .book-img img, .pic img'),
            ruleSearchNoteUrl: '',
            ruleBookUrlPattern: likelyStructure.bookUrlPattern || '',
            ruleBookInfoInit: '',
            ruleBookName: this.detectTextSelector(doc, 'h1, .book-name, .novel-name, .info h1'),
            ruleBookAuthor: this.detectTextSelector(doc, '.author, .writer, .info .author'),
            ruleCoverUrl: this.detectImageSelector(doc, '.cover img, .book-cover img, .pic img'),
            ruleChapterUrl: this.detectChapterUrl(doc, baseUrl),
            ruleChapterList: this.detectChapterListSelector(doc),
            ruleChapterName: this.detectTextSelector(doc, 'a, .chapter-name, .title'),
            ruleContentUrl: this.detectContentUrl(doc, baseUrl),
            ruleContent: this.detectContentSelector(doc),
            ruleContentReplace: null,
            httpUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            weight: 0,
            customOrder: 0,
            enabled: true,
            enabledExplore: true,
            explore: [],
            searchable: 1,
            variable: null
        };

        // 清理空值
        for (const key in bookSource) {
            if (bookSource[key] === '' || bookSource[key] === null) {
                delete bookSource[key];
            }
        }

        return bookSource;
    }

    /**
     * 构建搜索规则
     */
    buildSearchRule(patterns, baseUrl) {
        if (patterns.searchInput) {
            const searchName = patterns.searchInput.name;
            if (searchName) {
                return baseUrl + (baseUrl.endsWith('/') ? '' : '/') + `search?${searchName}={{key}}`;
            }
        }
        return null;
    }

    /**
     * 检测文本选择器
     */
    detectTextSelector(doc, preferredSelectors) {
        const selectors = preferredSelectors.split(', ');
        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
                return selector;
            }
        }
        return '';
    }

    /**
     * 检测图片选择器
     */
    detectImageSelector(doc, preferredSelectors) {
        const selectors = preferredSelectors.split(', ');
        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
                return selector + '@src';
            }
        }
        return '';
    }

    /**
     * 检测章节URL规则
     */
    detectChapterUrl(doc, baseUrl) {
        const chapterLinks = doc.querySelectorAll('a[href*="chapter"], a[href*="read"], a[href*="content"]');
        if (chapterLinks.length > 0) {
            const href = chapterLinks[0].getAttribute('href');
            if (href) {
                try {
                    const fullUrl = new URL(href, baseUrl).href;
                    // 提取模式
                    return fullUrl.replace(/\d+/g, '{{id}}');
                } catch (e) {}
            }
        }
        return '';
    }

    /**
     * 检测章节列表选择器
     */
    detectChapterListSelector(doc) {
        const selectors = [
            '.chapter-list', '.chapterlist', '.catalog', '.directory',
            '#chapter-list', '#chapters', '.chapters', '.chapter-items',
            'ul.chapter', 'ol.chapter', '.list-chapter'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
                return selector;
            }
        }

        // 自动检测：查找包含最多链接的容器
        let bestContainer = null;
        let maxLinks = 0;

        const containers = doc.querySelectorAll('div, ul, ol, section');
        for (const container of containers) {
            const links = container.querySelectorAll('a');
            if (links.length > maxLinks && links.length >= 5) {
                maxLinks = links.length;
                bestContainer = container;
            }
        }

        if (bestContainer) {
            return this.generateSelector(bestContainer) + ' a';
        }

        return '';
    }

    /**
     * 检测内容页URL规则
     */
    detectContentUrl(doc, baseUrl) {
        const contentLinks = doc.querySelectorAll('a[href*="read"], a[href*="content"], a[href*="chapter"]');
        if (contentLinks.length > 0) {
            const href = contentLinks[0].getAttribute('href');
            if (href) {
                try {
                    const fullUrl = new URL(href, baseUrl).href;
                    return fullUrl.replace(/\d+/g, '{{id}}');
                } catch (e) {}
            }
        }
        return '';
    }

    /**
     * 检测内容选择器
     */
    detectContentSelector(doc) {
        const selectors = [
            '#content', '.content', '.read-content', '.chapter-content',
            '.text-content', '.article-content', '#chapter-content',
            '.novel-content', '.book-content', '#book-content'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
                return selector;
            }
        }

        // 检测可能的内容容器
        const possibleContent = doc.querySelectorAll('article, .post, .entry, .main-content');
        if (possibleContent.length > 0) {
            return this.generateSelector(possibleContent[0]);
        }

        return 'body';
    }

    /**
     * 主分析流程
     */
    async analyze(url, siteName) {
        if (!url) {
            throw new Error('请输入小说网站URL');
        }

        // 规范化URL
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        // 验证URL
        try {
            new URL(url);
        } catch (e) {
            throw new Error('请输入有效的URL地址');
        }

        // 获取网页内容
        const html = await this.fetchPage(url);
        if (!html || html.length < 50) {
            throw new Error('无法获取网页内容，请检查URL或网络连接');
        }

        // 分析HTML
        const analysis = this.analyzeHTML(html, url);

        // 生成书源
        const bookSource = this.generateBookSource(analysis, siteName);

        this.analysisResult = {
            url: url,
            siteName: siteName || analysis.title,
            analysis: analysis,
            bookSource: bookSource
        };

        return this.analysisResult;
    }

    /**
     * 导出书源JSON字符串
     */
    exportJSON() {
        if (!this.analysisResult) return null;
        return JSON.stringify(this.analysisResult.bookSource, null, 2);
    }

    /**
     * 导出为Legado导入格式（数组包裹）
     */
    exportLegadoFormat() {
        if (!this.analysisResult) return null;
        return JSON.stringify([this.analysisResult.bookSource], null, 2);
    }
}
