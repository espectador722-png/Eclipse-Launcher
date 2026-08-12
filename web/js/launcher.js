let API_READY = false;
let LAST_STATE = null;

function api() { return window.pywebview.api; }

window.addEventListener("pywebviewready", async () => {
  API_READY = true;
  await refreshState();
});

const ICONS = { download: "⬇", play: "▶", retry: "↻", update: "⟳" };

function setMainButton(mode, label) {
  const btn = document.getElementById("btn-main");
  const icon = document.getElementById("btn-main-icon");
  const text = document.getElementById("btn-main-label");
  icon.textContent = ICONS[mode] || "";
  text.textContent = label;
  btn.dataset.mode = mode;
}

async function refreshState() {
  const st = await api().get_state();
  LAST_STATE = st;
  document.getElementById("dock-version").textContent = `Launcher v${st.launcherVersion}`;
  const installedEl = document.getElementById("dock-installed");
  const btn = document.getElementById("btn-main");
  btn.disabled = false;
  btn.classList.remove("error", "busy");
  if (st.installed) {
    installedEl.textContent = `Instalado: v${st.installedVersion || "?"}`;
    setMainButton("play", "Jugar");
  } else {
    installedEl.textContent = "No instalado todavía";
    setMainButton("download", "Descargar");
  }
}

function setStatus(msg) {
  const el = document.getElementById("dock-status");
  el.style.opacity = "0";
  setTimeout(() => { el.textContent = msg || ""; el.style.opacity = "1"; }, 90);
}

// Anillo circular de progreso (mismo perímetro que stroke-dasharray en
// css/style.css: 2*pi*17 ≈ 107).
const DL_RING_CIRCUMFERENCE = 107;
function setProgress(pct) {
  document.getElementById("dl-ring").hidden = false;
  document.getElementById("dl-ring-fill").style.strokeDashoffset =
    String(DL_RING_CIRCUMFERENCE * (1 - pct / 100));
  document.getElementById("dl-ring-pct").textContent = String(pct);
}

function hideProgress() {
  document.getElementById("dl-ring").hidden = true;
  document.getElementById("dl-ring-fill").style.strokeDashoffset = String(DL_RING_CIRCUMFERENCE);
}

// El backend (launcher.py) llama a esto vía window.evaluate_js.
window.onLauncherEvent = function (event, data) {
  const btn = document.getElementById("btn-main");
  if (event === "status") {
    setStatus(data.msg);
  } else if (event === "progress") {
    const mb = data.done ? (data.done / 1e6).toFixed(1) : "0";
    const totalMb = data.total ? (data.total / 1e6).toFixed(1) : null;
    setStatus(`Descargando… ${mb}${totalMb ? " / " + totalMb : ""} MB`);
    setProgress(data.pct);
    btn.classList.remove("busy");
  } else if (event === "error") {
    hideProgress();
    setStatus(`✗ ${data.msg}`);
    btn.disabled = false;
    btn.classList.remove("busy");
    btn.classList.add("error");
    setMainButton("retry", "Reintentar");
  } else if (event === "done") {
    hideProgress();
    btn.classList.remove("busy", "error");
    if (data.upToDate) {
      setStatus("✓ Ya tenés la última versión.");
    } else {
      setStatus(`✓ Instalado v${data.version || ""} — acceso directo creado.`);
    }
    refreshState();
  }
};

document.getElementById("btn-main").addEventListener("click", async () => {
  const btn = document.getElementById("btn-main");
  const mode = btn.dataset.mode;
  if (mode === "play") {
    setStatus("Abriendo Eclipse Tools…");
    const res = await api().play();
    if (!res.ok) setStatus(`✗ ${res.msg || "No se pudo abrir."}`);
    return;
  }
  btn.disabled = true;
  btn.classList.remove("error");
  btn.classList.add("busy");
  setMainButton(mode === "retry" ? "retry" : "update", "Descargando…");
  setStatus("Iniciando…");
  await api().check_and_install(false);
});

document.getElementById("btn-shortcut").addEventListener("click", async () => {
  const btn = document.getElementById("btn-main");
  btn.disabled = true;
  btn.classList.add("busy");
  setStatus("Elegí dónde crear el acceso directo…");
  await api().check_and_install(true);
});

// ── carrusel de novedades (autoplay + dots) ──────────────────────────
(function initNewsCarousel() {
  const slides = Array.from(document.querySelectorAll(".news-slide"));
  const dotsWrap = document.getElementById("news-dots");
  if (!slides.length) return;
  let idx = 0;
  slides.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "news-dot" + (i === 0 ? " active" : "");
    dot.addEventListener("click", () => show(i));
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function show(i) {
    slides[idx].classList.remove("active");
    dots[idx].classList.remove("active");
    idx = i;
    slides[idx].classList.add("active");
    dots[idx].classList.add("active");
  }

  setInterval(() => show((idx + 1) % slides.length), 4200);
})();

