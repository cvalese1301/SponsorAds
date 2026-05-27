const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const env = loadEnv(path.join(ROOT, ".env"));
const API_VERSION = env.META_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return acc;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function parseNamedIds(value) {
  if (!value) return [];
  return value.split(",").map((item) => {
    const [label, id] = item.split(":");
    return { label: label.trim(), id: id.trim() };
  }).filter((item) => item.label && item.id);
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function token() {
  return env.META_ACCESS_TOKEN;
}

async function graph(pathname, params = {}, accessToken = token()) {
  if (!accessToken) {
    const error = new Error("META_ACCESS_TOKEN mancante nel file .env");
    error.status = 400;
    throw error;
  }

  const url = new URL(`${GRAPH_BASE}/${pathname.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `Errore Meta API ${response.status}`);
    error.status = response.status;
    error.meta = payload.error || payload;
    throw error;
  }

  return payload;
}

async function graphPost(pathname, params = {}, accessToken = token()) {
  if (!accessToken) {
    const error = new Error("META_ACCESS_TOKEN mancante nel file .env");
    error.status = 400;
    throw error;
  }

  const url = new URL(`${GRAPH_BASE}/${pathname.replace(/^\//, "")}`);
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  });
  body.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json();

  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `Errore Meta API ${response.status}`);
    error.status = response.status;
    error.meta = payload.error || payload;
    throw error;
  }

  return payload;
}

function pageTokenForId(pageId) {
  const page = parseNamedIds(env.META_FACEBOOK_PAGES).find((item) => item.id === pageId);
  if (!page) return null;
  return env[`META_PAGE_ACCESS_TOKEN_${page.label}`] || null;
}

function pageTokenForInstagramId(instagramId) {
  const instagram = parseNamedIds(env.META_INSTAGRAM_ACCOUNTS).find((item) => item.id === instagramId);
  if (!instagram) return null;
  return env[`META_PAGE_ACCESS_TOKEN_${instagram.label}`] || null;
}

function pageForInstagramId(instagramId) {
  const instagram = parseNamedIds(env.META_INSTAGRAM_ACCOUNTS).find((item) => item.id === instagramId);
  if (!instagram) return null;
  return parseNamedIds(env.META_FACEBOOK_PAGES).find((item) => item.label === instagram.label) || null;
}

async function dynamicPageTokenForId(pageId) {
  if (!pageId) return null;
  try {
    const page = await graph(`/${pageId}`, { fields: "access_token" });
    return page.access_token || null;
  } catch {
    return null;
  }
}

function configuredSources() {
  return {
    facebookPages: parseNamedIds(env.META_FACEBOOK_PAGES),
    instagramAccounts: parseNamedIds(env.META_INSTAGRAM_ACCOUNTS)
  };
}

function dedupeById(items) {
  return Array.from(new Map(items.filter((item) => item.id).map((item) => [item.id, item])).values());
}

function normalizeBusinessPage(page, sourceType) {
  return {
    id: page.id,
    label: page.name || page.username || page.id,
    name: page.name || page.username || "",
    sourceType
  };
}

function normalizeBusinessInstagram(page, sourceType) {
  const instagram = page.instagram_business_account;
  if (!instagram?.id) return null;
  return {
    id: instagram.id,
    label: instagram.username || instagram.name || page.name || instagram.id,
    name: instagram.name || instagram.username || "",
    pageId: page.id,
    pageName: page.name || "",
    sourceType
  };
}

async function listBusinessPages(businessId, edge, sourceType) {
  const payload = await graph(`/${businessId}/${edge}`, {
    fields: "id,name,username,instagram_business_account{id,username,name}",
    limit: "100"
  });
  const pages = payload.data || [];
  return {
    facebookPages: pages.map((page) => normalizeBusinessPage(page, sourceType)),
    instagramAccounts: pages.map((page) => normalizeBusinessInstagram(page, sourceType)).filter(Boolean)
  };
}

