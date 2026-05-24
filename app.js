const dataUrl = "assets-data.json";

const columns = [
  { key: "tokenSymbol", label: "Token" },
  { key: "underlyingSymbol", label: "Bolsa" },
  { key: "price", label: "Preço" },
  { key: "lastExDate", label: "Últ. ex" },
  { key: "lastPaymentDate", label: "Últ. pagamento" },
  { key: "lastDividendValue", label: "Últ. dividendo" },
  { key: "nextExDate", label: "Próx. ex" },
  { key: "nextPaymentDate", label: "Próx. pagamento" },
  { key: "nextDividendValue", label: "Próx. dividendo" }
];

const state = {
  assets: [],
  visible: [],
  sortKey: "tokenSymbol",
  sortDir: "asc",
  filters: {},
  loading: new Set(),
  cache: new Map(),
  quote: {
    loading: false,
    error: "",
    result: null
  }
};

const el = {
  updatedAt: document.getElementById("updatedAt"),
  totalCount: document.getElementById("totalCount"),
  visibleCount: document.getElementById("visibleCount"),
  loadedCount: document.getElementById("loadedCount"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearBtn: document.getElementById("clearBtn"),
  filtersPanel: document.getElementById("filtersPanel"),
  toggleFiltersBtn: document.getElementById("toggleFiltersBtn"),
  sortKey: document.getElementById("sortKey"),
  sortDirBtn: document.getElementById("sortDirBtn"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  cardList: document.getElementById("cardList"),
  cardTemplate: document.getElementById("cardTemplate"),
  swapQuoteForm: document.getElementById("swapQuoteForm"),
  swapInputMint: document.getElementById("swapInputMint"),
  swapOutputMint: document.getElementById("swapOutputMint"),
  swapAmount: document.getElementById("swapAmount"),
  swapQuoteBtn: document.getElementById("swapQuoteBtn"),
  swapQuoteStatus: document.getElementById("swapQuoteStatus"),
  swapQuoteResult: document.getElementById("swapQuoteResult"),
  swapQuoteAmount: document.getElementById("swapQuoteAmount"),
  swapQuoteSummary: document.getElementById("swapQuoteSummary"),
  swapQuotePrice: document.getElementById("swapQuotePrice"),
  swapQuoteSource: document.getElementById("swapQuoteSource"),
  swapQuoteInputLabel: document.getElementById("swapQuoteInputLabel"),
  swapQuoteOutputLabel: document.getElementById("swapQuoteOutputLabel"),
  swapTokenOptions: document.getElementById("swapTokenOptions"),
  titanEndpoint: document.getElementById("titanEndpoint"),
  saveTitanConfigBtn: document.getElementById("saveTitanConfigBtn")
};

const jupiterConfigStorageKey = "xstocks.jupiterQuoteConfig";
const defaultJupiterQuoteEndpoint = "https://lite-api.jup.ag/swap/v1/quote";
const localApiOrigin = "http://127.0.0.1:8000";
const solanaCoreTokens = [
  {
    platform: "Solana",
    tokenSymbol: "SOL",
    underlyingSymbol: "SOL",
    name: "Solana",
    address: "So11111111111111111111111111111111111111112",
    decimals: 9
  },
  {
    platform: "Solana",
    tokenSymbol: "USDC",
    underlyingSymbol: "USDC",
    name: "USD Coin",
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6
  },
  {
    platform: "Solana",
    tokenSymbol: "USDT",
    underlyingSymbol: "USDT",
    name: "Tether USD",
    address: "Es9vMFrzaCERmJfrF4H2FYD4GmT7ubPgpdnR86yj4cJ",
    decimals: 6
  }
];

function loadJupiterConfig() {
  try {
    const raw = localStorage.getItem(jupiterConfigStorageKey);
    if (!raw) return { endpoint: defaultJupiterQuoteEndpoint };
    const parsed = JSON.parse(raw);
    return {
      endpoint: String(parsed?.endpoint ?? defaultJupiterQuoteEndpoint)
    };
  } catch {
    return { endpoint: defaultJupiterQuoteEndpoint };
  }
}

function saveJupiterConfig(config) {
  localStorage.setItem(jupiterConfigStorageKey, JSON.stringify({
    endpoint: String(config.endpoint ?? "").trim()
  }));
}

const filterIds = [
  "filterToken",
  "filterUnderlying",
  "filterPlatform",
  "filterHasDividends",
  "priceMin",
  "priceMax",
  "lastExFrom",
  "lastExTo",
  "lastPayFrom",
  "lastPayTo",
  "lastDivMin",
  "lastDivMax",
  "nextExFrom",
  "nextExTo",
  "nextPayFrom",
  "nextPayTo",
  "nextDivMin",
  "nextDivMax"
];

const dateFields = new Set([
  "lastExDate",
  "lastPaymentDate",
  "nextExDate",
  "nextPaymentDate"
]);

const numericFields = new Set([
  "price",
  "lastDividendValue",
  "nextDividendValue"
]);

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[1]}-${match[2]}`;
  return null;
}

function formatDate(value) {
  const iso = parseDate(value);
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatMoney(value) {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

function formatPlain(value) {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Number(value));
}

function normalizeJupiterEndpoint(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function getJupiterConfigFromUi() {
  return {
    endpoint: normalizeJupiterEndpoint(el.titanEndpoint?.value) || defaultJupiterQuoteEndpoint
  };
}

function buildLocalApiUrl(path) {
  const apiPath = path.startsWith("/") ? path : `/${path}`;
  if (window.location.protocol === "file:") {
    return `${localApiOrigin}${apiPath}`;
  }
  if (window.location.hostname === "127.0.0.1" && window.location.port === "8000") {
    return apiPath;
  }
  return `${localApiOrigin}${apiPath}`;
}

function explainProxyFetchError(error) {
  if (error instanceof TypeError) {
    return `Nao foi possivel acessar o proxy local da Jupiter em ${localApiOrigin}. Inicie com "node scripts/serve.mjs" e abra ${localApiOrigin}.`;
  }
  return error?.message || "Falha ao consultar Jupiter.";
}

function normalizeContractAddress(value) {
  return String(value ?? "").trim();
}

function buildSwapTokenOption(token) {
  return {
    ...token,
    value: `${token.tokenSymbol} (${token.platform}) - ${token.address}`
  };
}

function getSwapTokenOptions() {
  const options = solanaCoreTokens.map(buildSwapTokenOption);
  state.assets.forEach((asset) => {
    const contract = getSolanaContract(asset);
    if (!contract?.address) return;
    options.push(buildSwapTokenOption({
      platform: asset.platform,
      tokenSymbol: asset.tokenSymbol,
      underlyingSymbol: asset.underlyingSymbol,
      name: asset.name || asset.underlyingSymbol,
      address: contract.address,
      decimals: contract.decimals
    }));
  });
  return options.sort((a, b) => {
    const platformOrder = a.platform.localeCompare(b.platform, "en", { sensitivity: "base" });
    if (a.platform === "Solana" && b.platform !== "Solana") return -1;
    if (a.platform !== "Solana" && b.platform === "Solana") return 1;
    if (platformOrder !== 0) return platformOrder;
    return a.tokenSymbol.localeCompare(b.tokenSymbol, "en", { sensitivity: "base" });
  });
}

function extractContractAddress(value) {
  const text = normalizeContractAddress(value);
  if (!text) return "";
  const afterSeparator = text.split(" - ").pop()?.trim() || text;
  const match = afterSeparator.match(/[1-9A-HJ-NP-Za-km-z]{32,48}$/);
  return match ? match[0] : afterSeparator;
}

function resolveSwapToken(value) {
  const text = normalizeContractAddress(value);
  const address = extractContractAddress(text);
  if (!text && !address) return null;
  const options = getSwapTokenOptions();
  return options.find((option) => option.value === text)
    || options.find((option) => normalizeContractAddress(option.address) === address)
    || (address ? { tokenSymbol: "Token", platform: "Contrato digitado", address, decimals: null, value: address } : null);
}

function renderSwapTokenOptions() {
  if (!el.swapTokenOptions) return;
  el.swapTokenOptions.innerHTML = getSwapTokenOptions()
    .map((option) => `<option value="${escapeHtml(option.value)}" label="${escapeHtml(`${option.tokenSymbol} - ${option.name || option.underlyingSymbol}`)}"></option>`)
    .join("");
}

function getSolanaContract(row) {
  return getContracts(row).find((contract) => contract.network === "Solana") || null;
}

function findSolanaTokenByContract(contractAddress) {
  const needle = normalizeContractAddress(contractAddress);
  if (!needle) return null;
  return state.assets.find((asset) =>
    getContracts(asset).some((contract) => contract.network === "Solana" && normalizeContractAddress(contract.address) === needle)
  ) || null;
}

function describeToken(row, contract) {
  if (!row && !contract) return "—";
  const address = normalizeContractAddress(contract?.address);
  const symbol = row?.tokenSymbol || row?.underlyingSymbol || "Token";
  return address ? `${symbol} • ${address}` : symbol;
}

function describeSwapToken(token) {
  if (!token) return "—";
  return `${token.tokenSymbol || "Token"} (${token.platform || "Solana"}) - ${token.address}`;
}

async function fetchJupiterTokenInfo(mint) {
  const address = normalizeContractAddress(mint);
  if (!address) return null;
  const cacheKey = `jupiter-token:${address}`;
  if (state.cache.has(cacheKey)) return state.cache.get(cacheKey);

  let response;
  try {
    response = await fetch(buildLocalApiUrl(`/api/jupiter/token?query=${encodeURIComponent(address)}`));
  } catch {
    state.cache.set(cacheKey, null);
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    state.cache.set(cacheKey, null);
    return null;
  }

  const rows = Array.isArray(payload) ? payload : payload?.tokens || payload?.data || [];
  const token = rows.find((row) => normalizeContractAddress(row?.id || row?.address || row?.mint) === address) || rows[0] || null;
  const decimals = Number(token?.decimals);
  const normalized = token ? {
    platform: "Jupiter",
    tokenSymbol: token.symbol || "Token",
    underlyingSymbol: token.symbol || "Token",
    name: token.name || token.symbol || "Token",
    address: token.id || token.address || token.mint || address,
    decimals: Number.isFinite(decimals) ? decimals : null
  } : null;
  state.cache.set(cacheKey, normalized);
  return normalized;
}

async function resolveSwapTokenWithMetadata(value) {
  const token = resolveSwapToken(value);
  if (!token?.address) return null;
  if (Number.isFinite(token.decimals)) return token;
  const metadata = await fetchJupiterTokenInfo(token.address);
  return metadata ? { ...token, ...metadata } : token;
}

function groupIntegerDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function parseHumanAmountToRaw(value, decimals) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;

  const [whole, fraction = ""] = text.split(".");
  const safeDecimals = Number.isFinite(decimals) && decimals > 0 ? decimals : 0;
  const normalizedFraction = safeDecimals > 0 ? fraction.padEnd(safeDecimals, "0").slice(0, safeDecimals) : "";
  const wholeUnits = BigInt(whole || "0") * 10n ** BigInt(safeDecimals);
  const fractionUnits = safeDecimals > 0 && normalizedFraction ? BigInt(normalizedFraction) : 0n;
  return (wholeUnits + fractionUnits).toString();
}

function formatTokenAmountFromRaw(value, decimals) {
  if (value == null || value === "") return "—";
  const text = String(value).trim();
  if (!text) return "—";

  if (/[.eE]/.test(text)) {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return text;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.min(12, Number.isFinite(decimals) ? Math.max(0, decimals) : 12)
    }).format(parsed);
  }

  if (!/^-?\d+$/.test(text)) return text;
  const negative = text.startsWith("-");
  const raw = negative ? text.slice(1) : text;
  const safeDecimals = Number.isFinite(decimals) && decimals > 0 ? decimals : 0;
  if (safeDecimals === 0) {
    return `${negative ? "-" : ""}${groupIntegerDigits(raw)}`;
  }

  const padded = raw.padStart(safeDecimals + 1, "0");
  const integer = padded.slice(0, -safeDecimals) || "0";
  const fraction = padded.slice(-safeDecimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${groupIntegerDigits(integer)}${fraction ? `.${fraction}` : ""}`;
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value != null && value !== "") return value;
  }
  return null;
}

