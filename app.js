const STORAGE_KEY = "post-inserter-state-v6";
const DEFAULT_IMAGE = "assets/default-creative.svg";

const seedState = {
  target: {
    adAccountId: "",
    campaignId: "",
    adsetId: "",
    ruleId: "",
    adNamePattern: "ADV - {platform} - {post}"
  },
  filters: {
    account: "",
    campaign: "",
    adset: "",
    rule: ""
  },
  createActive: false,
  activePlatform: "Facebook",
  sourceId: "",
  selectedIds: [],
  queue: [],
  adAccounts: [],
  campaigns: [],
  adsets: [],
  rules: [],
  facebookPages: [],
  instagramAccounts: [],
  sourcesMode: "configured",
  sourcesNote: "",
  publishedPosts: [],
  postsError: "",
  loading: {
    config: false,
    campaigns: false,
    adsets: false,
    rules: false,
    posts: false,
    creating: false
  },
  results: []
};

let state = structuredClone(seedState);
let visiblePostIds = [];

const els = {
  summaryAccount: document.querySelector("#summaryAccount"),
  summaryCampaign: document.querySelector("#summaryCampaign"),
  summaryAdset: document.querySelector("#summaryAdset"),
  metricAvailable: document.querySelector("#metricAvailable"),
  metricSelected: document.querySelector("#metricSelected"),
  metricQueued: document.querySelector("#metricQueued"),
  adAccountSelect: document.querySelector("#adAccountSelect"),
  campaignSelect: document.querySelector("#campaignSelect"),
  adsetSelect: document.querySelector("#adsetSelect"),
  ruleSelect: document.querySelector("#ruleSelect"),
  accountSearch: document.querySelector("#accountSearch"),
  campaignSearch: document.querySelector("#campaignSearch"),
  adsetSearch: document.querySelector("#adsetSearch"),
  ruleSearch: document.querySelector("#ruleSearch"),
  adNamePattern: document.querySelector("#adNamePattern"),
  destinationPanel: document.querySelector("#destinationPanel"),
  pathAccount: document.querySelector("#pathAccount"),
  pathCampaign: document.querySelector("#pathCampaign"),
  pathAdset: document.querySelector("#pathAdset"),
  pathRule: document.querySelector("#pathRule"),
  sourceSelect: document.querySelector("#sourceSelect"),
  sourceNote: document.querySelector("#sourceNote"),
  searchInput: document.querySelector("#searchInput"),
  postLibrary: document.querySelector("#postLibrary"),
  queueList: document.querySelector("#queueList"),
  resultCard: document.querySelector("#resultCard"),
  resultList: document.querySelector("#resultList"),
  exportDialog: document.querySelector("#exportDialog"),
  exportOutput: document.querySelector("#exportOutput"),
  activeStatusCheckbox: document.querySelector("#activeStatusCheckbox"),
  createAdsBtn: document.querySelector("#createAdsBtn"),
  createAdsBtnBottom: document.querySelector("#createAdsBtnBottom")
};

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Errore API locale");
  }
  return payload;
}

async function loadConfig() {
  setLoading("config", true);
  render();

  try {
    const config = await api("/api/meta/config");
    state.adAccounts = config.adAccounts || [];
    state.facebookPages = config.facebookPages || [];
    state.instagramAccounts = config.instagramAccounts || [];
    state.sourcesMode = "configured";
    state.sourcesNote = "Fonti configurate manualmente.";

    if (!state.target.adAccountId && state.adAccounts.length) state.target.adAccountId = state.adAccounts[0].id;
    if (!state.sourceId) state.sourceId = state.facebookPages[0]?.id || state.instagramAccounts[0]?.id || "";

    if (config.adAccountsError) showEmpty(els.postLibrary, `Account pubblicitari non disponibili: ${config.adAccountsError}`);

    render();
    await loadSources();
    await Promise.all([loadCampaigns(), loadRules(), loadPosts()]);
  } catch (error) {
    showEmpty(els.postLibrary, `Non riesco a leggere Meta: ${error.message}`);
  } finally {
    setLoading("config", false);
    render();
  }
}

