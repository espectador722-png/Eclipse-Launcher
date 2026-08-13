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
  await api().check_and_install("desktop");
});

// ── menú de "dónde crear el acceso directo" — reemplaza al diálogo
// nativo de Windows como camino por defecto (ver comentario grande en
// index.html / launcher.py). ──
document.getElementById("btn-shortcut").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("shortcut-menu").hidden = !document.getElementById("shortcut-menu").hidden;
});
document.addEventListener("click", () => { document.getElementById("shortcut-menu").hidden = true; });
document.querySelectorAll("#shortcut-menu [data-shortcut]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.getElementById("shortcut-menu").hidden = true;
    const mode = btn.dataset.shortcut;
    const mainBtn = document.getElementById("btn-main");
    mainBtn.disabled = true;
    mainBtn.classList.add("busy");
    setStatus(mode === "browse" ? "Elegí dónde crear el acceso directo…" : "Creando acceso directo…");
    await api().check_and_install(mode);
  });
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
    // BUGFIX visual: antes solo se sacaba/ponía la clase "active" (opacidad)
    // — la slide vieja y la nueva quedaban las DOS ocupando el mismo
    // espacio (position:absolute) mientras la transición corría, así que
    // durante ese instante se veían superpuestas/mezcladas (el "rectángulo
    // azul" atravesando el texto era la tag de la otra slide de fondo).
    // Con visibility:hidden en la que sale, deja de ocupar espacio
    // interactivo/visual apenas termina su propio fade.
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
// Cada entrada: [texto corto, fecha/etiqueta, detalle (se ve al hacer clic)]
const NEWS_TAB_CONTENT = {
  eventos: [
    ["Sin eventos por ahora", "",
      "Seguí el Discord para enterarte apenas haya sorteos, betas o novedades antes que nadie."],
    ["¿Tenés una idea o pedido?", "",
      "Contanos en el servidor de Discord — la mayoría de las funciones nuevas salieron de pedidos de la comunidad."],
  ],
  noticias: [
    ["Motor de traducción Multi-Engine renovado", "Hoy",
      "Ahora combina Google, Yandex y MyMemory en cascada — más estable y más rápido que antes."],
    ["Interfaz reorganizada en secciones", "Hoy",
      "Ren'Py, RPG Maker y Config ya no son una lista larga de tarjetas: ahora están agrupadas en secciones plegables."],
    ["Arreglado: nombres con título pegado", "Hoy",
      "Casos tipo \"Uncle Pete\" (título + nombre propio pegados) ahora traducen bien el título y respetan el nombre."],
    ["Actualizaciones automáticas más confiables", "Hoy",
      "El sistema que instala las actualizaciones quedó más robusto ante casos raros del lado del usuario."],
  ],
  info: [
    ["Motores de juego soportados", "",
      "Traduce juegos hechos en Ren'Py, RPG Maker (MV/MZ/XP/VX/Ace), Godot y Unity."],
    ["Motores de traducción", "",
      "Online (Google, Yandex, MyMemory) o local/offline (Argos) — vos elegís."],
    ["Compresor de imágenes", "",
      "Reduce el peso de los assets del juego sin perder calidad visible."],
    ["Herramientas de calidad", "",
      "Glosario propio, buscador/reemplazador de traducciones y diagnóstico automático."],
    ["Se mantiene solo", "",
      "Busca e instala sus propias actualizaciones — no hace falta volver a bajar nada a mano."],
    ["Licencia paga", "",
      "Desbloquea el traductor OCR (texto dentro de imágenes) y los motores por IA (LLM)."],
  ],
};
function renderNewsTab(tabId) {
  const list = document.getElementById("news-list");
  const items = NEWS_TAB_CONTENT[tabId] || [];
  list.innerHTML = items.map(([text, date]) => `
    <li>
      <div class="news-list-row">
        <span class="news-list-text">${text}</span>
        <span class="news-list-date">${date}</span>
        <span class="news-list-chevron">▸</span>
      </div>
    </li>`
  ).join("");
  // v1.0.2 — BUGFIX reportado: la tarjeta es chica y sin scroll, el
  // detalle inline no entraba. Ahora cada click abre un panel aparte
  // (#news-detail-overlay) con espacio real y scroll propio.
  list.querySelectorAll("li").forEach((li, i) => {
    li.addEventListener("click", () => openNewsDetail(tabId, i));
  });
}

