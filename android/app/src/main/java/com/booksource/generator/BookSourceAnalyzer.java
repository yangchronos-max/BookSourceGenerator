package com.booksource.generator;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;

/**
 * 书源分析引擎 v2.0 - 智能分析
 * 
 * 核心改进：不仅分析首页，还会模拟搜索请求，分析搜索结果页的HTML结构
 * 从而生成真正匹配的搜索规则
 */
public class BookSourceAnalyzer {

    private static final int TIMEOUT = 15000;
    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    public JSONObject analyze(String url, String siteName) throws Exception {
        Document doc = fetchPage(url);
        String title = doc.title();
        String name = (siteName != null && !siteName.isEmpty()) ? siteName : extractSiteName(url, title);

        JSONObject bookSource = generateBookSource(url, name, doc);

        JSONObject result = new JSONObject();
        result.put("bookSource", bookSource);
        JSONObject detected = new JSONObject();
        detected.put("title", title);
        detected.put("name", name);
        result.put("detected", detected);

        return result;
    }

    private Document fetchPage(String url) throws IOException {
        return Jsoup.connect(url)
                .userAgent(USER_AGENT)
                .timeout(TIMEOUT)
                .followRedirects(true)
                .ignoreContentType(true)
                .get();
    }

    private String extractSiteName(String url, String title) {
        if (title != null && !title.isEmpty()) {
            String clean = title.replaceAll("[-_|].*$", "").trim();
            if (clean.length() > 0 && clean.length() < 50) return clean;
        }
        try {
            String hostname = new java.net.URL(url).getHost();
            String parts = hostname.replace("www.", "");
            if (parts.contains(".")) {
                parts = parts.substring(0, parts.indexOf("."));
            }
            return parts.substring(0, 1).toUpperCase() + parts.substring(1);
        } catch (Exception e) {
            return "未知网站";
        }
    }

    private String cleanUrl(String url) {
        try {
            java.net.URL u = new java.net.URL(url);
            return u.getProtocol() + "://" + u.getHost();
        } catch (Exception e) {
            return url;
        }
    }

    /**
     * 生成书源 - 核心方法
     */
    private JSONObject generateBookSource(String url, String name, Document doc) throws IOException {
        JSONObject bookSource = new JSONObject();
        String baseUrl = cleanUrl(url);

        // 基础信息
        bookSource.put("bookSourceGroup", "自动生成");
        bookSource.put("bookSourceName", name);
        bookSource.put("bookSourceUrl", baseUrl);
        bookSource.put("bookSourceType", 0);
        bookSource.put("bookSourceComment", "由书源生成器自动生成");
        bookSource.put("enabled", true);
        bookSource.put("enabledExplore", true);
        bookSource.put("enabledCookieJar", true);
        bookSource.put("concurrentRate", "1");

        // ========== 1. 检测搜索URL ==========
        String searchUrl = detectSearchUrl(url, doc);
        bookSource.put("searchUrl", searchUrl);

        // ========== 2. 模拟搜索请求，分析搜索结果页 ==========
        // 使用"我"作为测试关键词（几乎所有小说网站都有"我"字的小说）
        String testKeyword = "我";
        String testSearchUrl = searchUrl.replace("{{key}}", URLEncoder.encode(testKeyword, "UTF-8"));
        
        JSONObject searchRules = new JSONObject();
        JSONObject bookInfoRules = new JSONObject();
        JSONObject tocRules = new JSONObject();
        JSONObject contentRules = new JSONObject();

        try {
            Log.d("BookSourceAnalyzer", "正在模拟搜索: " + testSearchUrl);
            Document searchDoc = fetchPage(testSearchUrl);
            String searchHtml = searchDoc.html();
            
            // 分析搜索结果页结构
            analyzeSearchPage(searchDoc, searchRules, bookInfoRules);
            
            // 如果搜索结果中有书籍，点击第一本分析详情页
            String firstBookUrl = findFirstBookUrl(searchDoc, baseUrl);
            if (firstBookUrl != null && !firstBookUrl.isEmpty()) {
                Log.d("BookSourceAnalyzer", "正在分析详情页: " + firstBookUrl);
                Document bookDoc = fetchPage(firstBookUrl);
                analyzeBookPage(bookDoc, bookInfoRules, tocRules, contentRules);
            }
        } catch (Exception e) {
            Log.d("BookSourceAnalyzer", "搜索模拟失败，使用首页分析: " + e.getMessage());
            // 如果搜索失败，回退到首页分析
            analyzeHomePage(doc, searchRules, bookInfoRules, tocRules, contentRules);
        }

        // 设置规则
        if (searchRules.length() > 0) bookSource.put("ruleSearch", searchRules);
        if (bookInfoRules.length() > 0) bookSource.put("ruleBookInfo", bookInfoRules);
        if (tocRules.length() > 0) bookSource.put("ruleToc", tocRules);
        if (contentRules.length() > 0) bookSource.put("ruleContent", contentRules);

        return bookSource;
    }