async function loadSources() {
  if (!state.target.adAccountId) return;
  setLoading("posts", true);
  render();

  try {
    const payload = await api(`/api/meta/sources?accountId=${encodeURIComponent(state.target.adAccountId)}`);
    state.facebookPages = payload.facebookPages || [];
    state.instagramAccounts = payload.instagramAccounts || [];
    state.sourcesMode = payload.mode || "configured";
    state.sourcesNote = payload.note || "";
    state.sourceId = "";
    state.selectedIds = [];
  } catch (error) {
    state.sourcesNote = `Fonti non aggiornate: ${error.message}`;
  } finally {
    setLoading("posts", false);
    render();
  }
}

async function loadCampaigns() {
  if (!state.target.adAccountId) return;
  setLoading("campaigns", true);
  render();

  try {
    const payload = await api(`/api/meta/campaigns?accountId=${encodeURIComponent(state.target.adAccountId)}`);
    state.campaigns = payload.data || [];
    if (!state.campaigns.some((campaign) => campaign.id === state.target.campaignId)) {
      state.target.campaignId = state.campaigns[0]?.id || "";
    }
    render();
    await loadAdsets();
  } catch (error) {
    state.campaigns = [];
    showEmpty(els.postLibrary, `Campagne non disponibili: ${error.message}`);
  } finally {
    setLoading("campaigns", false);
    render();
  }
}

async function loadAdsets() {
  if (!state.target.adAccountId) return;
  setLoading("adsets", true);
  render();

  try {
    const params = new URLSearchParams({ accountId: state.target.adAccountId });
    if (state.target.campaignId) params.set("campaignId", state.target.campaignId);
    const payload = await api(`/api/meta/adsets?${params}`);
    state.adsets = payload.data || [];
    if (!state.adsets.some((adset) => adset.id === state.target.adsetId)) {
      state.target.adsetId = state.adsets[0]?.id || "";
    }
    state.queue = state.queue.map((post) => ({ ...post, adsetId: state.target.adsetId || post.adsetId }));
  } catch {
    state.adsets = [];
  } finally {
    setLoading("adsets", false);
    render();
  }
}

async function loadRules() {
  if (!state.target.adAccountId) return;
  setLoading("rules", true);
  render();

  try {
    const payload = await api(`/api/meta/rules?accountId=${encodeURIComponent(state.target.adAccountId)}`);
    state.rules = payload.data || [];
    if (!state.rules.some((rule) => rule.id === state.target.ruleId)) {
      state.target.ruleId = state.rules[0]?.id || "";
    }
  } catch {
    state.rules = [];
  } finally {
    setLoading("rules", false);
    render();
  }
}

async function loadPosts() {
  setLoading("posts", true);
  render();

  try {
    const sources = currentSources();
    if (!sources.length) {
      state.publishedPosts = [];
      state.postsError = "";
      return;
    }

    if (!state.sourceId || !sources.some((source) => source.id === state.sourceId)) state.sourceId = sources[0].id;

    const source = sources.find((item) => item.id === state.sourceId);
    const endpoint = state.activePlatform === "Facebook"
      ? `/api/meta/facebook-posts?pageId=${encodeURIComponent(source.id)}`
      : `/api/meta/instagram-media?instagramId=${encodeURIComponent(source.id)}${source.pageId ? `&pageId=${encodeURIComponent(source.pageId)}` : ""}`;
    const payload = await api(endpoint);
    state.publishedPosts = (payload.data || []).map((post) => normalizePublishedPost(post, source));
    state.selectedIds = [];
    state.postsError = "";
  } catch (error) {
    state.publishedPosts = [];
    state.postsError = `Post non disponibili: ${error.message}`;
  } finally {
    setLoading("posts", false);
    render();
  }
}