function normalizeJupiterQuote(payload) {
  const amountOutRaw = pickFirstDefined(
    payload?.amountOut,
    payload?.amount_out,
    payload?.outAmount,
    payload?.expectedAmount,
    payload?.expected_amount,
    payload?.result?.amountOut,
    payload?.result?.amount_out,
    payload?.quote?.amountOut,
    payload?.quote?.amount_out,
    payload?.data?.amountOut,
    payload?.data?.amount_out
  );
  const price = pickFirstDefined(
    payload?.price,
    payload?.result?.price,
    payload?.quote?.price,
    payload?.data?.price,
    payload?.priceImpactPct
  );
  const route = pickFirstDefined(
    payload?.route,
    payload?.routeDescription,
    payload?.result?.route,
    payload?.data?.route,
    Array.isArray(payload?.routePlan)
      ? payload.routePlan
          .map((step) => step?.swapInfo?.label)
          .filter(Boolean)
          .join(" -> ")
      : null
  );
  const provider = pickFirstDefined(
    payload?.provider,
    payload?.providerName,
    payload?.connector,
    payload?.result?.provider,
    payload?.data?.provider,
    "Jupiter"
  );

  return { amountOutRaw, price, route, provider, payload };
}

function estimateNextDividend(dividends) {
  if (!dividends.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const rows = dividends
    .map((row) => ({
      ex: parseDate(row.exOrEffDate),
      pay: parseDate(row.paymentDate),
      amount: parseMoney(row.amount)
    }))
    .filter((row) => row.ex && row.amount != null)
    .sort((a, b) => b.ex.localeCompare(a.ex));

  if (!rows.length) return null;

  const pastRows = rows.filter((row) => row.ex <= today);
  const futureRows = rows.filter((row) => row.ex > today);
  const last = pastRows[0] || rows[0];

  const intervals = [];
  for (let i = 0; i < Math.min(rows.length - 1, 4); i += 1) {
    const current = new Date(`${rows[i].ex}T00:00:00Z`);
    const previous = new Date(`${rows[i + 1].ex}T00:00:00Z`);
    const diff = Math.round((current - previous) / 86400000);
    if (diff > 0) intervals.push(diff);
  }
  const medianInterval = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)] || 90;
  const paymentLag = last.pay ? Math.max(1, Math.round((new Date(`${last.pay}T00:00:00Z`) - new Date(`${last.ex}T00:00:00Z`)) / 86400000)) : 3;

  const nextOfficial = futureRows[0] || null;
  const nextEx = nextOfficial?.ex ? new Date(`${nextOfficial.ex}T00:00:00Z`) : new Date(`${last.ex}T00:00:00Z`);
  if (!nextOfficial?.ex) {
    nextEx.setDate(nextEx.getDate() + medianInterval);
  }
  const nextPay = nextOfficial?.pay ? new Date(`${nextOfficial.pay}T00:00:00Z`) : new Date(nextEx);
  if (!nextOfficial?.pay) {
    nextPay.setDate(nextPay.getDate() + paymentLag);
  }

  return {
    lastExDate: last.ex,
    lastPaymentDate: last.pay,
    lastDividendValue: last.amount,
    nextExDate: nextEx.toISOString().slice(0, 10),
    nextPaymentDate: nextPay.toISOString().slice(0, 10),
    nextDividendValue: nextOfficial?.amount ?? last.amount
  };
}