    /**
     * 分析搜索结果页 - 智能检测列表容器和字段
     */
    private void analyzeSearchPage(Document doc, JSONObject searchRules, JSONObject bookInfoRules) {
        // 查找所有可能的列表容器
        Map<String, Integer> containerCandidates = new HashMap<>();
        
        // 检测ul/ol列表
        Elements lists = doc.select("ul, ol, table, div[class]");
        for (Element list : lists) {
            int childCount = list.children().size();
            if (childCount >= 3 && childCount <= 100) {
                String selector = buildSelector(list);
                containerCandidates.put(selector, childCount);
            }
        }

        // 选择包含最多子元素的容器
        String bestContainer = "";
        int maxChildren = 0;
        for (Map.Entry<String, Integer> entry : containerCandidates.entrySet()) {
            if (entry.getValue() > maxChildren) {
                maxChildren = entry.getValue();
                bestContainer = entry.getKey();
            }
        }

        if (!bestContainer.isEmpty()) {
            String itemSelector = bestContainer + " > li, " + bestContainer + " > tr, " + bestContainer + " > div";
            Elements items = doc.select(itemSelector);
            
            if (items.size() >= 2) {
                searchRules.put("bookList", itemSelector);
                
                // 分析第一个项目，检测各个字段
                Element firstItem = items.first();
                if (firstItem != null) {
                    // 检测书名（找链接）
                    Element nameLink = firstItem.select("a").first();
                    if (nameLink != null) {
                        String nameSelector = itemSelector + " a";
                        searchRules.put("name", nameSelector);
                        searchRules.put("bookUrl", nameSelector + "@href");
                    }
                    
                    // 检测作者
                    Element author = firstItem.select(".author, [class*=author], [class*=writer], td:nth-child(2), td:nth-child(3)").first();
                    if (author != null) {
                        searchRules.put("author", itemSelector + " .author, " + itemSelector + " [class*=author]");
                    }
                    
                    // 检测封面
                    Element cover = firstItem.select("img").first();
                    if (cover != null) {
                        searchRules.put("coverUrl", itemSelector + " img@src");
                    }
                }
            }
        }

        // 如果上面的检测失败，使用通用规则
        if (!searchRules.has("bookList")) {
            searchRules.put("bookList", "li, tr, .item, .book-item, .result-item");
        }
        if (!searchRules.has("name")) {
            searchRules.put("name", "a");
        }
        if (!searchRules.has("bookUrl")) {
            searchRules.put("bookUrl", "a@href");
        }
    }

