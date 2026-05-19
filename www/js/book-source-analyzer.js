/**
 * 书源分析引擎 - 智能检测网站结构并生成书源规则
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
        
        // 生成书源
        const bookSource = this.generateBookSource(url, name, doc, html);
        
        return {
            bookSource,
            detected: {
                title,
                name
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
     * 生成书源规则
     */
    generateBookSource(url, name, doc, html) {
        const bookSource = {
            bookSourceGroup: "自动生成",
            bookSourceName: name,
            bookSourceUrl: this.cleanUrl(url),
            bookSourceType: 0,
            bookSourceComment: "由书源生成器自动生成",
            header: JSON.stringify({
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            }),
            loginUrl: "",
            loginUi: "",
            loginCheckJs: "",
            bookUrlPattern: "",
            searchUrl: this.detectSearchUrl(url, doc),
            ruleSearchUrl: this.detectSearchUrl(url, doc),
            ruleSearchList: this.detectSearchList(doc),
            ruleSearchName: this.detectSearchName(doc),
            ruleSearchAuthor: this.detectSearchAuthor(doc),
            ruleSearchCoverUrl: this.detectSearchCover(doc),
            ruleSearchNoteUrl: "",
            ruleSearchKind: "",
            ruleSearchIntroduce: "",
            ruleBookName: this.detectBookName(doc),
            ruleBookAuthor: this.detectBookAuthor(doc),
            ruleCoverUrl: this.detectCover(doc),
            ruleBookKind: "",
            ruleBookIntroduce: this.detectIntroduce(doc),
            ruleChapterList: this.detectChapterList(doc),
            ruleChapterName: this.detectChapterName(doc),
            ruleChapterUrl: this.detectChapterUrl(doc),
            ruleContent: this.detectContent(doc),
            ruleContentUrl: "",
            ruleIntroduce: "",
            ruleContentReplace: null,
            ruleSearchFields: null,
            ruleBookInfoInit: "",
            ruleChapterListInit: "",
            ruleContentInit: "",
            ruleContentUpdate: "",
            httpUserAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            weight: 0
        };

        // 清理空值
        Object.keys(bookSource).forEach(key => {
            if (bookSource[key] === null || bookSource[key] === undefined || bookSource[key] === '') {
                delete bookSource[key];
            }
        });

        return bookSource;
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
     * 检测搜索URL
     */
    detectSearchUrl(url, doc) {
        // 查找搜索表单
        const forms = doc.querySelectorAll('form');
        for (const form of forms) {
            const action = form.getAttribute('action') || '';
            const inputs = form.querySelectorAll('input[type="text"], input[type="search"], input[name*="search"], input[name*="key"], input[name*="word"], input[name*="q"], input[name*="s"]');
            if (inputs.length > 0) {
                let searchUrl = action;
                if (!searchUrl.startsWith('http')) {
                    searchUrl = this.cleanUrl(url) + (searchUrl.startsWith('/') ? '' : '/') + searchUrl;
                }
                const input = inputs[0];
                const name = input.getAttribute('name') || 'searchkey';
                return searchUrl + (searchUrl.includes('?') ? '&' : '?') + name + '={{key}}';
            }
        }

        // 查找搜索链接
        const searchLinks = doc.querySelectorAll('a[href*="search"], a[href*="s?key"], a[href*="so?key"]');
        for (const link of searchLinks) {
            const href = link.getAttribute('href') || '';
            if (href.includes('key=') || href.includes('word=') || href.includes('q=') || href.includes('s=')) {
                return this.cleanUrl(url) + '/' + href.replace(/^\//, '').replace(/key=[^&]*/, 'key={{key}}').replace(/word=[^&]*/, 'word={{key}}').replace(/q=[^&]*/, 'q={{key}}').replace(/s=[^&]*/, 's={{key}}');
            }
        }

        // 常见搜索URL模式
        const baseUrl = this.cleanUrl(url);
        const patterns = [
            `${baseUrl}/search?keyword={{key}}`,
            `${baseUrl}/search?key={{key}}`,
            `${baseUrl}/search?q={{key}}`,
            `${baseUrl}/search?w={{key}}`,
            `${baseUrl}/search?searchkey={{key}}`,
            `${baseUrl}/search.html?keyword={{key}}`,
            `${baseUrl}/s?q={{key}}`,
            `${baseUrl}/s?wd={{key}}`,
            `${baseUrl}/s?key={{key}}`,
            `${baseUrl}/so?key={{key}}`,
            `${baseUrl}/so?keyword={{key}}`,
            `${baseUrl}/book/search?keyword={{key}}`,
            `${baseUrl}/modules/article/search.php?searchkey={{key}}`,
            `${baseUrl}/modules/article/search.php?key={{key}}`
        ];

        // 返回第一个匹配的常见模式
        return patterns[0];
    }

    /**
     * 检测搜索列表选择器
     */
    detectSearchList(doc) {
        const selectors = [
            // 通用列表
            '.search-list', '.search_result', '.result-list', '.book-list',
            '.list', '.booklist', '.book_list', '.books-list',
            'ul.list', 'ul.book-list', 'ul.books-list',
            'table.list', 'table.grid',
            // 小说网站常见
            '#list', '#booklist', '#search-list', '#search_result',
            '.novelslist', '.novels-list', '.novels_list',
            '.s-list', '.s_result', '.so-list',
            // 通用
            'ul li', 'table tr', '.item', '.result-item',
            // 最通用
            'ul', 'table'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测搜索书名选择器
     */
    detectSearchName(doc) {
        const selectors = [
            'h3 a', 'h4 a', 'h2 a',
            '.bookname a', '.book-name a', '.name a',
            '.title a', '.book_title a',
            'a[title]', 'a[href*="book"]',
            'td:first-child a', 'td a',
            'li a', 'a'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测搜索作者选择器
     */
    detectSearchAuthor(doc) {
        const selectors = [
            '.author', '.bookauthor', '.book-author',
            'td.author', 'td:nth-child(2)',
            '.info .author', '.book-info .author',
            'span.author', 'p.author',
            '.byline', '.writer',
            'td:nth-child(3)', 'td:nth-child(4)'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测搜索封面选择器
     */
    detectSearchCover(doc) {
        const selectors = [
            'img.cover', 'img.bookcover', 'img.book-cover',
            '.cover img', '.bookcover img', '.book-cover img',
            'td img', 'li img', '.item img',
            'img[src*="cover"]', 'img[src*="book"]',
            'img:first-child'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector + '@src';
            }
        }

        return '';
    }

    /**
     * 检测书名选择器
     */
    detectBookName(doc) {
        const selectors = [
            // 常见书名位置
            '.bookname', '.book-name', '.book_name',
            '.booktitle', '.book-title', '.book_title',
            '.name', '.title', '.bookInfo .name',
            '.book-info .name', '.bookInfo .title',
            'h1', 'h2.bookname', 'h1.bookname',
            '.detail h1', '.detail h2',
            // 通用
            'h1:first-of-type', 'h2:first-of-type',
            '.info h1', '.info h2',
            'meta[property="og:novel:book_name"]',
            'meta[property="og:title"]'
        ];

        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element) {
                if (selector.startsWith('meta')) {
                    return selector + '@content';
                }
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测作者选择器
     */
    detectBookAuthor(doc) {
        const selectors = [
            '.author', '.bookauthor', '.book-author',
            '.writer', '.byline',
            '.info .author', '.book-info .author',
            '.detail .author', '.bookInfo .author',
            'span.author', 'p.author',
            '.info span:contains(作者)',
            'meta[property="og:novel:author"]',
            'meta[property="book:author"]'
        ];

        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element) {
                if (selector.startsWith('meta')) {
                    return selector + '@content';
                }
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测封面选择器
     */
    detectCover(doc) {
        const selectors = [
            '.cover img', '.bookcover img', '.book-cover img',
            '.bookimg img', '.book-img img', '.pic img',
            '.detail .cover img', '.bookInfo .cover img',
            'img.cover', 'img.bookcover',
            'meta[property="og:image"]',
            'link[rel="image_src"]'
        ];

        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element) {
                if (selector.startsWith('meta')) {
                    return selector + '@content';
                }
                if (selector.startsWith('link')) {
                    return selector + '@href';
                }
                return selector + '@src';
            }
        }

        return '';
    }

    /**
     * 检测简介选择器
     */
    detectIntroduce(doc) {
        const selectors = [
            '.intro', '.introduce', '.description',
            '.desc', '.bookdesc', '.book-desc',
            '.summary', '.book-summary',
            '.info .intro', '.book-info .intro',
            '.detail .intro', '.bookInfo .intro',
            '#intro', '#description',
            'meta[property="og:description"]',
            'meta[name="description"]'
        ];

        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element) {
                if (selector.startsWith('meta')) {
                    return selector + '@content';
                }
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测章节列表选择器
     */
    detectChapterList(doc) {
        const selectors = [
            '#list', '.list', '.chapter-list', '.chapters',
            '.chapterlist', '.chapter_list', '.catalog',
            '.directory', '.index', '.book-list',
            '#chapters', '#chapter-list', '#catalog',
            'ul.chapter', 'ul.chapters', 'ul.list',
            '.book .list', '.book-list ul',
            // 通用
            'ul', 'ol', 'table',
            'div[class*="list"]', 'div[class*="chapter"]',
            'div[id*="list"]', 'div[id*="chapter"]'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector + ' li';
            }
        }

        return '';
    }

    /**
     * 检测章节名称选择器
     */
    detectChapterName(doc) {
        const selectors = [
            'li a', 'li span', 'td a',
            'a[href*="html"]', 'a[href*="chapter"]',
            'a[href*="/"]', 'a'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector;
            }
        }

        return '';
    }

    /**
     * 检测章节URL选择器
     */
    detectChapterUrl(doc) {
        const selectors = [
            'li a', 'td a',
            'a[href*="html"]', 'a[href*="chapter"]',
            'a[href*="/"]', 'a'
        ];

        for (const selector of selectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length >= 2) {
                return selector + '@href';
            }
        }

        return '';
    }

    /**
     * 检测内容选择器
     */
    detectContent(doc) {
        const selectors = [
            '#content', '.content', '.bookcontent', '.book-content',
            '.text', '.article', '.chapter-content',
            '#bookcontent', '#chaptercontent', '#textcontent',
            '.read-content', '.novel-content', '.txt',
            'article', 'main',
            'div[class*="content"]', 'div[id*="content"]',
            'div[class*="text"]', 'div[id*="text"]',
            'div[class*="chapter"]', 'div[id*="chapter"]',
            'p'
        ];

        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element) {
                return selector;
            }
        }

        return '';
    }
}
