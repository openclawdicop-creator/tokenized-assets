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
  cache: new Map()
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
  cardTemplate: document.getElementById("cardTemplate")
};

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
  node.querySelector(".card-title").textContent = row.tokenSymbol;
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
                <span class="token-symbol">${row.tokenSymbol}</span>
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
  render();
}

async function bootstrap() {
  renderHead();
  setupFilters();
  await loadData();
}

bootstrap().catch((error) => {
  console.error(error);
  el.tableBody.innerHTML = `<tr><td colspan="9">Não foi possível carregar o dashboard.</td></tr>`;
  el.cardList.innerHTML = `<div class="asset-card"><strong>Erro ao carregar</strong><p class="card-subtitle">${error.message}</p></div>`;
});