function normalizePublishedPost(post, source) {
  if (state.activePlatform === "Instagram") {
    const caption = post.caption || "Post Instagram senza caption";
    return {
      id: `ig-${post.id}`,
      platform: "Instagram",
      sourcePostId: post.id,
      sourceAccountId: source.id,
      sourceLabel: source.label,
      pageId: source.pageId || "",
      permalink: post.permalink || "",
      adName: `ADV - IG - ${caption.slice(0, 42)}`,
      caption,
      thumbnail: post.thumbnail_url || post.media_url || DEFAULT_IMAGE,
      publishedAt: post.timestamp || ""
    };
  }

  const caption = post.message || post.attachments?.data?.[0]?.title || "Post Facebook senza testo";
  return {
    id: `fb-${post.id}`,
    platform: "Facebook",
    sourcePostId: post.id,
    sourceAccountId: source.id,
    sourceLabel: source.label,
    permalink: post.permalink_url || "",
    adName: `ADV - FB - ${caption.slice(0, 42)}`,
    caption,
    thumbnail: post.full_picture || DEFAULT_IMAGE,
    publishedAt: post.created_time || ""
  };
}

function render() {
  renderSelectOptions();
  syncInputs();
  renderSummary();
  renderDestinationPanel();
  renderLibrary();
  renderQueue();
  renderResults();
}

function renderSelectOptions() {
  setOptions(els.adAccountSelect, visibleItems(state.adAccounts, state.filters.account, accountText, state.target.adAccountId), state.loading.config ? "Carico account..." : "Nessun account", (account) => `${account.name} (${account.id})`);
  setOptions(els.campaignSelect, visibleItems(state.campaigns, state.filters.campaign, campaignText, state.target.campaignId), state.loading.campaigns ? "Carico campagne..." : "Nessuna campagna", (campaign) => `${campaign.name} | ${campaign.effective_status || campaign.status || ""}`);
  setOptions(els.adsetSelect, visibleItems(state.adsets, state.filters.adset, adsetText, state.target.adsetId), state.loading.adsets ? "Carico gruppi..." : "Nessun gruppo inserzioni", (adset) => `${adset.name} | ${adset.effective_status || adset.status || ""}`);
  setOptions(els.ruleSelect, visibleItems(state.rules, state.filters.rule, ruleText, state.target.ruleId), state.loading.rules ? "Carico regole..." : "Nessuna regola", (rule) => rule.name);
  setOptions(els.sourceSelect, currentSources(), state.loading.posts ? "Carico fonti..." : "Nessuna fonte", (source) => `${source.label} (${source.id})`);
}

