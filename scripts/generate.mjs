import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { englishPosts } from "./english-posts.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupRoot = path.resolve(
  process.argv[2] || "/Users/yang/Documents/sonic-blog-backups/20260528-215807"
);
const dbPath = path.join(backupRoot, "export", "db", "sonic.db");
const uploadSrc = path.join(backupRoot, "sonic", "upload");

const site = {
  title: "Yang Cen",
  url: "https://bubblecal.github.io",
  author: "Yang Cen",
  description: {
    zh: "关于向量查询、全文检索、查询引擎和分布式系统的技术笔记。",
    en: "Notes on vector search, full-text search, query engines, and distributed systems."
  }
};

const languages = ["zh", "en"];
const locales = {
  zh: {
    htmlLang: "zh-CN",
    rssLang: "zh-CN",
    nav: {
      latest: "Latest",
      about: "About",
      archive: "Archive",
      language: "EN"
    },
    home: {
      eyebrow: "systems notes / paper reading / build logs",
      lede: "Notes on vector databases, query engines, operating systems, and the engineering details that decide whether an idea actually ships.",
      posts: "published posts",
      categories: "categories",
      tags: "tags",
      latest: "latest",
      recentWriting: "Recent writing",
      search: "Search",
      searchPlaceholder: "Title, category, tag",
      noMatches: "No matching posts.",
      selected: "selected",
      startHere: "Start here"
    },
    archive: {
      eyebrow: "archive",
      title: "All posts",
      description: (count) => `${count} public posts migrated from the Sonic backup.`
    },
    about: {
      eyebrow: "about",
      title: "Yang Cen",
      description: "关于 Yang Cen。",
      paragraphs: [
        "我目前在 LanceDB 工作，关注向量查询、全文检索、查询引擎和分布式系统。",
        "曾经是 ACM 选手和守望先锋玩家，现在正在学习赛车。它们和系统工程对我的吸引力有点相似：细节会不断累积，反馈非常直接，好的表现来自持续而有纪律的迭代。",
        "这个博客主要记录技术笔记、论文阅读、实现经验，以及一些正在学习的东西。"
      ]
    },
    article: {
      back: "Back to latest",
      toc: "On this page",
      previous: "Previous",
      next: "Next"
    },
    notFound: {
      eyebrow: "404",
      title: "Page not found",
      description: "The page may have moved during the static migration.",
      link: "Return home"
    }
  },
  en: {
    htmlLang: "en",
    rssLang: "en-US",
    nav: {
      latest: "Latest",
      about: "About",
      archive: "Archive",
      language: "中文"
    },
    home: {
      eyebrow: "systems notes / paper reading / build logs",
      lede: "Notes on vector databases, query engines, operating systems, and the engineering details that decide whether an idea actually ships.",
      posts: "published posts",
      categories: "categories",
      tags: "tags",
      latest: "latest",
      recentWriting: "Recent writing",
      search: "Search",
      searchPlaceholder: "Title, category, tag",
      noMatches: "No matching posts.",
      selected: "selected",
      startHere: "Start here"
    },
    archive: {
      eyebrow: "archive",
      title: "All posts",
      description: (count) => `${count} public posts migrated from the Sonic backup.`
    },
    about: {
      eyebrow: "about",
      title: "Yang Cen",
      description: "About Yang Cen.",
      paragraphs: [
        "I am an engineer at LanceDB, working on vector search, full-text search, query engines, and distributed systems.",
        "Before this, I was an ACM contestant and an Overwatch player. These days I am learning racing, mostly for the same reason I like systems work: small details compound, feedback is immediate, and good performance is earned through disciplined iteration.",
        "This blog is where I keep technical notes, paper readings, implementation write-ups, and the occasional record of what I am learning along the way."
      ]
    },
    article: {
      back: "Back to latest",
      toc: "On this page",
      previous: "Previous",
      next: "Next"
    },
    notFound: {
      eyebrow: "404",
      title: "Page not found",
      description: "The page may have moved during the static migration.",
      link: "Return home"
    }
  }
};