function getFiltersFromDom() {
  return {
    tokenSymbol: normalizeText(document.getElementById("filterToken").value),
    underlyingSymbol: normalizeText(document.getElementById("filterUnderlying").value),
    platform: document.getElementById("filterPlatform").value,
    hasDividends: document.getElementById("filterHasDividends").value,
    priceMin: document.getElementById("priceMin").value,
    priceMax: document.getElementById("priceMax").value,
    lastExFrom: document.getElementById("lastExFrom").value,
    lastExTo: document.getElementById("lastExTo").value,
    lastPayFrom: document.getElementById("lastPayFrom").value,
    lastPayTo: document.getElementById("lastPayTo").value,
    lastDivMin: document.getElementById("lastDivMin").value,
    lastDivMax: document.getElementById("lastDivMax").value,
    nextExFrom: document.getElementById("nextExFrom").value,
    nextExTo: document.getElementById("nextExTo").value,
    nextPayFrom: document.getElementById("nextPayFrom").value,
    nextPayTo: document.getElementById("nextPayTo").value,
    nextDivMin: document.getElementById("nextDivMin").value,
    nextDivMax: document.getElementById("nextDivMax").value
  };
}

function matchesRange(value, min, max) {
  if (min === "" && max === "") return true;
  if (value == null) return false;
  const minNum = min === "" ? null : Number(min);
  const maxNum = max === "" ? null : Number(max);
  if (Number.isFinite(minNum) && value < minNum) return false;
  if (Number.isFinite(maxNum) && value > maxNum) return false;
  return true;
}

function matchesDateRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function applyFilters(rows) {
  const filters = getFiltersFromDom();
  state.filters = filters;

  return rows.filter((row) => {
    if (filters.tokenSymbol && !normalizeText(row.tokenSymbol).includes(filters.tokenSymbol)) return false;
    if (filters.underlyingSymbol && !normalizeText(row.underlyingSymbol).includes(filters.underlyingSymbol)) return false;
    if (filters.platform && row.platform !== filters.platform) return false;
    if (filters.hasDividends === "yes" && row.nextDividendValue == null) return false;
    if (filters.hasDividends === "no" && row.nextDividendValue != null) return false;

    if (!matchesRange(row.price, filters.priceMin, filters.priceMax)) return false;
    if (!matchesRange(row.lastDividendValue, filters.lastDivMin, filters.lastDivMax)) return false;
    if (!matchesRange(row.nextDividendValue, filters.nextDivMin, filters.nextDivMax)) return false;

    if (!matchesDateRange(row.lastExDate, filters.lastExFrom, filters.lastExTo)) return false;
    if (!matchesDateRange(row.lastPaymentDate, filters.lastPayFrom, filters.lastPayTo)) return false;
    if (!matchesDateRange(row.nextExDate, filters.nextExFrom, filters.nextExTo)) return false;
    if (!matchesDateRange(row.nextPaymentDate, filters.nextPayFrom, filters.nextPayTo)) return false;

    return true;
  });
}