function setOptions(select, items, emptyLabel, labelFor) {
  select.innerHTML = "";
  if (!items.length) {
    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>`;
    return;
  }
  select.innerHTML = items.map((item) => `<option value="${item.id}">${escapeHtml(labelFor(item))}</option>`).join("");
}

function filteredItems(items, search, textFor) {
  const needle = search.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => textFor(item).toLowerCase().includes(needle));
}

function visibleItems(items, search, textFor, selectedId) {
  const filtered = filteredItems(items, search, textFor);
  if (!selectedId || filtered.some((item) => item.id === selectedId)) return filtered;
  const selected = items.find((item) => item.id === selectedId);
  return selected ? [selected, ...filtered] : filtered;
}

function syncInputs() {
  els.adAccountSelect.value = state.target.adAccountId;
  els.campaignSelect.value = state.target.campaignId;
  els.adsetSelect.value = state.target.adsetId;
  els.ruleSelect.value = state.target.ruleId;
  els.accountSearch.value = state.filters.account;
  els.campaignSearch.value = state.filters.campaign;
  els.adsetSearch.value = state.filters.adset;
  els.ruleSearch.value = state.filters.rule;
  els.sourceSelect.value = state.sourceId;
  els.adNamePattern.value = state.target.adNamePattern;
  els.activeStatusCheckbox.checked = state.createActive;
  els.sourceNote.textContent = state.sourcesNote || "";
  els.sourceNote.classList.toggle("business", state.sourcesMode === "business");
}

function renderSummary() {
  els.summaryAccount.textContent = selectedAccount()?.name || "Non selezionato";
  els.summaryCampaign.textContent = selectedCampaign()?.name || "Non selezionata";
  els.summaryAdset.textContent = selectedAdset()?.name || "Non selezionato";
  els.metricAvailable.textContent = state.publishedPosts.length;
  els.metricSelected.textContent = state.selectedIds.length;
  els.metricQueued.textContent = state.queue.length;
  const canCreate = state.queue.length > 0 && state.target.adAccountId && state.target.adsetId && !state.loading.creating;
  const createLabel = state.createActive ? "Crea inserzioni attive" : "Crea inserzioni in pausa";
  els.createAdsBtn.disabled = !canCreate;
  els.createAdsBtnBottom.disabled = !canCreate;
  els.createAdsBtn.textContent = state.loading.creating ? "Creo..." : createLabel;
  els.createAdsBtnBottom.textContent = state.loading.creating ? "Creo..." : createLabel;
}

function renderDestinationPanel() {
  updatePath(els.pathAccount, "Account", selectedAccount()?.name || "Da scegliere", Boolean(state.target.adAccountId));
  updatePath(els.pathCampaign, "Campagna", selectedCampaign()?.name || "Da scegliere", Boolean(state.target.campaignId));
  updatePath(els.pathAdset, "Gruppo", selectedAdset()?.name || "Da scegliere", Boolean(state.target.adsetId));
  updatePath(els.pathRule, "Regola", selectedRule()?.name || "Facoltativa", Boolean(state.target.ruleId));

  const account = selectedAccount();
  const campaign = selectedCampaign();
  const adset = selectedAdset();
  const rule = selectedRule();

  els.destinationPanel.innerHTML = `
    <article>
      <span>Account scelto</span>
      <strong>${escapeHtml(account?.name || "Non selezionato")}</strong>
      <p>${escapeHtml(account ? `${account.id} | ${account.currency || "valuta n/d"} | ${account.timezone_name || "timezone n/d"}` : "Scegli l'account pubblicitario da usare.")}</p>
    </article>
    <article>
      <span>Campagna</span>
      <strong>${escapeHtml(campaign?.name || "Non selezionata")}</strong>
      <p>${escapeHtml(campaign ? `${campaign.effective_status || campaign.status || "stato n/d"} | ${campaign.objective || "obiettivo n/d"}` : "Poi scegli la campagna di destinazione.")}</p>
    </article>
    <article>
      <span>Gruppo inserzioni</span>
      <strong>${escapeHtml(adset?.name || "Non selezionato")}</strong>
      <p>${escapeHtml(adset ? `${adset.effective_status || adset.status || "stato n/d"} | budget ${formatBudget(adset)}` : "Questo e il punto in cui verranno create le nuove inserzioni.")}</p>
    </article>
    <article>
      <span>Regola</span>
      <strong>${escapeHtml(rule?.name || "Nessuna regola")}</strong>
      <p>${escapeHtml(rule ? "Sara applicata dopo la creazione, se la regola accetta ID inserzione." : "Puoi creare anche senza regola.")}</p>
    </article>
  `;
}

function updatePath(element, label, value, done) {
  element.classList.toggle("done", done);
  element.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
}

function renderLibrary() {
  if (state.loading.posts) {
    showEmpty(els.postLibrary, "Carico post pubblicati...");
    return;
  }

  if (state.postsError) {
    showEmpty(els.postLibrary, state.postsError);
    return;
  }

  document.querySelectorAll("[data-platform-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.platformTab === state.activePlatform);
  });

  const filteredPosts = getFilteredPosts();
  visiblePostIds = filteredPosts.map((post) => post.id);
  els.postLibrary.innerHTML = "";

  if (!filteredPosts.length) {
    showEmpty(els.postLibrary, "Nessun post trovato.");
    return;
  }

  filteredPosts.forEach((post) => {
    const queued = isQueued(post.id);
    const selected = state.selectedIds.includes(post.id);
    const item = document.createElement("article");
    item.className = `library-item${selected ? " selected" : ""}${queued ? " queued" : ""}`;
    item.innerHTML = `
      <label class="select-box" aria-label="Seleziona post">
        <input type="checkbox" data-action="select" data-id="${post.id}" ${selected ? "checked" : ""} ${queued ? "disabled" : ""}>
      </label>
      <img class="post-thumb" src="${post.thumbnail || DEFAULT_IMAGE}" alt="">
      <div class="post-copy">
        <div class="post-line">
          <strong>${escapeHtml(post.adName)}</strong>
          <span class="platform ${post.platform.toLowerCase()}">${post.platform}</span>
        </div>
        <p>${escapeHtml(post.caption)}</p>
        <span>ID: ${escapeHtml(post.sourcePostId)} | ${formatDate(post.publishedAt)} | ${escapeHtml(post.sourceLabel || "")}</span>
      </div>
      <div class="post-actions">
        <a class="secondary-link" href="${post.permalink}" target="_blank" rel="noreferrer">Apri</a>
        <button class="secondary-button" type="button" data-action="queue-one" data-id="${post.id}" ${queued || !state.target.adsetId ? "disabled" : ""}>${queued ? "In coda" : "Aggiungi"}</button>
      </div>
    `;
    els.postLibrary.appendChild(item);
  });
}

function renderQueue() {
  els.queueList.innerHTML = "";
  if (!state.queue.length) {
    showEmpty(els.queueList, "Aggiungi almeno un post dalla libreria.");
    return;
  }

  state.queue.forEach((post) => {
    const item = document.createElement("article");
    item.className = "queue-item";
    item.innerHTML = `
      <img class="post-thumb" src="${post.thumbnail || DEFAULT_IMAGE}" alt="">
      <div class="post-copy">
        <label>
          Nome inserzione
          <input type="text" data-action="queue-ad-name" data-id="${post.id}" value="${escapeHtml(post.adName)}">
        </label>
        <span>${escapeHtml(post.platform)} | ${escapeHtml(post.sourcePostId)}</span>
        <span class="rule-note">${escapeHtml(selectedRule(post.ruleId)?.name || "Nessuna regola selezionata")}</span>
      </div>
      <button class="ghost-button" type="button" data-action="remove-queue" data-id="${post.id}">Rimuovi</button>
    `;
    els.queueList.appendChild(item);
  });
}

function renderResults() {
  els.resultCard.hidden = !state.results.length;
  els.resultList.innerHTML = "";
  state.results.forEach((result) => {
    const item = document.createElement("article");
    item.className = `result-item ${result.ok ? "ok" : "error"}`;
    const ruleMessage = result.ruleMessage ? `<span>${escapeHtml(result.ruleMessage)}</span>` : "";
    item.innerHTML = result.ok
      ? `<strong>Creata: ${escapeHtml(result.adName)}</strong><span>Ad ID: ${escapeHtml(result.adId)} | Creative ID: ${escapeHtml(result.creativeId)}</span>${ruleMessage}`
      : `<strong>Errore: ${escapeHtml(result.adName)}</strong><span>${escapeHtml(result.error)}</span>`;
    els.resultList.appendChild(item);
  });
}

function showEmpty(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function getFilteredPosts() {
  const search = els.searchInput.value.trim().toLowerCase();
  return state.publishedPosts.filter((post) => {
    const haystack = `${post.adName} ${post.caption} ${post.sourcePostId} ${post.permalink}`.toLowerCase();
    return !search || haystack.includes(search);
  });
}

function queuePosts(postIds) {
  const postsToAdd = state.publishedPosts
    .filter((post) => postIds.includes(post.id) && !isQueued(post.id))
    .map((post) => ({
      ...post,
      adName: buildAdName(post),
      adsetId: state.target.adsetId,
      ruleId: state.target.ruleId
    }));
  state.queue = [...state.queue, ...postsToAdd];
  state.selectedIds = state.selectedIds.filter((id) => !postIds.includes(id));
  render();
}

async function createAds() {
  if (!state.queue.length || !state.target.adAccountId || !state.target.adsetId) return;

  setLoading("creating", true);
  state.results = [];
  render();

  try {
    const payload = {
      adAccountId: state.target.adAccountId,
      status: state.createActive ? "ACTIVE" : "PAUSED",
      ads: state.queue.map((post) => ({
        id: post.id,
        adName: post.adName,
        platform: post.platform,
        sourcePostId: post.sourcePostId,
        adsetId: post.adsetId,
        ruleId: post.ruleId,
        pageId: post.platform === "Facebook" ? post.sourceAccountId : post.pageId || null,
        instagramAccountId: post.platform === "Instagram" ? post.sourceAccountId : null
      }))
    };
    const result = await api("/api/meta/create-ads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.results = result.data || [];
    state.queue = state.queue.filter((post) => !state.results.some((resultItem) => resultItem.ok && resultItem.localId === post.id));
  } catch (error) {
    state.results = [{ ok: false, adName: "Batch", error: error.message }];
  } finally {
    setLoading("creating", false);
    render();
    els.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function exportBatch() {
  const payload = {
    destination: {
      ad_account_name: selectedAccount()?.name || null,
      ad_account_id: state.target.adAccountId,
      campaign_name: selectedCampaign()?.name || null,
      campaign_id: state.target.campaignId,
      adset_name: selectedAdset()?.name || null,
      adset_id: state.target.adsetId,
      default_rule_name: selectedRule()?.name || null,
      default_rule_id: state.target.ruleId
    },
    ads_to_create: state.queue.map((post) => ({
      ad_name: post.adName,
      adset_id: post.adsetId,
      rule_id: post.ruleId,
      rule_name: selectedRule(post.ruleId)?.name || null,
      platform: post.platform,
      source_post_id: post.platform === "Facebook" ? post.sourcePostId : null,
      instagram_media_id: post.platform === "Instagram" ? post.sourcePostId : null,
      status: state.createActive ? "ACTIVE" : "PAUSED"
    }))
  };
  els.exportOutput.value = JSON.stringify(payload, null, 2);
  els.exportDialog.showModal();
}

function setLoading(key, value) {
  state.loading[key] = value;
}

function currentSources() {
  return state.activePlatform === "Facebook" ? state.facebookPages : state.instagramAccounts;
}

function selectedAccount() {
  return state.adAccounts.find((account) => account.id === state.target.adAccountId);
}

function selectedCampaign() {
  return state.campaigns.find((campaign) => campaign.id === state.target.campaignId);
}

function selectedAdset() {
  return state.adsets.find((adset) => adset.id === state.target.adsetId);
}

function selectedRule(ruleId = state.target.ruleId) {
  return state.rules.find((rule) => rule.id === ruleId);
}

function accountText(account) {
  return `${account.name} ${account.id} ${account.currency || ""} ${account.timezone_name || ""}`;
}

function campaignText(campaign) {
  return `${campaign.name} ${campaign.id} ${campaign.effective_status || ""} ${campaign.status || ""} ${campaign.objective || ""}`;
}

function adsetText(adset) {
  return `${adset.name} ${adset.id} ${adset.effective_status || ""} ${adset.status || ""} ${adset.optimization_goal || ""}`;
}

function ruleText(rule) {
  return `${rule.name} ${rule.id} ${rule.status || ""}`;
}

function isQueued(postId) {
  return state.queue.some((post) => post.id === postId);
}

function buildAdName(post) {
  const shortPost = post.adName.replace(/^ADV\s*-\s*/i, "").trim();
  return state.target.adNamePattern
    .replaceAll("{platform}", post.platform)
    .replaceAll("{post}", shortPost || post.sourcePostId)
    .replaceAll("{id}", post.sourcePostId);
}

function formatDate(value) {
  if (!value) return "data non importata";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBudget(adset) {
  const amount = adset.daily_budget || adset.lifetime_budget;
  if (!amount) return "n/d";
  const currency = selectedAccount()?.currency || "EUR";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(Number(amount) / 100);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.adAccountSelect.addEventListener("change", async () => {
  state.target.adAccountId = els.adAccountSelect.value;
  state.target.campaignId = "";
  state.target.adsetId = "";
  state.target.ruleId = "";
  state.filters.campaign = "";
  state.filters.adset = "";
  state.filters.rule = "";
  state.queue = [];
  await loadSources();
  await Promise.all([loadCampaigns(), loadRules(), loadPosts()]);
});

els.campaignSelect.addEventListener("change", async () => {
  state.target.campaignId = els.campaignSelect.value;
  state.target.adsetId = "";
  state.queue = [];
  await loadAdsets();
});

[els.adsetSelect, els.ruleSelect, els.adNamePattern].forEach((input) => {
  input.addEventListener("change", () => {
    state.target.adsetId = els.adsetSelect.value;
    state.target.ruleId = els.ruleSelect.value;
    state.target.adNamePattern = els.adNamePattern.value.trim() || "ADV - {platform} - {post}";
    state.queue = state.queue.map((post) => ({ ...post, adsetId: state.target.adsetId, ruleId: state.target.ruleId }));
    render();
  });
  input.addEventListener("input", () => {
    state.target.adNamePattern = els.adNamePattern.value.trim() || "ADV - {platform} - {post}";
  });
});

els.sourceSelect.addEventListener("change", async () => {
  state.sourceId = els.sourceSelect.value;
  state.selectedIds = [];
  await loadPosts();
});

els.searchInput.addEventListener("input", render);
[
  [els.accountSearch, "account"],
  [els.campaignSearch, "campaign"],
  [els.adsetSearch, "adset"],
  [els.ruleSearch, "rule"]
].forEach(([input, key]) => {
  input.addEventListener("input", () => {
    state.filters[key] = input.value;
    render();
  });
});

document.querySelector("#refreshTargetBtn").addEventListener("click", async () => {
  await loadSources();
  await Promise.all([loadCampaigns(), loadRules(), loadPosts()]);
});

document.querySelector("#renameQueueBtn").addEventListener("click", () => {
  state.queue = state.queue.map((post) => ({ ...post, adName: buildAdName(post) }));
  render();
});
document.querySelector("#queueSelectedBtn").addEventListener("click", () => queuePosts(state.selectedIds));
document.querySelector("#selectVisibleBtn").addEventListener("click", () => {
  state.selectedIds = visiblePostIds.filter((id) => !isQueued(id));
  render();
});
document.querySelector("#clearQueueBtn").addEventListener("click", () => {
  state.queue = [];
  state.selectedIds = [];
  render();
});
els.createAdsBtn.addEventListener("click", createAds);
els.createAdsBtnBottom.addEventListener("click", createAds);
els.activeStatusCheckbox.addEventListener("change", () => {
  state.createActive = els.activeStatusCheckbox.checked;
  renderSummary();
});
document.querySelector("#exportBtn").addEventListener("click", exportBatch);
document.querySelector("#copyExportBtn").addEventListener("click", async () => navigator.clipboard.writeText(els.exportOutput.value));

document.querySelectorAll("[data-platform-tab]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.activePlatform = button.dataset.platformTab;
    state.sourceId = "";
    state.selectedIds = [];
    await loadPosts();
  });
});

els.postLibrary.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.dataset.action === "select") {
    if (target.checked && !state.selectedIds.includes(target.dataset.id)) state.selectedIds.push(target.dataset.id);
    if (!target.checked) state.selectedIds = state.selectedIds.filter((id) => id !== target.dataset.id);
    render();
  }
  if (target.dataset.action === "queue-one") queuePosts([target.dataset.id]);
});

els.queueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='remove-queue']");
  if (!button) return;
  state.queue = state.queue.filter((post) => post.id !== button.dataset.id);
  render();
});

els.queueList.addEventListener("input", (event) => {
  const target = event.target.closest("[data-action='queue-ad-name']");
  if (!target) return;
  state.queue = state.queue.map((post) => post.id === target.dataset.id ? { ...post, adName: target.value.trim() } : post);
  renderSummary();
});

render();
loadConfig();
