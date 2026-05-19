package com.booksource.generator;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 书源分析引擎 - Android原生实现
 * 使用Jsoup解析HTML，智能检测网站结构并生成书源规则
 */
public class BookSourceAnalyzer {

    private static final int TIMEOUT = 15000;
    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    /**
     * 分析网站并生成书源
     */
    public JSONObject analyze(String url, String siteName) throws Exception {
        // 1. 获取网页内容
        Document doc = fetchPage(url);
        String html = doc.html();

        // 2. 提取网站信息
        String title = doc.title();
        String name = (siteName != null && !siteName.isEmpty()) ? siteName : extractSiteName(url, title);

        // 3. 生成书源
        JSONObject bookSource = generateBookSource(url, name, doc, html);

        // 4. 返回结果
        JSONObject result = new JSONObject();
        result.put("bookSource", bookSource);
        JSONObject detected = new JSONObject();
        detected.put("title", title);
        detected.put("name", name);
        result.put("detected", detected);

        return result;
    }

    /**
     * 获取网页内容
     */
    private Document fetchPage(String url) throws IOException {
        return Jsoup.connect(url)
                .userAgent(USER_AGENT)
                .timeout(TIMEOUT)
                .followRedirects(true)
                .ignoreContentType(true)
                .get();
    }

    /**
     * 提取网站名称
     */
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

    /**
     * 清理URL
     */
    private String cleanUrl(String url) {
        try {
            java.net.URL u = new java.net.URL(url);
            return u.getProtocol() + "://" + u.getHost();
        } catch (Exception e) {
            return url;
        }
    }

    /**
     * 生成书源规则
     */
    private JSONObject generateBookSource(String url, String name, Document doc, String html) {
        JSONObject bookSource = new JSONObject();

        try {
            bookSource.put("bookSourceGroup", "自动生成");
            bookSource.put("bookSourceName", name);
            bookSource.put("bookSourceUrl", cleanUrl(url));
            bookSource.put("bookSourceType", 0);
            bookSource.put("bookSourceComment", "由书源生成器自动生成");
            bookSource.put("header", "{\"User-Agent\":\"" + USER_AGENT + "\"}");
            bookSource.put("httpUserAgent", USER_AGENT);

            // 检测搜索URL
            String searchUrl = detectSearchUrl(url, doc);
            if (searchUrl != null) putIfNotEmpty(bookSource, "searchUrl", searchUrl);
            if (searchUrl != null) putIfNotEmpty(bookSource, "ruleSearchUrl", searchUrl);

            // 检测搜索规则
            putIfNotEmpty(bookSource, "ruleSearchList", detectSearchList(doc));
            putIfNotEmpty(bookSource, "ruleSearchName", detectSearchName(doc));
            putIfNotEmpty(bookSource, "ruleSearchAuthor", detectSearchAuthor(doc));
            putIfNotEmpty(bookSource, "ruleSearchCoverUrl", detectSearchCover(doc));

            // 检测书籍信息规则
            putIfNotEmpty(bookSource, "ruleBookName", detectBookName(doc));
            putIfNotEmpty(bookSource, "ruleBookAuthor", detectBookAuthor(doc));
            putIfNotEmpty(bookSource, "ruleCoverUrl", detectCover(doc));
            putIfNotEmpty(bookSource, "ruleBookKind", detectBookKind(doc));
            putIfNotEmpty(bookSource, "ruleBookIntroduce", detectIntroduce(doc));

            // 检测章节规则
            putIfNotEmpty(bookSource, "ruleChapterList", detectChapterList(doc));
            putIfNotEmpty(bookSource, "ruleChapterName", detectChapterName(doc));
            putIfNotEmpty(bookSource, "ruleChapterUrl", detectChapterUrl(doc));

            // 检测内容规则
            putIfNotEmpty(bookSource, "ruleContent", detectContent(doc));

        } catch (Exception e) {
            e.printStackTrace();
        }

        return bookSource;
    }