function compareValues(a, b, key) {
  const av = a[key];
  const bv = b[key];

  if (numericFields.has(key)) {
    const an = Number.isFinite(av) ? av : -Infinity;
    const bn = Number.isFinite(bv) ? bv : -Infinity;
    return an - bn;
  }

  if (dateFields.has(key)) {
    const ad = av ? new Date(`${av}T00:00:00Z`).getTime() : -Infinity;
    const bd = bv ? new Date(`${bv}T00:00:00Z`).getTime() : -Infinity;
    return ad - bd;
  }

  return String(av ?? "").localeCompare(String(bv ?? ""), "en", { sensitivity: "base" });
}

function sortRows(rows) {
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(a, b, state.sortKey) * dir);
}

function syncSortUi() {
  el.sortKey.value = state.sortKey;
  el.sortDirBtn.innerHTML = state.sortDir === "asc" ? "<span aria-hidden='true'>↑</span>" : "<span aria-hidden='true'>↓</span>";
  [...el.tableHead.querySelectorAll("button")].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.key === state.sortKey);
    btn.setAttribute("aria-sort", btn.dataset.key === state.sortKey ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
  });
}

function getContracts(row) {
  return Array.isArray(row.contracts) ? row.contracts.filter((contract) => contract?.network && contract?.address) : [];
}

function renderTokenButton(row, className = "token-symbol") {
  const contractCount = getContracts(row).length;
  const title = contractCount
    ? `Ver contratos de ${row.tokenSymbol}`
    : `Sem contratos disponiveis para ${row.tokenSymbol}`;
  return `
    <button
      type="button"
      class="${className} token-link"
      data-token="${escapeHtml(row.tokenSymbol)}"
      title="${escapeHtml(title)}"
      ${contractCount ? "" : "disabled"}
    >${escapeHtml(row.tokenSymbol)}</button>
  `;
}

function ensureContractsModal() {
  let modal = document.getElementById("contractsModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "contractsModal";
  modal.className = "modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="contracts-modal" role="dialog" aria-modal="true" aria-labelledby="contractsModalTitle">
      <div class="modal-head">
        <div>
          <p class="token-platform" id="contractsModalPlatform"></p>
          <h2 id="contractsModalTitle">Contratos</h2>
          <p class="modal-subtitle" id="contractsModalSubtitle"></p>
        </div>
        <button type="button" class="icon-btn modal-close" aria-label="Fechar">x</button>
      </div>
      <div class="contracts-list" id="contractsModalList"></div>
    </section>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".modal-close")) {
      closeContractsModal();
      return;
    }
    const copyButton = event.target.closest(".copy-contract-btn");
    if (copyButton) {
      copyContractAddress(copyButton);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeContractsModal();
    }
  });

  return modal;
}

function ensureToast() {
  let toast = document.getElementById("copyToast");
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = "copyToast";
  toast.className = "copy-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.hidden = true;
  document.body.appendChild(toast);
  return toast;
}

function openContractsModal(row) {
  const contracts = getContracts(row);
  if (!contracts.length) return;

  const modal = ensureContractsModal();
  modal.querySelector("#contractsModalPlatform").textContent = row.platform;
  modal.querySelector("#contractsModalTitle").textContent = row.tokenSymbol;
  modal.querySelector("#contractsModalSubtitle").textContent = row.name || row.underlyingSymbol;
  modal.querySelector("#contractsModalList").innerHTML = contracts
    .map((contract) => {
      const address = escapeHtml(contract.address);
      const network = escapeHtml(contract.network);
      const explorerUrl = contract.explorerUrl ? escapeHtml(contract.explorerUrl) : "";
      const chain = contract.chainId ? `<span>Chain ID ${escapeHtml(contract.chainId)}</span>` : "";
      const link = explorerUrl
        ? `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer">Abrir explorador</a>`
        : "";
      return `
        <article class="contract-row">
          <div>
            <strong>${network}</strong>
            ${chain}
          </div>
          <div class="contract-code">
            <code>${address}</code>
            <button
              type="button"
              class="copy-contract-btn"
              data-contract-address="${address}"
              aria-label="Copiar contrato ${network}"
              title="Copiar contrato"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="10" height="10" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          ${link}
        </article>
      `;
    })
    .join("");

  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close").focus();
}

function closeContractsModal() {
  const modal = document.getElementById("contractsModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function copyContractAddress(button) {
  const address = button.dataset.contractAddress;
  if (!address) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
    } else {
      const field = document.createElement("textarea");
      field.value = address;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    showCopyStatus(button, "Copiado");
    showToast("Contrato copiado para a area de transferencia");
  } catch {
    showCopyStatus(button, "Erro");
    showToast("Nao foi possivel copiar o contrato");
  }
}

function showCopyStatus(button, message) {
  const previousLabel = button.getAttribute("aria-label") || "Copiar contrato";
  button.classList.add("copied");
  button.setAttribute("aria-label", message);
  button.setAttribute("title", message);
  window.clearTimeout(button.copyStatusTimer);
  button.copyStatusTimer = window.setTimeout(() => {
    button.classList.remove("copied");
    button.setAttribute("aria-label", previousLabel);
    button.setAttribute("title", "Copiar contrato");
  }, 1400);
}