function openNewsDetail(tabId, i) {
  const [text, date, detail] = (NEWS_TAB_CONTENT[tabId] || [])[i] || [];
  if (!text) return;
  document.getElementById("news-detail-tag").textContent =
    tabId === "noticias" ? "NOTICIA" : tabId === "info" ? "INFORMACIÓN" : "EVENTO";
  document.getElementById("news-detail-title").textContent = text;
  document.getElementById("news-detail-body").textContent = detail || text;
  document.getElementById("news-detail-overlay").hidden = false;
}
document.getElementById("news-detail-close").addEventListener("click", () => {
  document.getElementById("news-detail-overlay").hidden = true;
});
document.getElementById("news-detail-overlay").addEventListener("click", (e) => {
  if (e.target.id === "news-detail-overlay") document.getElementById("news-detail-overlay").hidden = true;
});
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
      await api().check_and_install("desktop");
    } else if (action === "folder") {
      api().open_install_folder();
    } else if (action === "shortcut") {
      document.getElementById("shortcut-menu").hidden = false;
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
  docs: "https://www.eclipse1940zone.online/",
  web: "https://www.eclipse1940zone.online/",
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

// ── radio flotante — misma playlist/mecánica que el sitio (fade-in de
// volumen, autoplay recién tras un click/touch real por las políticas
// de autoplay del navegador; "attempting" evita pisar un intento en
// curso). Para sumar temas nuevos, agregá una entrada más acá abajo. ──
const EZ_RADIO_TRACKS = [
  { name: "LONOWN - starly (Super Slowed)", url: "https://github.com/espectador722-png/suncsjcsn/raw/refs/heads/main/LONOWN%20-%20starly%20(Super%20Slowed).mp3" },
  { name: "Senpai [Remix] - Shiki (Slowed)", url: "https://github.com/espectador722-png/suncsjcsn/raw/refs/heads/main/Senpai%20%5BRemix%5D%20-%20Shiki%20(Slowed)%20(1).mp3" },
  { name: "NUNCA MUDA (Slowed 0.66X) - Scytherman, NXGHT!", url: "https://github.com/espectador722-png/suncsjcsn/raw/refs/heads/main/%F0%9D%90%8D%F0%9D%90%94%F0%9D%90%8D%F0%9D%90%82%F0%9D%90%80%20%F0%9D%90%8C%F0%9D%90%94%F0%9D%90%83%F0%9D%90%80_%20(%F0%9D%90%92%F0%9D%90%A5%F0%9D%90%A8%F0%9D%90%B0%F0%9D%90%9E%F0%9D%90%9D%200.66%F0%9D%90%97)%20-%20%F0%9D%90%92%F0%9D%90%9C%F0%9D%90%B2%F0%9D%90%AD%F0%9D%90%A1%F0%9D%90%9E%F0%9D%90%AB%F0%9D%90%A6%F0%9D%90%9A%F0%9D%90%A7%F0%9D%90%9E%2C%20%F0%9D%90%8D%F0%9D%90%97%F0%9D%90%86%F0%9D%90%87%F0%9D%90%93!%20%20%5B%20%F0%9D%91%AD%F0%9D%92%93%F0%9D%92%82%F0%9D%92%8F%F0%9D%92%84%F0%9D%92%86%F0%9D%92%94%F0%9D%92%84%F0%9D%92%82%20%F0%9D%91%B7%F0%9D%92%93%F0%9D%92%86%F0%9D%92%8D%F0%9D%92%82%F0%9D%92%95%F0%9D%92%8A%20%F0%9D%91%AC%F0%9D%92%85%F0%9D%92%8A%F0%9D%92%95%20%5D.mp3" },
];

(function initRadio() {
  const audio = document.getElementById("bg-audio");
  const widget = document.getElementById("radio-widget");
  const toggleBtn = document.getElementById("radio-toggle");
  const toggleIcon = document.getElementById("radio-toggle-icon");
  const nextBtn = document.getElementById("radio-next");
  const nameEl = document.getElementById("radio-track-name");
  if (!audio || !EZ_RADIO_TRACKS.length) return;

  let idx = 0;
  let playing = false;
  let attempting = false;

  function loadTrack(i, autoplay) {
    idx = ((i % EZ_RADIO_TRACKS.length) + EZ_RADIO_TRACKS.length) % EZ_RADIO_TRACKS.length;
    const track = EZ_RADIO_TRACKS[idx];
    audio.src = track.url;
    if (nameEl) nameEl.textContent = track.name;
    if (autoplay) audio.play().catch(() => {});
  }

  if (widget) widget.style.display = "flex";
  loadTrack(0, false);

  function tryPlay() {
    if (playing || attempting) return;
    attempting = true;
    audio.play().then(() => {
      attempting = false;
      playing = true;
      if (toggleIcon) toggleIcon.textContent = "⏸";
      let v = 0;
      const fade = setInterval(() => {
        v = Math.min(v + 0.05, 0.6);
        audio.volume = v;
        if (v >= 0.6) clearInterval(fade);
      }, 100);
    }).catch(() => { attempting = false; });
  }

  audio.addEventListener("ended", () => loadTrack(idx + 1, true));

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (audio.paused) {
        playing = true;
        audio.play();
        toggleIcon.textContent = "⏸";
      } else {
        playing = false;
        audio.pause();
        toggleIcon.textContent = "▶";
      }
    });
  }
  if (nextBtn) nextBtn.addEventListener("click", () => loadTrack(idx + 1, true));

  setTimeout(tryPlay, 500);
  window.addEventListener("load", tryPlay);
  document.addEventListener("click", tryPlay);
  document.addEventListener("touchstart", tryPlay);
})();