const excludedSlugs = new Set(["vscode-milvus", "datafusion-source-code-part0"]);
const categoryNameMap = new Map([
  ["技术", "Technology"],
  ["PaperReading", "Paper Reading"],
  ["硬件", "Hardware"],
  ["默认分类", "General"]
]);
const generatedTagsBySlug = new Map([
  ["4bitpqreadingimplementing", ["Vector Search", "Product Quantization", "SIMD"]],
  [
    "paperreadingvbaseunifyingonlinevectorsimilaritysearchandrelationalqueriesviarelaxedmonotonicity",
    ["Vector Search", "ANN", "Query Processing"]
  ],
  [
    "PaperReadingFilterRepresentationinVectorizedQueryExecution",
    ["Query Engine", "Vectorized Execution", "Bitmap"]
  ],
  [
    "shou-wang-xian-feng-ru-men--duan-zan-hei-ping-xian-xiang-bei-hou-de-xian-shi-qi-yuan-li",
    ["Overwatch", "Display", "Hardware"]
  ],
  ["swap-cache-mmap", ["Linux", "Memory Management", "mmap"]],
  ["824-lab2", ["Distributed Systems", "Raft", "Course"]]
]);

const quickAdcFigures = {
  zh: [
    {
      headingId: "product-quantization",
      src: "/assets/figures/4bit-pq-pipeline.svg",
      alt: "Product quantization encoding and distance lookup pipeline",
      caption:
        'PQ 编码流程示意：向量被切成多个 sub-vector，每个位置独立训练 codebook，查询时用 distance table 做 ADC 查表求和。'
    },
    {
      headingId: "transposing",
      src: "/assets/figures/4bit-pq-transposed-layout.svg",
      alt: "Row-major and transposed PQ code memory layouts",
      caption:
        '转置布局把 code[j][i] 放成连续内存。外层按 block 扫描时，distance table 保持 cache 友好，code 访问也变成顺序访问。'
    },
    {
      headingId: "4bit-pq",
      src: "/assets/figures/4bit-pq-quick-adc.svg",
      alt: "Quick ADC 4-bit lookup table and SIMD shuffle diagram",
      caption:
        'Quick ADC 的关键约束：4-bit centroid id 只有 16 个候选，再把 distance quantize 成 u8，整张 lookup table 就能放进一个 128-bit SIMD register。'
    }
  ],
  en: [
    {
      headingId: "product-quantization",
      src: "/assets/figures/4bit-pq-pipeline.svg",
      alt: "Product quantization encoding and distance lookup pipeline",
      caption:
        "PQ encoding path: split the vector into sub-vectors, train one codebook per position, then use an ADC distance table at query time."
    },
    {
      headingId: "transposing",
      src: "/assets/figures/4bit-pq-transposed-layout.svg",
      alt: "Row-major and transposed PQ code memory layouts",
      caption:
        "After transposition, code[j][i] is contiguous for the block-first loop order, so both the code stream and the distance table have better locality."
    },
    {
      headingId: "4-bit-pq",
      src: "/assets/figures/4bit-pq-quick-adc.svg",
      alt: "Quick ADC 4-bit lookup table and SIMD shuffle diagram",
      caption:
        "The Quick ADC constraint: 4-bit centroid ids create a 16-entry table, and u8 distance quantization lets the whole lookup table fit in one 128-bit SIMD register."
    }
  ]
};

const quickAdcBenchmarkFigure = {
  zh: {
    src: "/assets/figures/4bit-pq-benchmark-summary.svg",
    alt: "Quick ADC paper benchmark headline summary",
    caption:
      '重画的论文 headline benchmark 摘要，不是论文截图：<a href="https://arxiv.org/abs/1704.07355">Quick ADC 论文</a>报告了相对 ADC 约 3-6x 的加速，并在 SIFT1B 128-bit codes 上达到 Recall@100 0.94 / 3.4 ms。'
  },
  en: {
    src: "/assets/figures/4bit-pq-benchmark-summary.svg",
    alt: "Quick ADC paper benchmark headline summary",
    caption:
      'A redrawn headline benchmark summary, not a copied paper figure: the <a href="https://arxiv.org/abs/1704.07355">Quick ADC paper</a> reports roughly 3-6x speedup over ADC and Recall@100 0.94 / 3.4 ms on SIFT1B with 128-bit codes.'
  }
};