    private void putIfNotEmpty(JSONObject obj, String key, String value) {
        if (value != null && !value.isEmpty()) {
            try {
                obj.put(key, value);
            } catch (Exception e) {
                // ignore
            }
        }
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
                    "input[name*=search], input[name*=key], input[name*=word], input[name*=q], input[name*=s]");
            if (!inputs.isEmpty()) {
                String searchUrl = action;
                if (!searchUrl.startsWith("http")) {
                    searchUrl = cleanUrl(url) + (searchUrl.startsWith("/") ? "" : "/") + searchUrl;
                }
                String name = inputs.first().attr("name");
                if (name.isEmpty()) name = "searchkey";
                return searchUrl + (searchUrl.contains("?") ? "&" : "?") + name + "={{key}}";
            }
        }

        // 查找搜索链接
        Elements searchLinks = doc.select("a[href*=search], a[href*=s?key], a[href*=so?key]");
        for (Element link : searchLinks) {
            String href = link.attr("href");
            if (href.contains("key=") || href.contains("word=") || href.contains("q=") || href.contains("s=")) {
                String base = cleanUrl(url);
                href = href.replaceAll("key=[^&]*", "key={{key}}")
                        .replaceAll("word=[^&]*", "word={{key}}")
                        .replaceAll("q=[^&]*", "q={{key}}")
                        .replaceAll("s=[^&]*", "s={{key}}");
                return base + "/" + href.replaceAll("^/", "");
            }
        }

        // 默认搜索URL
        return cleanUrl(url) + "/search?keyword={{key}}";
    }

    /**
     * 检测搜索列表选择器
     */
    private String detectSearchList(Document doc) {
        String[] selectors = {
            ".search-list", ".search_result", ".result-list", ".book-list",
            ".list", ".booklist", ".book_list", ".books-list",
            "ul.list", "ul.book-list",
            "#list", "#booklist", "#search-list", "#search_result",
            ".novelslist", ".novels-list", ".s-list", ".s_result",
            ".item", ".result-item"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测搜索书名选择器
     */
    private String detectSearchName(Document doc) {
        String[] selectors = {
            "h3 a", "h4 a", "h2 a",
            ".bookname a", ".book-name a", ".name a",
            ".title a", ".book_title a",
            "a[title]", "a[href*=book]",
            "td:first-child a", "td a",
            "li a"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测搜索作者选择器
     */
    private String detectSearchAuthor(Document doc) {
        String[] selectors = {
            ".author", ".bookauthor", ".book-author",
            "td.author", "td:nth-child(2)",
            ".info .author", ".book-info .author",
            "span.author", "p.author",
            ".byline", ".writer",
            "td:nth-child(3)", "td:nth-child(4)"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测搜索封面选择器
     */
    private String detectSearchCover(Document doc) {
        String[] selectors = {
            "img.cover", "img.bookcover",
            ".cover img", ".bookcover img",
            "td img", "li img", ".item img",
            "img[src*=cover]", "img[src*=book]"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector + "@src";
            }
        }

        return "";
    }

    /**
     * 检测书名选择器
     */
    private String detectBookName(Document doc) {
        // 先检查meta标签
        Element meta = doc.selectFirst("meta[property=og:novel:book_name], meta[property=og:title]");
        if (meta != null) {
            String selector = meta.tagName() + meta.attributes().toString();
            return "meta[property=\"" + meta.attr("property") + "\"]@content";
        }

        String[] selectors = {
            ".bookname", ".book-name", ".book_name",
            ".booktitle", ".book-title", ".book_title",
            ".name", ".title", ".bookInfo .name",
            ".book-info .name", ".bookInfo .title",
            "h1", "h2.bookname", "h1.bookname",
            ".detail h1", ".detail h2",
            "h1:first-of-type", "h2:first-of-type",
            ".info h1", ".info h2"
        };

        for (String selector : selectors) {
            Element element = doc.selectFirst(selector);
            if (element != null) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测作者选择器
     */
    private String detectBookAuthor(Document doc) {
        // 先检查meta标签
        Element meta = doc.selectFirst("meta[property=og:novel:author], meta[property=book:author]");
        if (meta != null) {
            return "meta[property=\"" + meta.attr("property") + "\"]@content";
        }

        String[] selectors = {
            ".author", ".bookauthor", ".book-author",
            ".writer", ".byline",
            ".info .author", ".book-info .author",
            ".detail .author", ".bookInfo .author",
            "span.author", "p.author"
        };

        for (String selector : selectors) {
            Element element = doc.selectFirst(selector);
            if (element != null) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测封面选择器
     */
    private String detectCover(Document doc) {
        Element meta = doc.selectFirst("meta[property=og:image]");
        if (meta != null) {
            return "meta[property=\"og:image\"]@content";
        }

        Element link = doc.selectFirst("link[rel=image_src]");
        if (link != null) {
            return "link[rel=image_src]@href";
        }

        String[] selectors = {
            ".cover img", ".bookcover img", ".book-cover img",
            ".bookimg img", ".book-img img", ".pic img",
            ".detail .cover img", ".bookInfo .cover img",
            "img.cover", "img.bookcover"
        };

        for (String selector : selectors) {
            Element element = doc.selectFirst(selector);
            if (element != null) {
                return selector + "@src";
            }
        }

        return "";
    }

    /**
     * 检测分类选择器
     */
    private String detectBookKind(Document doc) {
        String[] selectors = {
            ".kind", ".category", ".type", ".genre",
            ".bookkind", ".book-kind", ".book_type",
            ".info .kind", ".book-info .kind",
            "meta[property=og:novel:category]"
        };

        for (String selector : selectors) {
            Element element = doc.selectFirst(selector);
            if (element != null) {
                if (selector.startsWith("meta")) {
                    return selector + "@content";
                }
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测简介选择器
     */
    private String detectIntroduce(Document doc) {
        Element meta = doc.selectFirst("meta[property=og:description], meta[name=description]");
        if (meta != null) {
            return meta.tagName() + "[name=\"" + meta.attr("name") + "\"]@content";
        }

        String[] selectors = {
            ".intro", ".introduce", ".description",
            ".desc", ".bookdesc", ".book-desc",
            ".summary", ".book-summary",
            ".info .intro", ".book-info .intro",
            ".detail .intro", ".bookInfo .intro",
            "#intro", "#description"
        };

        for (String selector : selectors) {
            Element element = doc.selectFirst(selector);
            if (element != null) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测章节列表选择器
     */
    private String detectChapterList(Document doc) {
        String[] selectors = {
            "#list", ".list", ".chapter-list", ".chapters",
            ".chapterlist", ".chapter_list", ".catalog",
            ".directory", ".index", ".book-list",
            "#chapters", "#chapter-list", "#catalog",
            "ul.chapter", "ul.chapters", "ul.list",
            ".book .list", ".book-list ul"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector + " li";
            }
        }

        // 通用检测：找包含最多链接的列表
        Elements uls = doc.select("ul");
        Element bestList = null;
        int maxLinks = 0;
        for (Element ul : uls) {
            int links = ul.select("a[href]").size();
            if (links > maxLinks) {
                maxLinks = links;
                bestList = ul;
            }
        }
        if (bestList != null && maxLinks >= 5) {
            String id = bestList.id();
            String cls = bestList.className();
            if (!id.isEmpty()) return "#" + id + " li";
            if (!cls.isEmpty()) return "." + cls.replace(" ", ".") + " li";
            return "ul li";
        }

        return "";
    }

    /**
     * 检测章节名称选择器
     */
    private String detectChapterName(Document doc) {
        String[] selectors = {
            "li a", "li span", "td a",
            "a[href*=html]", "a[href*=chapter]",
            "a[href*=/]", "a"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector;
            }
        }

        return "";
    }

    /**
     * 检测章节URL选择器
     */
    private String detectChapterUrl(Document doc) {
        String[] selectors = {
            "li a", "td a",
            "a[href*=html]", "a[href*=chapter]",
            "a[href*=/]", "a"
        };

        for (String selector : selectors) {
            Elements elements = doc.select(selector);
            if (elements.size() >= 2) {
                return selector + "@href";
            }
        }

        return "";
    }

    /**
     * 检测内容选择器
     */
    private String detectContent(Document doc) {
        String[] selectors = {
            "#content", ".content", ".bookcontent", ".book-content",
            ".text", ".article", ".chapter-content",
            "#bookcontent", "#chaptercontent", "#textcontent",
            ".read-content", ".novel-content", ".txt",
            "article", "main",
            "div[class*=content]", "div[id*=content]",
            "div[class*=text]", "div[id*=text]",
            "div[class*=chapter]", "div[id*=chapter]",
            "p"
        };

        for (String selector : selectors) {
            Element element = doc.selectFirst(selector);
            if (element != null) {
                return selector;
            }
        }

        return "";
    }
}
