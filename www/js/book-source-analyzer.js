/**
 * 书源分析引擎 - 自动分析小说网站结构并生成 Legado 3.0 书源
 * v2.0 - 改进版：更智能的规则检测
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
        const methods = [
            () => this.fetchWithCorsProxy(url),
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
                    
                    if (this.isLikelyNovelLink(fullUrl, text)) {
                        links.likelyNovel.push(linkInfo);
                    }
                    
                    if (this.isLikelyChapterLink(fullUrl, text)) {
                        links.likelyChapter.push(linkInfo);
                    }
                } else {
                    links.external.push(linkInfo);
                }
            } catch (e) {}
        });

        return links;
    }

    /**
     * 检测是否可能是小说链接
     */
    isLikelyNovelLink(url, text) {
        const urlLower = url.toLowerCase();
        const textLower = text.toLowerCase();

        const urlPatterns = [
            /\/book\//i, /\/novel\//i, /\/info\//i, /\/detail\//i,
            /\/read\//i, /\/story\//i, /bookinfo/i, /novelinfo/i,
            /\/(\d+)\.html$/, /id=\d+/i, /bookid=/i
        ];

        for (const pattern of urlPatterns) {
            if (pattern.test(urlLower)) return true;
        }

        const textPatterns = ['章', '节', '卷', '篇', '部', '集'];
        for (const keyword of textPatterns) {
            if (textLower.includes(keyword)) return true;
        }

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

        // 检测搜索框 - 更全面的检测
        const searchSelectors = [
            'input[type="text"]', 'input[type="search"]',
            'input[name*="search"]', 'input[id*="search"]', 'input[class*="search"]',
            'input[name*="key"]', 'input[id*="key"]', 'input[class*="key"]',
            'input[name*="keyword"]', 'input[id*="keyword"]',
            'input[name*="wd"]', 'input[name*="word"]',
            'input[name*="q"]', 'input[name*="query"]',
            'input[name*="s"]', 'input[name*="so"]'
        ];
        
        const searchInputs = doc.querySelectorAll(searchSelectors.join(','));
        patterns.hasSearch = searchInputs.length > 0;
        if (searchInputs.length > 0) {
            const input = searchInputs[0];
            patterns.searchInput = {
                selector: this.generateSelector(input),
                name: input.getAttribute('name') || input.getAttribute('id') || 'searchkey'
            };
        }

        // 检测搜索按钮
        const searchBtns = doc.querySelectorAll('button[type="submit"], input[type="submit"]');
        patterns.hasSearchButton = searchBtns.length > 0;

        // 检测列表结构
        const listSelectors = [
            '.book-list', '.novel-list', '.list', '.booklist', '.novellist',
            'ul.list', 'ol.list', '.items', '.book-items',
            '.recommend-list', '.hot-list', '.update-list', '.rank-list',
            '.result-list', '.search-list', '.search-result'
        ];
        const lists = doc.querySelectorAll(listSelectors.join(','));
        patterns.hasList = lists.length > 0;

        // 检测分页
        const paginations = doc.querySelectorAll('.pagination, .page, .pages, #pages, .pager, .page-nav');
        patterns.hasPagination = paginations.length > 0;

        // 检测可能的小说列表容器
        const possibleContainers = doc.querySelectorAll('.book, .novel, .item, .card, .post, .article, li, tr');
        patterns.containerCount = possibleContainers.length;

        // 检测图片
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

        if (this.isNovelSite(doc, html)) {
            structure.type = 'novel-site';
            structure.confidence = 0.7;
            structure.searchUrl = this.detectSearchUrl(doc, baseUrl);
            structure.searchListSelector = this.detectListSelector(doc);
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
     * 检测搜索URL - 改进版
     */
    detectSearchUrl(doc, baseUrl) {
        // 查找搜索表单
        const forms = doc.querySelectorAll('form');
        for (const form of forms) {
            const action = form.getAttribute('action');
            const hasSearchInput = form.querySelector('input[type="text"], input[type="search"], input[name*="search"], input[id*="search"], input[name*="key"], input[name*="wd"], input[name*="keyword"]');
            
            if (hasSearchInput) {
                let searchUrl = action || '';
                if (searchUrl && !searchUrl.startsWith('http')) {
                    try {
                        searchUrl = new URL(searchUrl, baseUrl).href;
                    } catch(e) {
                        searchUrl = baseUrl + (searchUrl.startsWith('/') ? '' : '/') + searchUrl;
                    }
                }
                const inputName = hasSearchInput.getAttribute('name') || hasSearchInput.getAttribute('id') || 'searchkey';
                return (searchUrl || baseUrl) + (searchUrl && searchUrl.includes('?') ? '&' : '?') + inputName + '={{key}}';
            }
        }

        // 查找搜索链接
        const searchLinks = doc.querySelectorAll('a[href*="search"], a[href*="so"], a[href*="find"], a[href*="query"], a[href*="sousuo"]');
        if (searchLinks.length > 0) {
            const href = searchLinks[0].getAttribute('href');
            try {
                const fullUrl = new URL(href, baseUrl).href;
                return fullUrl + (fullUrl.includes('?') ? '&' : '?') + 'searchkey={{key}}';
            } catch(e) {}
        }

        // 默认搜索URL模式
        return baseUrl + (baseUrl.endsWith('/') ? '' : '/') + 'search?searchkey={{key}}';
    }

    /**
     * 检测列表选择器 - 改进版
     */
    detectListSelector(doc) {
        const selectors = [
            '.book-list', '.novel-list', '.list', '.booklist', '.novellist',
            'ul.list', 'ol.list', '.items', '.book-items',
            '.recommend-list', '.hot-list', '.update-list', '.rank-list',
            '.result-list', '.search-list', '.search-result',
            'table:has(a)', 'ul:has(a)'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0 && elements.length < 50) {
                return selector;
            }
        }

        // 自动检测：查找包含多个链接的容器
        const containers = doc.querySelectorAll('ul, ol, .list, .items, .content, .main, .section, .box');
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

            const normalized = href.replace(/\d+/g, '{id}');
            patterns.set(normalized, (patterns.get(normalized) || 0) + 1);
        }

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
     * 智能检测文本选择器 - 改进版
     */
    smartDetectSelector(doc, selectors, minElements = 1) {
        for (const selector of selectors) {
            try {
                const elements = doc.querySelectorAll(selector);
                if (elements.length >= minElements) {
                    return selector;
                }
            } catch(e) {}
        }
        return null;
    }

    /**
     * 生成Legado 3.0书源JSON - 改进版
     */
    generateBookSource(analysis, siteName) {
        const { doc, baseUrl, baseHost, title, links, commonPatterns, likelyStructure } = analysis;
        
        // 智能检测各个规则
        const searchUrl = this.detectSearchUrl(doc, baseUrl);
        const searchList = this.detectListSelector(doc);
        
        // 检测搜索列表中的书名选择器
        const searchNameSelectors = [
            'h2 a', 'h3 a', '.title a', '.name a', '.book-name a',
            '.book-title a', '.novel-title a', '.s2 a', '.bookname a',
            'a.bookname', 'a.title', '.info a', '.text a',
            'li a', '.item a', 'td a', '.result-item a'
        ];
        const searchName = this.smartDetectSelector(doc, searchNameSelectors);
        
        // 检测搜索列表中的作者选择器
        const searchAuthorSelectors = [
            '.author', '.writer', '.info .author', '.book-author',
            '.novel-author', '.s3', '.author a', '.by',
            '.info span', '.book-info span', '.text .author'
        ];
        const searchAuthor = this.smartDetectSelector(doc, searchAuthorSelectors);
        
        // 检测搜索封面
        const searchCoverSelectors = [
            'img.cover', 'img[src*="cover"]', '.book-img img', '.pic img',
            '.cover img', '.book-cover img', 'img[src*="book"]',
            '.img img', '.image img', 'img.thumbnail'
        ];
        const searchCover = this.smartDetectSelector(doc, searchCoverSelectors);
        
        // 检测书名选择器
        const bookNameSelectors = [
            'h1', '.book-name', '.novel-name', '.info h1',
            '.book-title', '.novel-title', '.name h1',
            '.title h1', '.bookinfo h1', '.detail h1',
            'h1.title', 'h1.name', '.content h1'
        ];
        const bookName = this.smartDetectSelector(doc, bookNameSelectors);
        
        // 检测作者选择器
        const bookAuthorSelectors = [
            '.author', '.writer', '.info .author', '.book-author',
            '.novel-author', '.by', '.info span:first-child',
            '.bookinfo .author', '.detail .author',
            'span.author', 'p.author', '.info p'
        ];
        const bookAuthor = this.smartDetectSelector(doc, bookAuthorSelectors);
        
        // 检测封面选择器
        const coverSelectors = [
            '.cover img', '.book-cover img', '.pic img',
            '.book-img img', '.img img', '.image img',
            '#cover img', '.bookinfo img', '.detail img',
            'img.cover', 'img[src*="cover"]'
        ];
        const coverUrl = this.smartDetectSelector(doc, coverSelectors);
        
        // 检测章节列表选择器
        const chapterListSelectors = [
            '.chapter-list', '.chapterlist', '.catalog', '.directory',
            '#chapter-list', '#chapters', '.chapters', '.chapter-items',
            'ul.chapter', 'ol.chapter', '.list-chapter',
            '.chapter', '.chapter-list a', '.catalog a',
            '#list', '.list', '.book-list', '.novel-list',
            '.chapterlist a', '.chapter-list a',
            'ul a', 'ol a', '.list a'
        ];
        const chapterList = this.smartDetectSelector(doc, chapterListSelectors);
        
        // 检测章节名称选择器
        const chapterNameSelectors = [
            'a', '.chapter-name', '.title', '.chapter-title',
            '.catalog a', '.chapter a', 'li a'
        ];
        const chapterName = this.smartDetectSelector(doc, chapterNameSelectors);
        
        // 检测内容选择器
        const contentSelectors = [
            '#content', '.content', '.read-content', '.chapter-content',
            '.text-content', '.article-content', '#chapter-content',
            '.novel-content', '.book-content', '#book-content',
            '.txt', '.read', '.chapter-text', '.text',
            '#chaptercontent', '#chaptercontent', '.chaptercontent',
            '#contenttext', '.contenttext', '.readtext',
            'article', '.post', '.entry', '.main-content'
        ];
        const content = this.smartDetectSelector(doc, contentSelectors);
        
        // 构建书源
        const bookSource = {
            bookSourceUrl: baseUrl,
            bookSourceName: siteName || title || baseHost,
            bookSourceType: 0,
            bookSourceGroup: "自动生成",
            loginUrl: null,
            ruleSearchUrl: searchUrl || null,
            ruleSearchList: searchList || null,
            ruleSearchName: searchName || null,
            ruleSearchAuthor: searchAuthor || null,
            ruleSearchCoverUrl: searchCover ? searchCover + '@src' : null,
            ruleSearchNoteUrl: null,
            ruleBookUrlPattern: likelyStructure.bookUrlPattern || null,
            ruleBookInfoInit: null,
            ruleBookName: bookName || null,
            ruleBookAuthor: bookAuthor || null,
            ruleCoverUrl: coverUrl ? coverUrl + '@src' : null,
            ruleChapterUrl: null,
            ruleChapterList: chapterList || null,
            ruleChapterName: chapterName || null,
            ruleContentUrl: null,
            ruleContent: content || null,
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