    /**
     * 分析书籍详情页
     */
    private void analyzeBookPage(Document doc, JSONObject bookInfoRules, JSONObject tocRules, JSONObject contentRules) {
        // 书名
        Element metaName = doc.selectFirst("meta[property=og:novel:book_name], meta[property=og:title]");
        if (metaName != null) {
            bookInfoRules.put("name", "meta[property=\"" + metaName.attr("property") + "\"]@content");
        } else {
            Element h1 = doc.selectFirst("h1");
            if (h1 != null) bookInfoRules.put("name", "h1");
        }

        // 作者
        Element metaAuthor = doc.selectFirst("meta[property=og:novel:author]");
        if (metaAuthor != null) {
            bookInfoRules.put("author", "meta[property=\"og:novel:author\"]@content");
        } else {
            Element author = doc.selectFirst(".author, [class*=author]");
            if (author != null) bookInfoRules.put("author", ".author");
        }

        // 封面
        Element metaCover = doc.selectFirst("meta[property=og:image]");
        if (metaCover != null) {
            bookInfoRules.put("coverUrl", "meta[property=\"og:image\"]@content");
        }

        // 简介
        Element metaDesc = doc.selectFirst("meta[property=og:description]");
        if (metaDesc != null) {
            bookInfoRules.put("intro", "meta[property=\"og:description\"]@content");
        } else {
            Element intro = doc.selectFirst(".intro, .desc, .description, #intro, #description");
            if (intro != null) bookInfoRules.put("intro", ".intro, .desc, .description");
        }

        // 分类
        Element metaKind = doc.selectFirst("meta[property=og:novel:category]");
        if (metaKind != null) {
            bookInfoRules.put("kind", "meta[property=\"og:novel:category\"]@content");
        }

        // 最新章节
        Element metaLast = doc.selectFirst("meta[property=og:novel:latest_chapter_name]");
        if (metaLast != null) {
            bookInfoRules.put("lastChapter", "meta[property=\"og:novel:latest_chapter_name\"]@content");
        }

        // 目录链接
        Element tocLink = doc.selectFirst("a:contains(目录), a:contains(章节目录), a:contains(全部章节), a[href*=chapter], a[href*=catalog]");
        if (tocLink != null) {
            String tocHref = tocLink.attr("href");
            if (!tocHref.isEmpty()) {
                bookInfoRules.put("tocUrl", "a:contains(" + tocLink.text().trim() + ")@href");
            }
        }

        // 分析目录页
        String tocUrl = null;
        if (tocLink != null) {
            tocUrl = tocLink.attr("href");
            if (!tocUrl.startsWith("http")) {
                String base = cleanUrl(doc.location());
                tocUrl = base + (tocUrl.startsWith("/") ? "" : "/") + tocUrl;
            }
        }

        // 如果当前页面就是目录页，或者有目录链接，分析目录
        Document tocDoc = null;
        if (tocUrl != null && !tocUrl.equals(doc.location())) {
            try {
                tocDoc = fetchPage(tocUrl);
            } catch (Exception e) {
                tocDoc = doc;
            }
        } else {
            tocDoc = doc;
        }

        if (tocDoc != null) {
            analyzeTocPage(tocDoc, tocRules);
        }

        // 分析内容页
        analyzeContentPage(doc, contentRules);
    }

    /**
     * 分析目录页
     */
    private void analyzeTocPage(Document doc, JSONObject tocRules) {
        // 找章节列表
        String[] listSelectors = {
            "#list", ".list", ".chapter-list", ".chapters", ".chapterlist",
            "#chapters", "#chapter-list", "#catalog", ".catalog",
            "ul.chapter", "ul.chapters", "ul.list"
        };

        for (String selector : listSelectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                tocRules.put("chapterList", selector + " li");
                tocRules.put("chapterName", "a");
                tocRules.put("chapterUrl", "a@href");
                return;
            }
        }