const quickAdcSummary = {
  zh: "4bit PQ 实现笔记：为什么它理论上能比 8bit PQ 更快，Quick ADC 依赖的 code 转置和 SIMD lookup，以及实际实现里 distance quantization 的取舍。",
  en: "Notes from implementing 4-bit product quantization: why it should be faster than 8-bit PQ, where the paper leaves implementation gaps, and what tradeoffs worked in practice."
};

function query(sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  return output.trim() ? JSON.parse(output) : [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function displayDate(raw) {
  return String(raw || "").slice(0, 10);
}

function year(raw) {
  return displayDate(raw).slice(0, 4);
}

function toDate(raw) {
  const match = String(raw || "").match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2})$/
  );
  return match ? new Date(`${match[1]}T${match[2]}${match[3]}`) : new Date(raw);
}

function readingTime(post) {
  if (post.language === "en") {
    return Math.max(1, Math.ceil(stripHtml(post.format_content).split(/\s+/).filter(Boolean).length / 220));
  }
  return Math.max(1, Math.ceil(Number(post.word_count || 0) / 400));
}

function absoluteUrl(pathname) {
  return `${site.url}${pathname}`;
}

function normalizeContent(html) {
  return String(html ?? "")
    .replaceAll('src="/upload/', 'src="/upload/')
    .replaceAll('href="/upload/', 'href="/upload/');
}