function showToast(message) {
  const toast = ensureToast();
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.remove("show");
  window.clearTimeout(toast.hideTimer);
  requestAnimationFrame(() => toast.classList.add("show"));
  toast.hideTimer = window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => {
      if (!toast.classList.contains("show")) {
        toast.hidden = true;
      }
    }, 180);
  }, 2200);
}

function renderHead() {
  el.sortKey.innerHTML = columns.map((column) => `<option value="${column.key}">${column.label}</option>`).join("");
  el.tableHead.innerHTML = columns.map((column) => `<th><button type="button" data-key="${column.key}">${column.label}</button></th>`).join("");
  el.tableHead.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "asc";
      }
      syncSortUi();
      render();
    });
  });
}

function buildCard(row) {
  const node = el.cardTemplate.content.cloneNode(true);
  node.querySelector(".card-platform").textContent = row.platform;
  node.querySelector(".card-title").outerHTML = renderTokenButton(row, "card-title");
  node.querySelector(".card-subtitle").textContent = row.underlyingSymbol;
  node.querySelector(".card-price").textContent = row.loading ? "Carregando" : formatMoney(row.price);

  const items = [
    ["Últ. ex", formatDate(row.lastExDate)],
    ["Últ. pagamento", formatDate(row.lastPaymentDate)],
    ["Últ. dividendo", formatMoney(row.lastDividendValue)],
    ["Próx. ex", formatDate(row.nextExDate)],
    ["Próx. pagamento", formatDate(row.nextPaymentDate)],
    ["Próx. dividendo", formatMoney(row.nextDividendValue)]
  ];

  const grid = node.querySelector(".card-grid");
  grid.innerHTML = items
    .map(([label, value]) => `<div class="card-field"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  return node;
}

function renderRows(rows) {
  const hasRows = rows.length > 0;
  el.tableBody.innerHTML = hasRows
    ? rows
        .map(
          (row) => `
          <tr class="${row.loading ? "loading-row" : ""}">
            <td>
              <div class="token-cell">
                <span class="token-platform">${row.platform}</span>
                ${renderTokenButton(row)}
                <span class="subtle">${row.underlyingSymbol}</span>
              </div>
            </td>
            <td><span class="pill">${row.underlyingSymbol}</span></td>
            <td class="money">${row.loading ? '<span class="loading-dot"></span>Carregando' : formatMoney(row.price)}</td>
            <td class="date">${formatDate(row.lastExDate)}</td>
            <td class="date">${formatDate(row.lastPaymentDate)}</td>
            <td class="money">${formatMoney(row.lastDividendValue)}</td>
            <td class="date">${formatDate(row.nextExDate)}</td>
            <td class="date">${formatDate(row.nextPaymentDate)}</td>
            <td class="money">${formatMoney(row.nextDividendValue)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="9">Nenhum resultado com os filtros atuais.</td></tr>`;

  el.cardList.innerHTML = "";
  rows.forEach((row) => el.cardList.appendChild(buildCard(row)));
}

function setSwapQuoteState(nextState) {
  state.quote = { ...state.quote, ...nextState };
  renderSwapQuote();
}

function renderSwapQuote() {
  const inputMint = el.swapInputMint.value.trim();
  const outputMint = el.swapOutputMint.value.trim();
  const inputToken = findSolanaTokenByContract(inputMint);
  const outputToken = findSolanaTokenByContract(outputMint);
  const inputContract = inputToken ? getSolanaContract(inputToken) : null;
  const outputContract = outputToken ? getSolanaContract(outputToken) : null;
  const hasError = Boolean(state.quote.error);

  el.swapQuoteResult.classList.toggle("is-loading", state.quote.loading);
  el.swapQuoteResult.classList.toggle("is-error", hasError);
  el.swapQuoteBtn.disabled = state.quote.loading;
  el.swapQuoteStatus.textContent = state.quote.loading
    ? "Consultando Jupiter..."
    : state.quote.error || "";

  el.swapQuoteInputLabel.textContent = inputToken
    ? describeToken(inputToken, inputContract)
    : inputMint || "—";
  el.swapQuoteOutputLabel.textContent = outputToken
    ? describeToken(outputToken, outputContract)
    : outputMint || "—";

  if (state.quote.loading) {
    el.swapQuoteAmount.textContent = "Consultando...";
    el.swapQuoteSummary.textContent = "Aguardando resposta da Jupiter.";
    el.swapQuotePrice.textContent = "—";
    el.swapQuoteSource.textContent = "Jupiter";
    return;
  }

  if (state.quote.error) {
    el.swapQuoteAmount.textContent = "Erro";
    el.swapQuoteSummary.textContent = state.quote.error;
    el.swapQuotePrice.textContent = "—";
    el.swapQuoteSource.textContent = "Jupiter";
    return;
  }

  const result = state.quote.result;
  if (!result) {
    el.swapQuoteAmount.textContent = "—";
    el.swapQuoteSummary.textContent = "Preencha os campos e consulte a cotação.";
    el.swapQuotePrice.textContent = "—";
    el.swapQuoteSource.textContent = "Jupiter";
    return;
  }

  const outputDecimals = outputContract?.decimals ?? 0;
  el.swapQuoteAmount.textContent = formatTokenAmountFromRaw(result.amountOutRaw, outputDecimals);
  el.swapQuoteSummary.textContent = result.route
    ? `Saída estimada via ${result.provider}. ${result.route}`
    : `Saída estimada via ${result.provider}.`;
  el.swapQuotePrice.textContent = result.price != null ? `${String(result.price)}%` : "—";
  el.swapQuoteSource.textContent = String(result.provider || "Jupiter");
}

function renderSwapQuote() {
  const inputToken = resolveSwapToken(el.swapInputMint.value);
  const outputToken = resolveSwapToken(el.swapOutputMint.value);
  const hasError = Boolean(state.quote.error);

  el.swapQuoteResult.classList.toggle("is-loading", state.quote.loading);
  el.swapQuoteResult.classList.toggle("is-error", hasError);
  el.swapQuoteBtn.disabled = state.quote.loading;
  el.swapQuoteStatus.textContent = state.quote.loading
    ? "Consultando Jupiter..."
    : state.quote.error || "";

  el.swapQuoteInputLabel.textContent = inputToken ? describeSwapToken(inputToken) : "—";
  el.swapQuoteOutputLabel.textContent = outputToken ? describeSwapToken(outputToken) : "—";

  if (state.quote.loading) {
    el.swapQuoteAmount.textContent = "Consultando...";
    el.swapQuoteSummary.textContent = "Aguardando resposta da Jupiter.";
    el.swapQuotePrice.textContent = "—";
    el.swapQuoteSource.textContent = "Jupiter";
    return;
  }

  if (state.quote.error) {
    el.swapQuoteAmount.textContent = "Erro";
    el.swapQuoteSummary.textContent = state.quote.error;
    el.swapQuotePrice.textContent = "—";
    el.swapQuoteSource.textContent = "Jupiter";
    return;
  }

  const result = state.quote.result;
  if (!result) {
    el.swapQuoteAmount.textContent = "—";
    el.swapQuoteSummary.textContent = "Preencha os campos e consulte a cotacao.";
    el.swapQuotePrice.textContent = "—";
    el.swapQuoteSource.textContent = "Jupiter";
    return;
  }

  const outputDecimals = result.outputToken?.decimals ?? outputToken?.decimals ?? 0;
  el.swapQuoteAmount.textContent = formatTokenAmountFromRaw(result.amountOutRaw, outputDecimals);
  el.swapQuoteSummary.textContent = result.route
    ? `Saida estimada via ${result.provider}. ${result.route}`
    : `Saida estimada via ${result.provider}.`;
  el.swapQuotePrice.textContent = result.price != null ? `${String(result.price)}%` : "—";
  el.swapQuoteSource.textContent = String(result.provider || "Jupiter");
}

async function requestJupiterQuote() {
  const amount = el.swapAmount.value.trim();
  const jupiterConfig = getJupiterConfigFromUi();
  const inputToken = await resolveSwapTokenWithMetadata(el.swapInputMint.value);
  const outputToken = await resolveSwapTokenWithMetadata(el.swapOutputMint.value);

  if (!inputToken?.address) {
    throw new Error("Selecione ou digite o token de origem.");
  }
  if (!outputToken?.address) {
    throw new Error("Selecione ou digite o token de destino.");
  }
  if (!Number.isFinite(inputToken.decimals)) {
    throw new Error("Nao foi possivel descobrir os decimais do token de origem digitado.");
  }

  const rawAmount = parseHumanAmountToRaw(amount, inputToken.decimals);
  if (!rawAmount || rawAmount === "0") {
    throw new Error("Informe uma quantidade de origem valida.");
  }

  const url = new URL(jupiterConfig.endpoint);
  url.searchParams.set("inputMint", inputToken.address);
  url.searchParams.set("outputMint", outputToken.address);
  url.searchParams.set("amount", rawAmount);
  url.searchParams.set("slippageBps", "50");
  url.searchParams.set("restrictIntermediateTokens", "true");
  url.searchParams.set("swapMode", "ExactIn");

  let response;
  try {
    response = await fetch(buildLocalApiUrl(`/api/jupiter/quote?url=${encodeURIComponent(url.toString())}`));
  } catch (error) {
    throw new Error(explainProxyFetchError(error));
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Jupiter retornou erro ${response.status}.`);
  }
  return {
    ...normalizeJupiterQuote(payload || {}),
    inputToken,
    outputToken
  };
}

