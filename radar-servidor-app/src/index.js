import express from "express";
import OpenAI from "openai";
import { XMLParser } from "fast-xml-parser";

const app = express();
app.use(express.json({ limit: "1mb" }));

const config = {
  port: Number(process.env.PORT || 3000),
  sharedToken: process.env.N8N_SHARED_TOKEN || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  timezone: process.env.TIMEZONE || "America/Sao_Paulo",
  defaultSources: (process.env.DEFAULT_SOURCES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
});

const keywordRules = [
  "servidor",
  "servidores",
  "servico publico",
  "serviço público",
  "carreira",
  "cargo",
  "concurso",
  "cpnu",
  "nomeacao",
  "nomeação",
  "provimento",
  "aposentadoria",
  "pensionista",
  "pensionistas",
  "irpf",
  "rendimentos",
  "sougov",
  "cadastro",
  "movimentacao",
  "movimentação",
  "funcional",
  "gratificacao",
  "gratificação",
  "beneficio",
  "benefício",
  "licenca",
  "licença",
  "jornada",
  "teletrabalho",
  "capacitacao",
  "capacitação",
  "aperfeicoamento",
  "aperfeiçoamento",
  "lideranca",
  "liderança",
  "enap",
  "escola virtual de governo",
  "inovacao",
  "inovação",
  "violencia domestica",
  "violência doméstica",
  "portaria",
  "webinario",
  "webinário"
];

const htmlLinkLimit = 20;

function assertConfig() {
  if (!config.sharedToken) {
    throw new Error("N8N_SHARED_TOKEN nao configurado");
  }
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY nao configurado");
  }
  if (!config.defaultSources.length) {
    throw new Error("DEFAULT_SOURCES nao configurado");
  }
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getDateKey(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function resolveAnalysisDate(requestedDate, timezone) {
  if (requestedDate) {
    return requestedDate;
  }

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return getDateKey(yesterday, timezone);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function sourceLabel(url) {
  if (url.includes("mg.gov.br")) return "MG.GOV.BR";
  if (url.includes("gov.br/servidor/rss")) return "Portal do Servidor RSS";
  if (url.includes("gov.br/servidor/sitemap")) return "Portal do Servidor Sitemap";
  if (url.includes("gov.br/rss")) return "gov.br geral";
  if (url.includes("congressoemfoco")) return "Congresso em Foco";
  return url;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RadarServidorEducamundo/1.1",
      Accept: "application/rss+xml, application/xml, text/xml, application/xhtml+xml, text/html;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar ${url}: ${response.status}`);
  }

  return await response.text();
}

function parseRss(xmlText, sourceUrl) {
  const parsed = parser.parse(xmlText);
  const items = toArray(parsed?.rss?.channel?.item).map((item) => ({
    source: sourceLabel(sourceUrl),
    sourceType: "rss",
    title: item?.title || "",
    url: item?.link || item?.guid || "",
    publishedAt: item?.pubDate || item?.published || item?.updated || "",
    description: item?.description || item?.["content:encoded"] || "",
  }));
  return items.filter((item) => item.url);
}

function parseSitemap(xmlText, sourceUrl) {
  const parsed = parser.parse(xmlText);
  const urls = toArray(parsed?.urlset?.url).map((item) => ({
    source: sourceLabel(sourceUrl),
    sourceType: "sitemap",
    title: decodeURIComponent(String(item?.loc || "").split("/").pop() || "").replace(/-/g, " "),
    url: item?.loc || "",
    publishedAt: item?.lastmod || "",
    description: "",
  }));
  return urls.filter((item) => item.url);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function extractHtmlMeta(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function extractHtmlDate(html) {
  return extractHtmlMeta(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']publish-date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:updated_time["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ]);
}

function parseHtmlDocument(htmlText, sourceUrl, pageUrl = sourceUrl) {
  const title = extractHtmlMeta(htmlText, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title>([\s\S]*?)<\/title>/i,
  ]);

  const description = extractHtmlMeta(htmlText, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  const publishedAt = extractHtmlDate(htmlText);

  return {
    source: sourceLabel(sourceUrl),
    sourceType: "html",
    title,
    url: pageUrl,
    publishedAt,
    description,
  };
}

function extractHtmlLinks(htmlText, sourceUrl) {
  const baseUrl = new URL(sourceUrl);
  const links = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of htmlText.matchAll(anchorRegex)) {
    try {
      const href = new URL(match[1], baseUrl).toString();
      const text = stripTags(match[2]);
      if (!href.startsWith("http")) continue;
      if (new URL(href).host !== baseUrl.host) continue;
      if (seen.has(href)) continue;
      if (text.length < 20 || text.length > 220) continue;
      if (/\/search|\/login|\/@@|mailto:|javascript:/i.test(href)) continue;
      seen.add(href);
      links.push({ href, text });
      if (links.length >= htmlLinkLimit) break;
    } catch {
      // Ignora hrefs invalidos
    }
  }

  return links;
}

function parseFeed(text, url) {
  if (text.includes("<rss") || text.includes("<feed")) {
    return { kind: "xml", items: parseRss(text, url) };
  }
  if (text.includes("<urlset")) {
    return { kind: "xml", items: parseSitemap(text, url) };
  }
  if (/<html[\s>]|<!doctype html/i.test(text)) {
    return { kind: "html", items: [], links: extractHtmlLinks(text, url), page: parseHtmlDocument(text, url) };
  }
  return { kind: "unknown", items: [] };
}

async function collectHtmlItems(sourceUrl, htmlText) {
  const parsed = parseFeed(htmlText, sourceUrl);
  const items = [];
  const errors = [];

  if (parsed.page?.url && parsed.page?.title) {
    items.push(parsed.page);
  }

  const settled = await Promise.allSettled(
    (parsed.links || []).map(async ({ href }) => {
      const text = await fetchText(href);
      if (!/<html[\s>]|<!doctype html/i.test(text)) return null;
      const item = parseHtmlDocument(text, sourceUrl, href);
      return item.title ? item : null;
    })
  );

  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled" && result.value) {
      items.push(result.value);
    } else if (result.status === "rejected") {
      errors.push({ source: parsed.links[index].href, error: result.reason?.message || String(result.reason) });
    }
  }

  return { items, errors };
}

async function collectItems(sources) {
  const settled = await Promise.allSettled(
    sources.map(async (url) => {
      const text = await fetchText(url);
      const parsed = parseFeed(text, url);
      if (parsed.kind === "html") {
        return collectHtmlItems(url, text);
      }
      return { items: parsed.items, errors: [] };
    })
  );

  const items = [];
  const errors = [];

  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      errors.push(...result.value.errors);
    } else {
      errors.push({ source: sources[index], error: result.reason?.message || String(result.reason) });
    }
  }

  return { items, errors };
}