function firstImage(html) {
  const match = String(html ?? "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

function displayCategoryName(name) {
  return categoryNameMap.get(name) || name;
}

function slugifyTag(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyHeading(value) {
  return String(value)
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function tagsForPost(post) {
  return (generatedTagsBySlug.get(post.slug) || []).map((name) => ({
    name,
    slug: slugifyTag(name),
    color: "#cfd3d7"
  }));
}

function inlineMarkdown(value) {
  let output = escapeHtml(value);
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, text, url) => `<a href="${escapeAttr(url)}">${escapeHtml(text)}</a>`
  );
  return output;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").trim().split("\n");
  const html = [];
  const paragraph = [];
  let listType = "";
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  const headingCounts = new Map();

  function uniqueHeadingId(text) {
    const base = slugifyHeading(text);
    const count = headingCounts.get(base) || 0;
    headingCounts.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  }

  function closeParagraph() {
    if (!paragraph.length) {
      return;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  }

  function closeList() {
    if (!listType) {
      return;
    }
    html.push(`</${listType}>`);
    listType = "";
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(~~~)([a-zA-Z0-9_-]*)?$/);
    if (fence) {
      if (inCode) {
        html.push(
          `<pre><code${codeLang ? ` class="language-${escapeAttr(codeLang)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`
        );
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        closeParagraph();
        closeList();
        inCode = true;
        codeLang = fence[2] || "";
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      html.push(`<h${level} id="${escapeAttr(uniqueHeadingId(text))}" tabindex="-1">${inlineMarkdown(text)}</h${level}>`);
      continue;
    }

    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      closeParagraph();
      closeList();
      html.push(`<p><img src="${escapeAttr(image[2])}" alt="${escapeAttr(image[1])}" /></p>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      closeParagraph();
      const targetList = unordered ? "ul" : "ol";
      if (listType && listType !== targetList) {
        closeList();
      }
      if (!listType) {
        listType = targetList;
        html.push(`<${listType}>`);
      }
      html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  closeParagraph();
  closeList();
  if (inCode) {
    html.push(`<pre><code${codeLang ? ` class="language-${escapeAttr(codeLang)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function articleFigure({ src, alt, caption }) {
  return `<figure class="article-figure">
  <img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async">
  <figcaption>${caption}</figcaption>
</figure>`;
}

function insertAfterHeading(html, headingId, addition) {
  const pattern = new RegExp(
    `(<h[1-3]\\s+[^>]*id=["']${escapeRegExp(headingId)}["'][^>]*>[\\s\\S]*?<\\/h[1-3]>)`
  );
  if (!pattern.test(html)) {
    return `${html}\n${addition}`;
  }
  return html.replace(pattern, `$1\n${addition}`);
}

function enhancePostContent(post, lang) {
  if (post.slug !== "4bitpqreadingimplementing") {
    return post;
  }

  let formatContent = post.format_content;
  for (const figure of quickAdcFigures[lang] || []) {
    formatContent = insertAfterHeading(formatContent, figure.headingId, articleFigure(figure));
  }

  formatContent = `${formatContent}\n${articleFigure(quickAdcBenchmarkFigure[lang])}`;
  return {
    ...post,
    heroImage: post.heroImage || quickAdcFigures[lang][0].src,
    summary: post.summary || quickAdcSummary[lang],
    format_content: formatContent
  };
}

function headingList(html) {
  const headings = [];
  const pattern = /<h([12])\s+[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    headings.push({
      level: Number(match[1]),
      id: match[2],
      text: stripHtml(match[3])
    });
  }
  return headings.slice(0, 12);
}

function otherLanguage(lang) {
  return lang === "zh" ? "en" : "zh";
}

function homeUrl(lang) {
  return `/${lang}/`;
}

function aboutUrl(lang) {
  return `/${lang}/about/`;
}

function archiveUrl(lang) {
  return `/${lang}/archive/`;
}

function postUrl(post, lang) {
  return `/${lang}/posts/${encodeURIComponent(post.slug)}/`;
}

function excerpt(post) {
  const source = post.summary || stripHtml(post.format_content);
  const limit = post.language === "en" ? 190 : 150;
  return source.length > limit ? `${source.slice(0, limit)}...` : source;
}

function shell({ lang, title, description, body, page = "", canonical = "/", alternate = "/" }) {
  const locale = locales[lang];
  const fullTitle = title === site.title ? site.title : `${title} - ${site.title}`;
  const other = otherLanguage(lang);
  return `<!doctype html>
<html lang="${escapeAttr(locale.htmlLang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeAttr(description || site.description[lang])}">
  <meta property="og:title" content="${escapeAttr(fullTitle)}">
  <meta property="og:description" content="${escapeAttr(description || site.description[lang])}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeAttr(absoluteUrl(canonical))}">
  <link rel="canonical" href="${escapeAttr(absoluteUrl(canonical))}">
  <link rel="alternate" hreflang="${escapeAttr(locales.zh.htmlLang)}" href="${escapeAttr(absoluteUrl(canonical.replace(`/${lang}/`, "/zh/")))}">
  <link rel="alternate" hreflang="${escapeAttr(locales.en.htmlLang)}" href="${escapeAttr(absoluteUrl(canonical.replace(`/${lang}/`, "/en/")))}">
  <link rel="alternate" type="application/rss+xml" title="${escapeAttr(site.title)}" href="/${lang}/feed.xml">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <link rel="stylesheet" href="/assets/site.css">
  <script src="/assets/site.js" defer></script>
</head>
<body class="${escapeAttr(page)}" data-lang="${escapeAttr(lang)}">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="topbar">
    <a class="brand" href="${escapeAttr(homeUrl(lang))}" aria-label="${escapeAttr(site.title)} home">
      <span>${escapeHtml(site.title)}</span>
    </a>
    <nav class="nav-links" aria-label="Primary navigation">
      <a href="${escapeAttr(homeUrl(lang))}">${escapeHtml(locale.nav.latest)}</a>
      <a href="${escapeAttr(aboutUrl(lang))}">${escapeHtml(locale.nav.about)}</a>
      <a href="${escapeAttr(archiveUrl(lang))}">${escapeHtml(locale.nav.archive)}</a>
      <a href="/${escapeAttr(lang)}/feed.xml">RSS</a>
      <a class="lang-switch" href="${escapeAttr(alternate)}" hreflang="${escapeAttr(locales[other].htmlLang)}" data-lang-switch data-lang="${escapeAttr(other)}">${escapeHtml(locale.nav.language)}</a>
      <button class="icon-button" type="button" data-theme-toggle aria-label="Toggle theme" title="Toggle theme">◐</button>
    </nav>
  </header>
  <main id="main">
${body}
  </main>
</body>
</html>`;
}

function postMeta(post) {
  const cats = post.categories.map((item) => item.name).join(", ");
  const tags = post.tags.map((item) => item.name).join(", ");
  return [displayDate(post.create_time), `${readingTime(post)} min`, cats, tags ? `tags: ${tags}` : ""]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
}

function categoryButton(category, count) {
  return `<button type="button" data-filter="${escapeAttr(category)}">${escapeHtml(category)} <span>${count}</span></button>`;
}

function postCard(post, index, lang) {
  const image = post.heroImage;
  return `<article class="post-card" data-post-card data-title="${escapeAttr(post.title)}" data-categories="${escapeAttr(post.categories.map((item) => item.name).join(" "))}" data-tags="${escapeAttr(post.tags.map((item) => item.name).join(" "))}">
  <div class="post-card__body">
    <div class="post-card__meta">${postMeta(post)}</div>
    <h2><a href="${escapeAttr(postUrl(post, lang))}">${escapeHtml(post.title)}</a></h2>
    <p>${escapeHtml(excerpt(post))}</p>
  </div>
  ${
    image
      ? `<a class="post-card__media" href="${escapeAttr(postUrl(post, lang))}" aria-label="${escapeAttr(post.title)}"><img src="${escapeAttr(image)}" alt="" loading="${index < 2 ? "eager" : "lazy"}"></a>`
      : `<a class="post-card__mark" href="${escapeAttr(postUrl(post, lang))}" aria-label="${escapeAttr(post.title)}"><span>${escapeHtml(year(post.create_time))}</span></a>`
  }
</article>`;
}

function homePage(posts, categories, tags, lang) {
  const locale = locales[lang];
  const latest = posts.slice(0, 4);
  const categoryCounts = new Map();
  for (const post of posts) {
    for (const category of post.categories) {
      categoryCounts.set(category.name, (categoryCounts.get(category.name) || 0) + 1);
    }
  }
  const body = `  <section class="home-hero" aria-labelledby="home-title">
    <div class="home-hero__intro">
      <p class="eyebrow">${escapeHtml(locale.home.eyebrow)}</p>
      <h1 id="home-title">${escapeHtml(site.title)}</h1>
      <p class="lede">${escapeHtml(locale.home.lede)}</p>
    </div>
    <div class="home-hero__stats" aria-label="Site statistics">
      <div><strong>${posts.length}</strong><span>${escapeHtml(locale.home.posts)}</span></div>
      <div><strong>${categories.length}</strong><span>${escapeHtml(locale.home.categories)}</span></div>
      <div><strong>${tags.length}</strong><span>${escapeHtml(locale.home.tags)}</span></div>
    </div>
  </section>
  <section class="content-shell">
    <aside class="side-panel" aria-label="Categories">
      <h2>Categories</h2>
      <div class="filter-group" data-filter-group>
        <button type="button" class="is-active" data-filter="all">All <span>${posts.length}</span></button>
        ${[...categoryCounts.entries()].map(([name, count]) => categoryButton(name, count)).join("\n        ")}
      </div>
    </aside>
    <section class="post-stream" aria-labelledby="latest-title">
      <div class="stream-header">
        <div>
          <p class="eyebrow">${escapeHtml(locale.home.latest)}</p>
          <h2 id="latest-title">${escapeHtml(locale.home.recentWriting)}</h2>
        </div>
        <label class="search-box">
          <span>${escapeHtml(locale.home.search)}</span>
          <input type="search" data-search placeholder="${escapeAttr(locale.home.searchPlaceholder)}">
        </label>
      </div>
      <div class="post-list">
        ${posts.map((post, index) => postCard(post, index, lang)).join("\n        ")}
      </div>
      <p class="empty-state" data-empty-state hidden>${escapeHtml(locale.home.noMatches)}</p>
    </section>
  </section>
  <section class="featured-band" aria-labelledby="featured-title">
    <div>
      <p class="eyebrow">${escapeHtml(locale.home.selected)}</p>
      <h2 id="featured-title">${escapeHtml(locale.home.startHere)}</h2>
    </div>
    <div class="featured-links">
      ${latest
        .map(
          (post) => `<a href="${escapeAttr(postUrl(post, lang))}">
        <span>${escapeHtml(displayDate(post.create_time))}</span>
        ${escapeHtml(post.title)}
      </a>`
        )
        .join("\n      ")}
    </div>
  </section>`;
  return shell({
    lang,
    title: site.title,
    description: site.description[lang],
    body,
    page: "home",
    canonical: homeUrl(lang),
    alternate: homeUrl(otherLanguage(lang))
  });
}

function archivePage(posts, lang) {
  const locale = locales[lang];
  const groups = new Map();
  for (const post of posts) {
    const y = year(post.create_time);
    if (!groups.has(y)) {
      groups.set(y, []);
    }
    groups.get(y).push(post);
  }
  const body = `  <section class="page-heading">
    <p class="eyebrow">${escapeHtml(locale.archive.eyebrow)}</p>
    <h1>${escapeHtml(locale.archive.title)}</h1>
    <p>${escapeHtml(locale.archive.description(posts.length))}</p>
  </section>
  <section class="archive-list">
    ${[...groups.entries()]
      .map(
        ([groupYear, groupPosts]) => `<div class="archive-year">
      <h2>${escapeHtml(groupYear)}</h2>
      <ol>
        ${groupPosts
          .map(
            (post) => `<li>
          <time datetime="${escapeAttr(displayDate(post.create_time))}">${escapeHtml(displayDate(post.create_time).slice(5))}</time>
          <a href="${escapeAttr(postUrl(post, lang))}">${escapeHtml(post.title)}</a>
        </li>`
          )
          .join("\n        ")}
      </ol>
    </div>`
      )
      .join("\n    ")}
  </section>`;
  return shell({
    lang,
    title: "Archive",
    description: `All public posts on ${site.title}.`,
    body,
    page: "archive",
    canonical: archiveUrl(lang),
    alternate: archiveUrl(otherLanguage(lang))
  });
}

function aboutPage(lang) {
  const locale = locales[lang];
  const body = `  <section class="about-page" aria-labelledby="about-title">
    <p class="eyebrow">${escapeHtml(locale.about.eyebrow)}</p>
    <h1 id="about-title">${escapeHtml(locale.about.title)}</h1>
    <div class="about-copy">
      ${locale.about.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n      ")}
    </div>
  </section>`;
  return shell({
    lang,
    title: "About",
    description: locale.about.description,
    body,
    page: "about",
    canonical: aboutUrl(lang),
    alternate: aboutUrl(otherLanguage(lang))
  });
}

function articlePage(post, previous, next, lang) {
  const locale = locales[lang];
  const content = normalizeContent(post.format_content || "");
  const headings = headingList(content);
  const toc = headings.length
    ? `<nav class="toc" aria-label="Table of contents">
      <h2>${escapeHtml(locale.article.toc)}</h2>
      ${headings
        .map(
          (heading) => `<a class="toc-level-${heading.level}" href="#${escapeAttr(heading.id)}">${escapeHtml(heading.text)}</a>`
        )
        .join("\n      ")}
    </nav>`
    : "";

  const body = `  <article class="article-layout">
    <header class="article-header">
      <a class="back-link" href="${escapeAttr(homeUrl(lang))}">${escapeHtml(locale.article.back)}</a>
      <p class="article-meta">${postMeta(post)}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p>${escapeHtml(excerpt(post))}</p>
    </header>
    <div class="article-body-shell">
      ${toc}
      <div class="article-content">
${content}
      </div>
    </div>
    <footer class="article-footer">
      ${previous ? `<a rel="prev" href="${escapeAttr(postUrl(previous, lang))}"><span>${escapeHtml(locale.article.previous)}</span>${escapeHtml(previous.title)}</a>` : "<span></span>"}
      ${next ? `<a rel="next" href="${escapeAttr(postUrl(next, lang))}"><span>${escapeHtml(locale.article.next)}</span>${escapeHtml(next.title)}</a>` : "<span></span>"}
    </footer>
  </article>`;
  return shell({
    lang,
    title: post.title,
    description: excerpt(post),
    body,
    page: "article",
    canonical: postUrl(post, lang),
    alternate: postUrl(post, otherLanguage(lang))
  });
}

function notFoundPage(lang) {
  const locale = locales[lang];
  const body = `  <section class="page-heading not-found">
    <p class="eyebrow">${escapeHtml(locale.notFound.eyebrow)}</p>
    <h1>${escapeHtml(locale.notFound.title)}</h1>
    <p>${escapeHtml(locale.notFound.description)}</p>
    <a class="text-link" href="${escapeAttr(homeUrl(lang))}">${escapeHtml(locale.notFound.link)}</a>
  </section>`;
  return shell({
    lang,
    title: "Not found",
    description: "Page not found",
    body,
    page: "not-found",
    canonical: `/${lang}/404.html`,
    alternate: `/${otherLanguage(lang)}/404.html`
  });
}

function feed(posts, lang) {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>${escapeHtml(site.title)}</title>
  <link>${escapeHtml(absoluteUrl(homeUrl(lang)))}</link>
  <description>${escapeHtml(site.description[lang])}</description>
  <language>${escapeHtml(locales[lang].rssLang)}</language>
  ${posts
    .map(
      (post) => `<item>
    <title>${escapeHtml(post.title)}</title>
    <link>${escapeHtml(absoluteUrl(postUrl(post, lang)))}</link>
    <guid>${escapeHtml(absoluteUrl(postUrl(post, lang)))}</guid>
    <pubDate>${toDate(post.create_time).toUTCString()}</pubDate>
    <description>${escapeHtml(excerpt(post))}</description>
  </item>`
    )
    .join("\n  ")}
</channel>
</rss>`;
}

function sitemap(postsByLanguage) {
  const urls = ["/", "/feed.xml"];
  for (const lang of languages) {
    const posts = postsByLanguage.get(lang);
    urls.push(homeUrl(lang), aboutUrl(lang), archiveUrl(lang), `/${lang}/feed.xml`);
    urls.push(...posts.map((post) => postUrl(post, lang)));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeHtml(absoluteUrl(url))}</loc>
  </url>`
  )
  .join("\n")}
</urlset>`;
}

function languageRedirectPage({ title = site.title, zhPath, enPath }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script>
    (function () {
      var saved = localStorage.getItem("yah01-blog-language");
      var languages = navigator.languages || [navigator.language || ""];
      var detected = languages.some(function (language) { return /^zh/i.test(language); }) ? "zh" : "en";
      var language = saved === "zh" || saved === "en" ? saved : detected;
      location.replace(language === "zh" ? "${escapeAttr(zhPath)}" : "${escapeAttr(enPath)}");
    })();
  </script>
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body class="redirect-page">
  <main class="redirect-choice">
    <h1>${escapeHtml(site.title)}</h1>
    <p>Choose a language.</p>
    <p><a href="${escapeAttr(zhPath)}" data-lang-switch data-lang="zh">中文</a> <a href="${escapeAttr(enPath)}" data-lang-switch data-lang="en">English</a></p>
  </main>
  <script src="/assets/site.js"></script>
</body>
</html>`;
}

async function write(file, content) {
  const target = path.join(projectRoot, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

function localizePost(post, lang) {
  if (lang === "zh") {
    return enhancePostContent({
      ...post,
      language: lang,
      format_content: normalizeContent(post.format_content)
    }, lang);
  }

  const translation = englishPosts[post.slug];
  if (!translation) {
    throw new Error(`Missing English translation for ${post.slug}`);
  }

  const formatContent = renderMarkdown(translation.content);
  return enhancePostContent({
    ...post,
    language: lang,
    title: translation.title || post.title,
    summary: translation.summary || stripHtml(formatContent).slice(0, 190),
    format_content: formatContent,
    word_count: stripHtml(formatContent).split(/\s+/).filter(Boolean).length
  }, lang);
}

async function main() {
  const rows = query(`
    select id, title, slug, create_time, update_time, format_content, summary,
           thumbnail, word_count, visits, likes
    from post
    where type = 0 and status = 0
    order by create_time desc;
  `).filter((post) => !excludedSlugs.has(post.slug));
  const postIds = rows.map((post) => post.id).join(",");
  const categoryRows = postIds
    ? query(`
        select pc.post_id, c.name, c.slug
        from post_category pc
        join category c on c.id = pc.category_id
        where pc.post_id in (${postIds})
        order by c.name;
      `)
    : [];
  const categoriesByPost = new Map();
  for (const row of categoryRows) {
    if (!categoriesByPost.has(row.post_id)) {
      categoriesByPost.set(row.post_id, []);
    }
    categoriesByPost.get(row.post_id).push({ name: displayCategoryName(row.name), slug: row.slug });
  }

  const basePosts = rows.map((post) => ({
    ...post,
    categories: categoriesByPost.get(post.id) || [],
    tags: tagsForPost(post),
    heroImage: post.thumbnail || firstImage(post.format_content)
  }));

  const publicCategories = [...new Map(categoryRows.map((row) => [row.slug, row])).values()];
  const postsByLanguage = new Map(languages.map((lang) => [lang, basePosts.map((post) => localizePost(post, lang))]));
  const publicTags = [
    ...new Map(basePosts.flatMap((post) => post.tags).map((tag) => [tag.slug, tag])).values()
  ].sort((left, right) => left.name.localeCompare(right.name));

  await fs.rm(path.join(projectRoot, "zh"), { recursive: true, force: true });
  await fs.rm(path.join(projectRoot, "en"), { recursive: true, force: true });
  await fs.rm(path.join(projectRoot, "posts"), { recursive: true, force: true });
  await fs.rm(path.join(projectRoot, "about"), { recursive: true, force: true });
  await fs.rm(path.join(projectRoot, "archive"), { recursive: true, force: true });
  await fs.rm(path.join(projectRoot, "upload"), { recursive: true, force: true });
  await fs.cp(uploadSrc, path.join(projectRoot, "upload"), { recursive: true });

  await write("index.html", languageRedirectPage({ zhPath: homeUrl("zh"), enPath: homeUrl("en") }));
  await write("404.html", languageRedirectPage({ title: "Not found", zhPath: "/zh/404.html", enPath: "/en/404.html" }));
  await write("about/index.html", languageRedirectPage({ title: "About", zhPath: aboutUrl("zh"), enPath: aboutUrl("en") }));
  await write("archive/index.html", languageRedirectPage({ title: "Archive", zhPath: archiveUrl("zh"), enPath: archiveUrl("en") }));
  await write("feed.xml", feed(postsByLanguage.get("en"), "en"));
  await write("sitemap.xml", sitemap(postsByLanguage));

  for (const lang of languages) {
    const posts = postsByLanguage.get(lang);
    await write(`${lang}/index.html`, homePage(posts, publicCategories, publicTags, lang));
    await write(`${lang}/about/index.html`, aboutPage(lang));
    await write(`${lang}/archive/index.html`, archivePage(posts, lang));
    await write(`${lang}/404.html`, notFoundPage(lang));
    await write(`${lang}/feed.xml`, feed(posts, lang));
    await write(`data/${lang}-posts.json`, `${JSON.stringify(posts, null, 2)}\n`);

    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      await write(
        `${lang}/posts/${post.slug}/index.html`,
        articlePage(post, posts[index + 1], posts[index - 1], lang)
      );
    }
  }

  await write("data/posts.json", `${JSON.stringify(postsByLanguage.get("zh"), null, 2)}\n`);

  for (const post of basePosts) {
    await write(
      `posts/${post.slug}/index.html`,
      languageRedirectPage({
        title: post.title,
        zhPath: postUrl(post, "zh"),
        enPath: postUrl(post, "en")
      })
    );
  }

  console.log(`Generated ${basePosts.length} posts in ${languages.length} languages from ${dbPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