function render() {
  const filtered = applyFilters(state.assets);
  const sorted = sortRows(filtered);
  state.visible = sorted;

  el.totalCount.textContent = String(state.assets.length);
  el.visibleCount.textContent = String(sorted.length);
  el.loadedCount.textContent = String(state.assets.filter((row) => !row.loading).length);

  renderRows(sorted);
  syncSortUi();
}

function setupFilters() {
  filterIds.forEach((id) => {
    const node = document.getElementById(id);
    const eventName = node.tagName === "SELECT" ? "change" : "input";
    node.addEventListener(eventName, render);
  });

  el.sortKey.addEventListener("change", () => {
    state.sortKey = el.sortKey.value;
    render();
  });

  el.sortDirBtn.addEventListener("click", () => {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    render();
  });

  el.clearBtn.addEventListener("click", () => {
    filterIds.forEach((id) => {
      const node = document.getElementById(id);
      node.value = "";
    });
    state.sortKey = "tokenSymbol";
    state.sortDir = "asc";
    render();
  });

  el.refreshBtn.addEventListener("click", () => {
    loadData().catch((error) => console.error(error));
  });

  el.toggleFiltersBtn.addEventListener("click", () => {
    const collapsed = el.filtersPanel.classList.toggle("is-collapsed");
    el.toggleFiltersBtn.setAttribute("aria-expanded", String(!collapsed));
    el.toggleFiltersBtn.textContent = collapsed ? "Expandir filtros" : "Minimizar filtros";
  });

  const jupiterConfig = loadJupiterConfig();
  if (el.titanEndpoint) el.titanEndpoint.value = jupiterConfig.endpoint;
  el.saveTitanConfigBtn?.addEventListener("click", () => {
    saveJupiterConfig(getJupiterConfigFromUi());
    showToast("Configuracao da Jupiter salva");
  });
  [el.titanEndpoint].forEach((node) => {
    node?.addEventListener("change", () => {
      saveJupiterConfig(getJupiterConfigFromUi());
    });
  });

  el.swapQuoteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setSwapQuoteState({ loading: true, error: "" });
    try {
      const result = await requestJupiterQuote();
      setSwapQuoteState({ loading: false, error: "", result });
    } catch (error) {
      setSwapQuoteState({ loading: false, error: error.message || "Falha ao consultar Jupiter.", result: null });
    }
  });

  [el.swapInputMint, el.swapOutputMint, el.swapAmount].forEach((node) => {
    node.addEventListener("input", () => {
      if (state.quote.error || state.quote.result) {
        setSwapQuoteState({ error: "", result: null });
      } else {
        renderSwapQuote();
      }
    });
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".token-link");
    if (!button) return;
    const row = state.assets.find((asset) => asset.tokenSymbol === button.dataset.token);
    if (row) openContractsModal(row);
  });
}