        // 通用检测：找包含最多链接的ul
        Elements uls = doc.select("ul");
        Element bestUl = null;
        int maxLinks = 0;
        for (Element ul : uls) {
            int links = ul.select("a[href]").size();
            if (links > maxLinks) {
                maxLinks = links;
                bestUl = ul;
            }
        }
        if (bestUl != null && maxLinks >= 3) {
            String id = bestUl.id();
            String cls = bestUl.className();
            if (!id.isEmpty()) {
                tocRules.put("chapterList", "#" + id + " li");
            } else if (!cls.isEmpty()) {
                tocRules.put("chapterList", "." + cls.replace(" ", ".") + " li");
            } else {
                tocRules.put("chapterList", "ul li");
            }
            tocRules.put("chapterName", "a");
            tocRules.put("chapterUrl", "a@href");
        }
    }

    /**
     * 分析内容页
     */
    private void analyzeContentPage(Document doc, JSONObject contentRules) {
        String[] contentSelectors = {
            "#content", ".content", ".bookcontent", ".chapter-content",
            "#bookcontent", "#chaptercontent", "#textcontent",
            ".read-content", ".novel-content", ".txt",
            "article", "main"
        };

        for (String selector : contentSelectors) {
            Element element = doc.selectFirst(selector);
            if (element != null && element.text().length() > 100) {
                contentRules.put("content", selector);
                return;
            }
        }

        // 找包含最多文本的div
        Element bestContent = null;
        int maxText = 0;
        Elements divs = doc.select("div");
        for (Element div : divs) {
            int textLen = div.text().length();
            if (textLen > maxText && textLen > 200) {
                maxText = textLen;
                bestContent = div;
            }
        }
        if (bestContent != null) {
            String id = bestContent.id();
            String cls = bestContent.className();
            if (!id.isEmpty()) {
                contentRules.put("content", "#" + id);
            } else if (!cls.isEmpty()) {
                contentRules.put("content", "." + cls.replace(" ", "."));
            }
        }
    }

    /**
     * 从搜索结果中找到第一本书的详情页URL
     */
    private String findFirstBookUrl(Document doc, String baseUrl) {
        // 找第一个有href的链接
        Elements links = doc.select("a[href]");
        for (Element link : links) {
            String href = link.attr("href");
            String text = link.text().trim();
            if (!href.isEmpty() && !href.startsWith("#") && !href.startsWith("javascript") && text.length() > 1) {
                if (!href.startsWith("http")) {
                    href = baseUrl + (href.startsWith("/") ? "" : "/") + href;
                }
                return href;
            }
        }
        return null;
    }

    /**
     * 回退方案：从首页分析
     */
    private void analyzeHomePage(Document doc, JSONObject searchRules, JSONObject bookInfoRules, 
                                  JSONObject tocRules, JSONObject contentRules) {
        // 搜索规则 - 通用默认值
        searchRules.put("bookList", "li, tr, .item, .book-item, .result-item");
        searchRules.put("name", "a");
        searchRules.put("bookUrl", "a@href");

        // 书籍信息 - 从meta标签获取
        Element metaName = doc.selectFirst("meta[property=og:novel:book_name], meta[property=og:title]");
        if (metaName != null) {
            bookInfoRules.put("name", "meta[property=\"" + metaName.attr("property") + "\"]@content");
        }
        Element metaAuthor = doc.selectFirst("meta[property=og:novel:author]");
        if (metaAuthor != null) {
            bookInfoRules.put("author", "meta[property=\"og:novel:author\"]@content");
        }
        Element metaCover = doc.selectFirst("meta[property=og:image]");
        if (metaCover != null) {
            bookInfoRules.put("coverUrl", "meta[property=\"og:image\"]@content");
        }
        Element metaDesc = doc.selectFirst("meta[property=og:description]");
        if (metaDesc != null) {
            bookInfoRules.put("intro", "meta[property=\"og:description\"]@content");
        }

        // 目录规则
        analyzeTocPage(doc, tocRules);

        // 内容规则
        analyzeContentPage(doc, contentRules);
    }

    /**
     * 构建元素的选择器
     */
    private String buildSelector(Element element) {
        String tag = element.tagName();
        String id = element.id();
        String cls = element.className();
        
        if (!id.isEmpty()) {
            return "#" + id;
        }
        if (!cls.isEmpty()) {
            return tag + "." + cls.trim().replaceAll("\\s+", ".");
        }
        return tag;
    }

    /**
     * 检测搜索URL
     */
    private String detectSearchUrl(String url, Document doc) {
        // 查找搜索表单
        Elements forms = doc.select("form");
        for (Element form : forms) {
            String action = form.attr("action");
            Elements inputs = form.select("input[type=text], input[type=search], " +
                    "input[name*=search], input[name*=key], input[name*=word], input[name*=q], input[name*=s], " +
                    "input[name*=kw], input[name*=wd]");
            if (!inputs.isEmpty()) {
                String searchUrl = action;
                if (!searchUrl.startsWith("http")) {
                    String base = cleanUrl(url);
                    searchUrl = base + (searchUrl.startsWith("/") ? "" : "/") + searchUrl;
                }
                String name = inputs.first().attr("name");
                if (name.isEmpty()) name = "searchkey";
                return searchUrl + (searchUrl.contains("?") ? "&" : "?") + name + "={{key}}";
            }
        }

        // 查找搜索链接
        Elements searchLinks = doc.select("a[href*=search], a[href*=so], a[href*=s?]");
        for (Element link : searchLinks) {
            String href = link.attr("href");
            if (href.contains("key=") || href.contains("word=") || href.contains("q=") || 
                href.contains("s=") || href.contains("kw=") || href.contains("wd=") || href.contains("search=")) {
                String base = cleanUrl(url);
                href = href.replaceAll("key=[^&]*", "key={{key}}")
                        .replaceAll("word=[^&]*", "word={{key}}")
                        .replaceAll("q=[^&]*", "q={{key}}")
                        .replaceAll("s=[^&]*", "s={{key}}")
                        .replaceAll("kw=[^&]*", "kw={{key}}")
                        .replaceAll("wd=[^&]*", "wd={{key}}")
                        .replaceAll("search=[^&]*", "search={{key}}");
                if (!href.startsWith("http")) {
                    return base + "/" + href.replaceAll("^/", "");
                }
                return href;
            }
        }

        // 默认搜索URL
        return cleanUrl(url) + "/search?keyword={{key}}";
    }

    // 简单的日志类
    private static class Log {
        static void d(String tag, String msg) {
            System.out.println(tag + ": " + msg);
        }
    }
}