// ── tabs de la tarjeta de novedades ──────────────────────────────────
// eventos: sin nada estructural que mostrar todavía (no hay "eventos"
// como en un juego) — mensajes genéricos que inviten a seguir el
// Discord. noticias: resumen corto de arreglos/cosas nuevas
// importantes (actualizar a mano con cada release grande). info: qué
// hace el programa, pensado para alguien que nunca lo usó.
const NEWS_TAB_CONTENT = {
  eventos: [
    ["Sin eventos por ahora — segui el Discord para sorteos y novedades", ""],
    ["¿Tenés una idea o pedido? Contanos en el servidor", ""],
  ],
  noticias: [
    ["Motor de traducción Multi-Engine renovado y más estable", "Hoy"],
    ["Interfaz reorganizada en secciones plegables", "Hoy"],
    ["Arreglado: nombres con título pegado (\"Uncle Pete\" y similares)", "Hoy"],
    ["Actualizaciones automáticas más confiables", "Hoy"],
  ],
  info: [
    ["Traduce juegos Ren'Py, RPG Maker, Godot y Unity", ""],
    ["Motores online (Google/Yandex/MyMemory) + local offline (Argos)", ""],
    ["Compresor de imágenes y empaquetado del mod", ""],
    ["Glosario propio, búsqueda/reemplazo y diagnóstico de traducción", ""],
    ["Se actualiza solo — sin volver a bajar nada a mano", ""],
    ["OCR y motores por IA son función de licencia paga", ""],
  ],
};
function renderNewsTab(tabId) {
  const list = document.getElementById("news-list");
  const items = NEWS_TAB_CONTENT[tabId] || [];
  list.innerHTML = items.map(([text, date]) =>
    `<li><span class="news-list-text">${text}</span><span class="news-list-date">${date}</span></li>`
  ).join("");
}
document.querySelectorAll(".news-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".news-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    renderNewsTab(tab.dataset.tab);
  });
});
renderNewsTab("eventos");

// ── menú "más opciones" (☰) junto al botón principal ─────────────────
document.getElementById("btn-more").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("more-menu").hidden = !document.getElementById("more-menu").hidden;
});
document.addEventListener("click", () => { document.getElementById("more-menu").hidden = true; });
document.querySelectorAll("#more-menu [data-action]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.getElementById("more-menu").hidden = true;
    const action = btn.dataset.action;
    if (action === "redownload") {
      const mainBtn = document.getElementById("btn-main");
      mainBtn.disabled = true;
      mainBtn.classList.add("busy");
      setMainButton("update", "Descargando…");
      setStatus("Reinstalando…");
      await api().check_and_install(false);
    } else if (action === "folder") {
      api().open_install_folder();
    } else if (action === "shortcut") {
      await api().check_and_install(true);
    }
  });
});

// ── panel de configuración ────────────────────────────────────────────
async function openSettings() {
  const s = await api().get_settings();
  document.getElementById("setting-startup").checked = !!s.startup;
  document.getElementById("setting-autocheck").checked = !!s.autoCheck;
  document.getElementById("setting-closeonlaunch").checked = !!s.closeOnLaunch;
  document.getElementById("settings-version").textContent = LAST_STATE ? LAST_STATE.launcherVersion : "—";
  document.getElementById("settings-overlay").hidden = false;
}
function closeSettings() {
  const s = {
    startup: document.getElementById("setting-startup").checked,
    autoCheck: document.getElementById("setting-autocheck").checked,
    closeOnLaunch: document.getElementById("setting-closeonlaunch").checked,
  };
  api().save_settings(s);
  document.getElementById("settings-overlay").hidden = true;
}
document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("settings-overlay").addEventListener("click", (e) => {
  if (e.target.id === "settings-overlay") closeSettings();
});
document.getElementById("settings-open-folder").addEventListener("click", () => {
  api().open_install_folder();
});

// ── rail de apps (hoy solo Eclipse Tools) ─────────────────────────────
document.querySelectorAll(".app-rail-item:not(.app-rail-empty)").forEach((btn) => {
  btn.addEventListener("click", () => btn.classList.add("active"));
});

// ── links externos (social rail + accesos rápidos) ───────────────────
const EXTERNAL_LINKS = {
  discord: "https://discord.gg/",
  docs: "https://zonaferoz.site/docs",
  web: "https://zonaferoz.site",
  report: "https://discord.gg/",
};
document.querySelectorAll("[data-link]").forEach((el) => {
  if (el.id === "quicklink-folder") return; // ese abre la carpeta local, no un link
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const url = EXTERNAL_LINKS[el.dataset.link];
    if (url) api().open_link(url);
  });
});
document.getElementById("quicklink-folder").addEventListener("click", () => {
  api().open_install_folder();
});

document.getElementById("btn-min").addEventListener("click", () => {
  window.pywebview.api;
  try { pywebview.window ? pywebview.window.minimize() : null; } catch (_) {}
});
document.getElementById("btn-close").addEventListener("click", () => {
  window.close();
});

// ── fondo de partículas — mismo lenguaje visual que Eclipse Tools,
// versión chica y liviana (sin depender de nada externo). ──
(function initParticles() {
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");
  let w, h, stars = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const N = 70;
  for (let i = 0; i < N; i++) {
    stars.push({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.4 + 0.3,
      a: Math.random() * 0.6 + 0.15,
      dx: (Math.random() - 0.5) * 0.05,
      dy: (Math.random() - 0.5) * 0.05,
    });
  }

  function tick() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.x += s.dx; s.y += s.dy;
      if (s.x < 0) s.x = w; if (s.x > w) s.x = 0;
      if (s.y < 0) s.y = h; if (s.y > h) s.y = 0;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 230, 240, ${s.a})`;
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();