async function listSourcesForAdAccount(accountId) {
  const fallback = configuredSources();
  if (!accountId) return { ...fallback, mode: "configured", note: "Account pubblicitario non selezionato." };

  try {
    const account = await graph(`/${accountId}`, { fields: "id,name,business{id,name}" });
    const businessId = account.business?.id;
    if (!businessId) {
      return { ...fallback, mode: "configured", note: "Questo account non espone un Business Manager collegato: uso le fonti configurate." };
    }

    const collected = { facebookPages: [], instagramAccounts: [] };
    const errors = [];
    for (const [edge, sourceType] of [["owned_pages", "business_owned"], ["client_pages", "business_client"]]) {
      try {
        const sources = await listBusinessPages(businessId, edge, sourceType);
        collected.facebookPages.push(...sources.facebookPages);
        collected.instagramAccounts.push(...sources.instagramAccounts);
      } catch (error) {
        errors.push(`${edge}: ${error.message}`);
      }
    }

    const facebookPages = dedupeById(collected.facebookPages);
    const instagramAccounts = dedupeById(collected.instagramAccounts);
    if (!facebookPages.length && !instagramAccounts.length) {
      return {
        ...fallback,
        mode: "configured",
        note: errors.length ? `Meta non ha restituito pagine dal business: ${errors.join(" | ")}` : "Nessuna pagina business trovata: uso le fonti configurate."
      };
    }

    return {
      facebookPages,
      instagramAccounts,
      mode: "business",
      business: account.business,
      note: `Fonti prese dal Business Manager ${account.business.name || businessId}.`
    };
  } catch (error) {
    return { ...fallback, mode: "configured", note: `Non riesco a leggere il business dell'account: ${error.message}` };
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function listAdAccounts() {
  const payload = await graph("/me/adaccounts", {
    fields: "id,account_id,name,account_status,currency,timezone_name"
  });
  return payload.data || [];
}

async function findRule(accountId, ruleId) {
  if (!accountId || !ruleId) return null;
  const payload = await graph(`/${accountId}/adrules_library`, {
    fields: "id,name,evaluation_spec,execution_spec,schedule_spec,status,created_time,updated_time",
    limit: "100"
  });
  return (payload.data || []).find((rule) => rule.id === ruleId) || null;
}

function parseMetaJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return structuredClone(value);
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mergeAdIdsIntoEvaluationSpec(evaluationSpec, adIds) {
  const spec = parseMetaJson(evaluationSpec, {});
  const filters = Array.isArray(spec.filters) ? spec.filters : [];
  const adIdFilter = filters.find((filter) => filter.field === "ad.id" && filter.operator === "IN" && Array.isArray(filter.value));

  if (!adIdFilter) {
    return {
      updatedSpec: spec,
      changed: false,
      message: "Regola non aggiornata: questa regola non contiene una lista di ID inserzione modificabile."
    };
  }

  const existing = new Set(adIdFilter.value.map(String));
  adIds.map(String).forEach((id) => existing.add(id));
  const nextValue = Array.from(existing);
  const changed = nextValue.length !== adIdFilter.value.length;
  adIdFilter.value = nextValue;

  return {
    updatedSpec: spec,
    changed,
    message: changed
      ? "Regola applicata: ho aggiunto questa inserzione alla lista della regola."
      : "Regola gia applicata: questa inserzione era gia nella lista della regola."
  };
}

async function applyRuleToCreatedAds(accountId, ruleId, adIds) {
  if (!ruleId || !adIds.length) {
    return { applied: false, message: "Nessuna regola selezionata." };
  }

  const rule = await findRule(accountId, ruleId);
  if (!rule) {
    return { applied: false, message: "Regola non trovata nell'account pubblicitario selezionato." };
  }

  const merge = mergeAdIdsIntoEvaluationSpec(rule.evaluation_spec, adIds);
  if (!merge.changed) {
    return { applied: false, message: merge.message };
  }

  await graphPost(`/${ruleId}`, { evaluation_spec: merge.updatedSpec });
  return { applied: true, message: merge.message };
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/meta/create-ads" && req.method === "POST") {
      const body = await readJsonBody(req);
      const results = [];

      for (const post of body.ads || []) {
        try {
          const creativeParams = {
            name: post.adName,
            status: "ACTIVE"
          };

          if (post.platform === "Facebook") {
            creativeParams.object_story_id = post.sourcePostId;
          } else {
            const page = pageForInstagramId(post.instagramAccountId);
            creativeParams.object_id = page?.id || post.pageId;
            creativeParams.instagram_user_id = post.instagramAccountId;
            creativeParams.source_instagram_media_id = post.sourcePostId;
          }

          const creative = await graphPost(`/${body.adAccountId}/adcreatives`, creativeParams);
          const ad = await graphPost(`/${body.adAccountId}/ads`, {
            name: post.adName,
            adset_id: post.adsetId,
            creative: { creative_id: creative.id },
            status: body.status || "PAUSED"
          });

          results.push({
            ok: true,
            localId: post.id,
            adName: post.adName,
            platform: post.platform,
            adId: ad.id,
            creativeId: creative.id,
            ruleId: post.ruleId || null
          });
        } catch (error) {
          results.push({
            ok: false,
            localId: post.id,
            adName: post.adName,
            platform: post.platform,
            error: error.message,
            meta: error.meta || null
          });
        }
      }

      const createdByRule = results
        .filter((result) => result.ok && result.ruleId)
        .reduce((acc, result) => {
          acc[result.ruleId] ||= [];
          acc[result.ruleId].push(result.adId);
          return acc;
        }, {});

      for (const [ruleId, adIds] of Object.entries(createdByRule)) {
        try {
          const ruleResult = await applyRuleToCreatedAds(body.adAccountId, ruleId, adIds);
          results
            .filter((result) => result.ok && result.ruleId === ruleId)
            .forEach((result) => {
              result.ruleApplied = ruleResult.applied;
              result.ruleMessage = ruleResult.message;
            });
        } catch (error) {
          results
            .filter((result) => result.ok && result.ruleId === ruleId)
            .forEach((result) => {
              result.ruleApplied = false;
              result.ruleMessage = `Inserzione creata, ma regola non applicata: ${error.message}`;
              result.ruleMeta = error.meta || null;
            });
        }
      }

      return json(res, 200, { data: results });
    }

    if (url.pathname === "/api/meta/config") {
      let adAccounts = [];
      let adAccountsError = null;
      try {
        adAccounts = await listAdAccounts();
      } catch (error) {
        adAccountsError = error.message;
      }
      return json(res, 200, {
        apiVersion: API_VERSION,
        loginConfigId: env.META_LOGIN_CONFIG_ID || null,
        ...configuredSources(),
        adAccounts,
        adAccountsError
      });
    }

    if (url.pathname === "/api/meta/sources") {
      const accountId = url.searchParams.get("accountId");
      return json(res, 200, await listSourcesForAdAccount(accountId));
    }

    if (url.pathname === "/api/meta/adaccounts") {
      return json(res, 200, { data: await listAdAccounts() });
    }

    if (url.pathname === "/api/meta/campaigns") {
      const accountId = url.searchParams.get("accountId");
      const payload = await graph(`/${accountId}/campaigns`, {
        fields: "id,name,status,effective_status,objective,created_time,updated_time",
        limit: "100"
      });
      return json(res, 200, payload);
    }

    if (url.pathname === "/api/meta/adsets") {
      const accountId = url.searchParams.get("accountId");
      const campaignId = url.searchParams.get("campaignId");
      const filtering = campaignId ? JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]) : "";
      const payload = await graph(`/${accountId}/adsets`, {
        fields: "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal",
        filtering,
        limit: "100"
      });
      return json(res, 200, payload);
    }

    if (url.pathname === "/api/meta/rules") {
      const accountId = url.searchParams.get("accountId");
      const payload = await graph(`/${accountId}/adrules_library`, {
        fields: "id,name,evaluation_spec,execution_spec,schedule_spec,status,created_time,updated_time",
        limit: "100"
      });
      return json(res, 200, payload);
    }

    if (url.pathname === "/api/meta/facebook-posts") {
      const pageId = url.searchParams.get("pageId");
      const pageAccessToken = pageTokenForId(pageId) || await dynamicPageTokenForId(pageId);
      const payload = await graph(`/${pageId}/posts`, {
        fields: "id,message,permalink_url,created_time,full_picture,status_type,attachments{media_type,title,description,unshimmed_url}",
        limit: "50"
      }, pageAccessToken || token());
      return json(res, 200, payload);
    }

    if (url.pathname === "/api/meta/instagram-media") {
      const instagramId = url.searchParams.get("instagramId");
      const pageId = url.searchParams.get("pageId");
      const pageAccessToken = pageTokenForInstagramId(instagramId) || await dynamicPageTokenForId(pageId);
      const payload = await graph(`/${instagramId}/media`, {
        fields: "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url",
        limit: "50"
      }, pageAccessToken || token());
      return json(res, 200, payload);
    }

    return json(res, 404, { error: "Endpoint non trovato" });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message,
      meta: error.meta || null
    });
  }
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Post Inserter running on http://localhost:${PORT}`);
});
