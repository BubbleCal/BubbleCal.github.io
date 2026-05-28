const storageKey = "yah01-blog-theme";
const root = document.documentElement;
const savedTheme = localStorage.getItem(storageKey);

if (savedTheme === "dark" || savedTheme === "light") {
  root.dataset.theme = savedTheme;
}

function activeTheme() {
  return root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const next = activeTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem(storageKey, next);
});

for (const link of document.querySelectorAll("[data-lang-switch]")) {
  link.addEventListener("click", () => {
    const language = link.getAttribute("data-lang");
    if (language === "zh" || language === "en") {
      localStorage.setItem("yah01-blog-language", language);
    }
  });
}

const searchInput = document.querySelector("[data-search]");
const cards = [...document.querySelectorAll("[data-post-card]")];
const emptyState = document.querySelector("[data-empty-state]");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
let activeFilter = "all";

function normalize(value) {
  return value.toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput?.value || "");
  let visibleCount = 0;

  for (const card of cards) {
    const text = normalize(
      `${card.dataset.title || ""} ${card.dataset.categories || ""} ${card.dataset.tags || ""}`
    );
    const matchesQuery = !query || text.includes(query);
    const matchesFilter = activeFilter === "all" || normalize(card.dataset.categories || "").includes(normalize(activeFilter));
    const visible = matchesQuery && matchesFilter;
    card.hidden = !visible;
    if (visible) {
      visibleCount += 1;
    }
  }

  if (emptyState) {
    emptyState.hidden = visibleCount > 0;
  }
}

searchInput?.addEventListener("input", applyFilters);

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter || "all";
    for (const item of filterButtons) {
      item.classList.toggle("is-active", item === button);
    }
    applyFilters();
  });
}