async function loadManifest() {
  const embedded = document.getElementById("assets-data");
  if (embedded && embedded.textContent && embedded.textContent.trim() !== "__ASSETS_DATA__") {
    return JSON.parse(embedded.textContent);
  }
  const response = await fetch(`${dataUrl}?t=${Date.now()}`);
  if (!response.ok) throw new Error(`Falha ao carregar ${dataUrl}`);
  return response.json();
}

function formatUpdatedAt(value) {
  if (!value) return "desconhecida";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function loadUpdatedAt() {
  const embedded = document.getElementById("dashboard-meta");
  if (!embedded?.textContent) return null;
  try {
    const meta = JSON.parse(embedded.textContent);
    return meta.generatedAt || null;
  } catch {
    return null;
  }
}

async function loadData() {
  const manifest = await loadManifest();
  state.assets = manifest.map((asset) => ({
    ...asset,
    loading: false
  }));
  const updatedAt = loadUpdatedAt();
  if (el.updatedAt) {
    el.updatedAt.textContent = formatUpdatedAt(updatedAt);
  }
  renderSwapTokenOptions();
  render();
  renderSwapQuote();
}

async function bootstrap() {
  renderHead();
  setupFilters();
  renderSwapTokenOptions();
  renderSwapQuote();
  await loadData();
}

bootstrap().catch((error) => {
  console.error(error);
  el.tableBody.innerHTML = `<tr><td colspan="9">Não foi possível carregar o dashboard.</td></tr>`;
  el.cardList.innerHTML = `<div class="asset-card"><strong>Erro ao carregar</strong><p class="card-subtitle">${error.message}</p></div>`;
});