function filterRelevantItems(items, analysisDate, timezone) {
  const seen = new Set();
  const relevant = [];

  for (const item of items) {
    const url = String(item.url || "").trim();
    if (!url || seen.has(url)) continue;

    const haystack = normalizeText(`${item.title} ${item.description} ${item.url}`);
    const matchedKeywords = keywordRules.filter((keyword) => haystack.includes(normalizeText(keyword)));
    if (!matchedKeywords.length) continue;

    let dateKey = "";
    if (item.publishedAt) {
      const parsedDate = new Date(item.publishedAt);
      if (!Number.isNaN(parsedDate.getTime())) {
        dateKey = getDateKey(parsedDate, timezone);
      }
    }

    if (item.sourceType === "rss" && dateKey && dateKey !== analysisDate) continue;
    if (item.sourceType === "sitemap" && dateKey && dateKey !== analysisDate) continue;
    if (item.sourceType === "sitemap" && !dateKey) continue;
    if (item.sourceType === "html" && (!dateKey || dateKey !== analysisDate)) continue;

    seen.add(url);
    relevant.push({
      source: item.source,
      title: item.title,
      url,
      publishedAt: item.publishedAt,
      description: item.description,
      matchedKeywords,
      analysisWindow: analysisDate,
    });
  }

  return relevant;
}

function extractJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("A resposta da OpenAI nao contem JSON valido");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function analyzeWithOpenAI(items, analysisDate) {
  const client = new OpenAI({ apiKey: config.openAiApiKey });

  const completion = await client.chat.completions.create({
    model: config.openAiModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "Voce analisa noticias e paginas para o portal Educamundo com foco em servidor publico. Responda sempre em JSON valido, sem markdown e sem texto fora do JSON. Retorne um objeto com os campos analysisWindow, resumo_executivo, oportunidades_gerais e analysis. analysis deve ser um array. oportunidades_gerais deve ser sempre um array de strings. Para cada item, retorne: titulo, url, fonte, data, tema, resumo, impacto_para_servidor, classificacao, como_aproveitar_no_educamundo, acao_sugerida, prioridade. classificacao deve ser exatamente ajuda_o_servidor, prejudica_o_servidor ou neutro. acao_sugerida deve ser exatamente criar_artigo, criar_curso, atualizar_curso_existente, criar_campanha ou somente_monitorar. prioridade deve ser exatamente alta, media ou baixa.",
      },
      {
        role: "user",
        content: `Janela de analise: ${analysisDate}. Analise os itens abaixo, um por um, com foco em impacto para servidor publico e em como o Educamundo pode aproveitar editorialmente e comercialmente. Se nao houver itens, devolva JSON com resumo_executivo explicando que nao houve novidades relevantes, oportunidades_gerais vazia e analysis vazia. Itens: ${JSON.stringify(items, null, 2)}`,
      },
    ],
  });

  const content = completion.choices?.[0]?.message?.content || "{}";
  return extractJson(content);
}

function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const expected = `Bearer ${config.sharedToken}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: "Nao autorizado" });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "radar-servidor-app" });
});

app.post("/radar-servidor", checkAuth, async (req, res) => {
  try {
    assertConfig();

    const analysisDate = resolveAnalysisDate(req.body?.date, config.timezone);
    const sources = Array.isArray(req.body?.sources) && req.body.sources.length
      ? req.body.sources
      : config.defaultSources;

    const { items: collectedItems, errors } = await collectItems(sources);
    const relevantItems = filterRelevantItems(collectedItems, analysisDate, config.timezone);
    const analysis = await analyzeWithOpenAI(relevantItems, analysisDate);

    res.json({
      analysisWindow: analysis.analysisWindow || analysisDate,
      requestedAt: new Date().toISOString(),
      totalCollected: collectedItems.length,
      totalRelevant: relevantItems.length,
      sources,
      sourceErrors: errors,
      resumo_executivo: analysis.resumo_executivo || "",
      oportunidades_gerais: Array.isArray(analysis.oportunidades_gerais)
        ? analysis.oportunidades_gerais
        : analysis.oportunidades_gerais
          ? [String(analysis.oportunidades_gerais)]
          : [],
      analysis: Array.isArray(analysis.analysis) ? analysis.analysis : [],
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Erro interno",
    });
  }
});

app.listen(config.port, () => {
  console.log(`Radar Servidor app listening on port ${config.port}`);
});
