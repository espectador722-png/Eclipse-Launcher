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
  const badge = document.getElementById("dock-update-badge");
  const btn = document.getElementById("btn-main");
  btn.disabled = false;
  btn.classList.remove("error", "busy");
  // v1.0.1 — 3 estados reales, no solo instalado/no-instalado: si hay
  // versión más nueva que la instalada, el botón ofrece ACTUALIZAR en
  // vez de Jugar (mismo criterio que cualquier launcher de juego real
  // — HoYoPlay, Steam, etc. — nunca te dejan jugando una versión vieja
  // sin avisarte primero).
  if (st.installed && st.updateAvailable) {
    installedEl.textContent = `Instalado: v${st.installedVersion || "?"}`;
    badge.hidden = false;
    badge.textContent = `✨ Versión ${st.latestVersion} disponible`;
    setMainButton("update", "Actualizar");
  } else if (st.installed) {
    installedEl.textContent = `Instalado: v${st.installedVersion || "?"}`;
    badge.hidden = true;
    setMainButton("play", "Jugar");
  } else {
    installedEl.textContent = "No instalado todavía";
    badge.hidden = true;
    setMainButton("download", "Descargar");
  }
  updateStrayBanner(st.strayInstallPath);
}

function updateStrayBanner(strayPath) {
  const banner = document.getElementById("stray-banner");
  if (!strayPath || banner.dataset.dismissed === strayPath) {
    banner.hidden = true;
    return;
  }
  document.getElementById("stray-banner-path").textContent = strayPath;
  banner.hidden = false;
}

document.getElementById("stray-banner-dismiss").addEventListener("click", () => {
  const banner = document.getElementById("stray-banner");
  banner.dataset.dismissed = document.getElementById("stray-banner-path").textContent;
  banner.hidden = true;
});

document.getElementById("stray-banner-delete").addEventListener("click", async () => {
  const btn = document.getElementById("stray-banner-delete");
  btn.disabled = true;
  btn.textContent = "Borrando…";
  try {
    const res = await api().resolve_stray_install("delete");
    if (!res.ok) {
      setStatus(res.msg || "No se pudo borrar la instalación vieja.");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Borrar copia vieja";
    await refreshState();
  }
});

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
      btn.classList.add("done");
      setTimeout(() => btn.classList.remove("done"), 550);
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
// BUGFIX reportado: los dos popups (este y #more-menu) usaban cada uno su
// propio stopPropagation() + listener de documento — al abrir uno estando
// el otro abierto, cada stopPropagation bloqueaba el cierre del otro y
// quedaban los dos superpuestos en pantalla sin cerrarse nunca al clickear
// afuera. closeAllPopups() centraliza el cierre de ambos.
function closeAllPopups() {
  document.getElementById("shortcut-menu").hidden = true;
  document.getElementById("more-menu").hidden = true;
}
document.getElementById("btn-shortcut").addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = document.getElementById("shortcut-menu").hidden;
  closeAllPopups();
  document.getElementById("shortcut-menu").hidden = !willOpen;
});
document.addEventListener("click", closeAllPopups);
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

  slides.forEach((slide) => {
    slide.style.cursor = "pointer";
    slide.addEventListener("click", () => openWikiNewsByTitle(slide.querySelector(".news-slide-title").textContent));
  });
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
    ["Interfaz organizada", "",
      "Secciones plegables por juego (Juego / Traducir / Herramientas / Mantenimiento) — nada de listas larguísimas."],
    ["Gratis para empezar", "",
      "Todo lo esencial funciona sin licencia — la paga solo agrega OCR y motores por IA."],
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

// El detalle ya no abre el mini-modal viejo (#news-detail-overlay) — ahora
// lleva directo a la ficha completa dentro del panel Wiki, categoría
// "Novedades", buscando la entrada equivalente en WIKI_NEWS por título
// (los textos se mantienen sincronizados a mano entre ambos arrays).
function openNewsDetail(tabId, i) {
  const [text] = (NEWS_TAB_CONTENT[tabId] || [])[i] || [];
  if (!text) return;
  openWikiNewsByTitle(text);
}
function openWikiNewsByTitle(title) {
  const idx = WIKI_NEWS.findIndex((n) => n.title === title);
  openWiki();
  wikiActiveCat = "novedades";
  renderWikiSidebar();
  wikiNewsDetail = idx >= 0 ? idx : null;
  renderWikiNews();
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
  const willOpen = document.getElementById("more-menu").hidden;
  closeAllPopups();
  document.getElementById("more-menu").hidden = !willOpen;
});
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
    } else if (action === "uninstall-tools") {
      document.getElementById("uninstall-confirm-overlay").hidden = false;
    }
  });
});

// ── confirmación de "Desinstalar Eclipse Tools" ───────────────────────
function closeUninstallConfirm() {
  document.getElementById("uninstall-confirm-overlay").hidden = true;
}
document.getElementById("uninstall-confirm-close").addEventListener("click", closeUninstallConfirm);
document.getElementById("uninstall-confirm-cancel").addEventListener("click", closeUninstallConfirm);
document.getElementById("uninstall-confirm-overlay").addEventListener("click", (e) => {
  if (e.target.id === "uninstall-confirm-overlay") closeUninstallConfirm();
});
document.getElementById("uninstall-confirm-yes").addEventListener("click", async () => {
  const btn = document.getElementById("uninstall-confirm-yes");
  btn.disabled = true;
  btn.textContent = "Desinstalando…";
  const res = await api().uninstall_tools();
  closeUninstallConfirm();
  btn.disabled = false;
  btn.textContent = "Desinstalar";
  if (res && res.ok) {
    setStatus("✓ Eclipse Tools desinstalado.");
    refreshState();
  } else {
    setStatus(`✗ ${(res && res.msg) || "No se pudo desinstalar."}`);
  }
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
document.getElementById("settings-create-launcher-shortcut").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  const res = await api().create_launcher_shortcut();
  btn.textContent = res && res.ok ? "✓ Creado" : "✗ Error";
  setTimeout(() => { btn.textContent = original; }, 2000);
});

// ── rail de apps (hoy solo Eclipse Tools) ─────────────────────────────
document.querySelectorAll(".app-rail-item:not(.app-rail-empty)").forEach((btn) => {
  btn.addEventListener("click", () => btn.classList.add("active"));
});

// ── links externos (social rail + accesos rápidos) ───────────────────
// "report" apunta al canal de bugs de Discord — si el que clickea ya es
// miembro del server, el enlace de invite lo redirige directo a ese canal;
// si no lo es, primero lo hace unirse y desde ahí puede navegar al canal.
const DISCORD_BUG_CHANNEL_ID = "1313170797095026748";
const EXTERNAL_LINKS = {
  discord: "https://discord.gg/VmGaPZCFVt",
  docs: "https://www.eclipse1940zone.online/",
  web: "https://www.eclipse1940zone.online/",
  report: `https://discord.com/channels/943926654655430756/${DISCORD_BUG_CHANNEL_ID}`,
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

// ── Wiki/Info — panel de pantalla completa estilo "página de personaje"
// (sidebar de categorías + panel grande + tira de miniaturas). Todas las
// entradas están agrupadas por categoría; cada categoría tiene su propia
// tira de miniaturas abajo, igual que Mondstadt/Liyue/etc. en Genshin. ──
// Novedades — layout especial tipo página "News" de Genshin: grid de
// destacadas arriba, tabs (Últimas/Info/Actualizaciones/Eventos), lista
// debajo, y detalle con breadcrumb al hacer clic. "featured:true" define
// cuáles entran al grid de arriba (máx. 3 se muestran).
const WIKI_NEWS = [
  {
    tab: "ultimas", tag: "MEJORA", featured: true, icon: "🔄",
    title: "Motor Multi-Engine renovado", date: "",
    summary: "Google + Yandex + MyMemory en cascada, más rápido y confiable.",
    body: "El sistema que traduce el texto ahora combina Google, Yandex y MyMemory en cascada: si uno falla o tarda, prueba el siguiente automáticamente. Resultado: traducciones más rápidas y confiables que antes.",
  },
  {
    tab: "ultimas", tag: "MEJORA", featured: true, icon: "🗂️",
    title: "Interfaz reorganizada", date: "",
    summary: "Secciones plegables en Ren'Py, RPG Maker y Configuración.",
    body: "Ren'Py, RPG Maker y Configuración ya no son una lista larga de tarjetas — ahora están agrupadas en secciones plegables, más fácil de navegar.",
  },
  {
    tab: "ultimas", tag: "FIX", featured: true, icon: "🩹",
    title: "Nombres compuestos arreglados", date: "",
    summary: "\"Uncle Pete\" y similares ya traducen bien.",
    body: "Casos tipo \"Uncle Pete\" (título + nombre propio pegados) ahora traducen bien el título y respetan el nombre propio sin traducirlo por error.",
  },
  {
    tab: "actualizaciones", tag: "FIX", icon: "🔧",
    title: "Actualizaciones más confiables", date: "",
    summary: "El instalador de actualizaciones quedó más robusto.",
    body: "El sistema que instala las actualizaciones automáticas quedó más robusto ante casos raros del lado del usuario (conexión cortada, permisos, etc.).",
  },
  {
    tab: "info", tag: "INFO", icon: "🎮",
    title: "Motores de juego soportados", date: "",
    summary: "Ren'Py, RPG Maker (MV/MZ/XP/VX/Ace), Godot y Unity.",
    body: "Eclipse Tools traduce juegos hechos en Ren'Py, RPG Maker (MV/MZ/XP/VX/Ace), Godot y Unity (incluyendo IL2CPP), además de juegos Tyrano/Electron empaquetados en .asar. Mirá la categoría \"Motores\" del menú para el detalle de cada uno.",
  },
  {
    tab: "info", tag: "INFO", icon: "🧠",
    title: "Motores de traducción", date: "",
    summary: "Online (Google, Yandex, MyMemory) o local/offline (Argos).",
    body: "Podés traducir usando servicios online (Google, Yandex, MyMemory) o de forma local/offline con Argos, sin depender de internet. Vos elegís según prioricés velocidad, calidad o privacidad.",
  },
  {
    tab: "info", tag: "INFO", icon: "🆓",
    title: "Gratis para empezar", date: "",
    summary: "Todo lo esencial funciona sin licencia.",
    body: "Todo lo esencial de Eclipse Tools funciona sin licencia — la versión paga solo agrega el traductor OCR (texto dentro de imágenes) y los motores de traducción por IA (LLM).",
  },
  {
    tab: "eventos", tag: "EVENTO", icon: "🎉",
    title: "Sin eventos por ahora", date: "",
    summary: "Seguí el Discord para enterarte apenas haya novedades.",
    body: "Seguí el Discord para enterarte apenas haya sorteos, betas o novedades antes que nadie.",
  },
  {
    tab: "eventos", tag: "EVENTO", icon: "💡",
    title: "¿Tenés una idea o pedido?", date: "",
    summary: "Contanos en Discord — la mayoría de las funciones nuevas salieron de ahí.",
    body: "Contanos en el servidor de Discord — la mayoría de las funciones nuevas salieron de pedidos de la comunidad.",
  },
];
const WIKI_NEWS_TABS = [
  { id: "ultimas", label: "Últimas" },
  { id: "info", label: "Info" },
  { id: "actualizaciones", label: "Actualizaciones" },
  { id: "eventos", label: "Eventos" },
];
let wikiNewsTab = "ultimas";
let wikiNewsDetail = null;

const WIKI_CATEGORIES = [
  {
    id: "motores", label: "Motores", icon: "🎮",
    entries: [
      {
        icon: "📗", title: "Ren'Py",
        body: "El motor más usado para novelas visuales. Eclipse Tools abre el juego (esté con el código a la vista o compilado y comprimido), saca todo el texto de diálogos y menús, lo traduce y lo vuelve a meter adentro para que el juego funcione igual que antes, pero en tu idioma.",
        formats: [".rpy", ".rpyc", ".rpa"],
      },
      {
        icon: "🗡️", title: "RPG Maker MV / MZ / VX Ace",
        body: "Motor clásico de JRPGs indie. Traduce diálogos de eventos, nombres de objetos/habilidades/personajes y hasta texto agregado por plugins de terceros. VX Ace usa un formato de archivo más viejo que MV/MZ, pero Eclipse Tools reconoce automáticamente cuál es tu juego: vos solo elegís la carpeta.",
        formats: ["data/*.json", ".rvdata2", "events"],
      },
      {
        icon: "⚙️", title: "Unity (IL2CPP)",
        body: "Muchos juegos de Unity están compilados con una tecnología (IL2CPP) que esconde el texto de forma más difícil de leer que un Unity normal, y por eso antes no se podían traducir. Eclipse Tools sabe leer ese formato especial y reemplaza el texto sin romper el juego.",
        formats: ["global-metadata.dat", "il2cpp"],
      },
      {
        icon: "📦", title: "Tyrano / Electron",
        body: "Juegos hechos con TyranoScript y empaquetados como programa de escritorio (Electron, la misma tecnología detrás de Discord). Todo el juego queda comprimido en un solo archivo; Eclipse Tools lo abre, traduce el texto de adentro y lo vuelve a armar, guardando siempre una copia de seguridad por si algo sale mal.",
        formats: ["app.asar"],
      },
      {
        icon: "🐦", title: "Godot",
        body: "Motor libre y gratuito, cada vez más popular entre desarrolladores indie. Eclipse Tools localiza los diálogos y recursos de texto del proyecto exportado y los traduce manteniendo la estructura original del juego.",
        formats: [".pck", ".tscn"],
      },
      {
        icon: "✨", title: "Y más motores",
        body: "¿Tu juego usa un motor que no está en esta lista? El equipo sigue agregando soporte para nuevos motores con cada actualización de Eclipse Tools — escribinos por Discord si querés pedir uno.",
        formats: ["actualizaciones constantes"],
      },
    ],
  },
  { id: "novedades", label: "Novedades", icon: "🆕", special: "news" },
  {
    id: "guia", label: "Cómo usar", icon: "📘",
    entries: [
      {
        icon: "1️⃣", title: "Instalá Eclipse Tools",
        body: "Desde este mismo Launcher, tocá el botón grande \"Descargar\". Se instala solo, sin pasos extra — y a partir de ahí el Launcher se encarga de mantenerlo actualizado.",
      },
      {
        icon: "2️⃣", title: "Abrí tu juego",
        body: "Dentro de Eclipse Tools, seleccioná la carpeta del juego que querés traducir. El programa detecta automáticamente qué motor usa (Ren'Py, RPG Maker, Unity, etc.) y te muestra las opciones correspondientes.",
      },
      {
        icon: "3️⃣", title: "Elegí tu motor de traducción",
        body: "Podés traducir online (Google, Yandex, MyMemory) o local/offline con Argos, sin depender de internet. La calidad y velocidad varían según cuál elijas.",
      },
      {
        icon: "4️⃣", title: "Traducí y jugá",
        body: "Eclipse Tools extrae el texto, lo traduce y lo reinyecta en el juego manteniendo todo lo demás intacto (imágenes, sonidos, guardado). Cuando termina, el juego ya está listo para jugarse en tu idioma.",
      },
    ],
  },
  {
    id: "comunidad", label: "Comunidad", icon: "💬",
    entries: [
      {
        icon: "💬", title: "Discord",
        body: "Reportá bugs, pedí soporte, sugerí motores nuevos o simplemente charlá con otros usuarios que también traducen juegos.",
        link: "discord",
      },
      {
        icon: "🌐", title: "Eclipse Hub",
        body: "La versión web del proyecto — funciona en cualquier navegador de PC o celular, sin instalar nada, con cuentas sincronizadas, comunidad y contenido exclusivo de Patreon.",
        link: "web",
      },
      {
        icon: "📘", title: "Documentación",
        body: "Guías más detalladas sobre cada función de Eclipse Tools, para cuando necesités algo más específico que esta introducción rápida.",
        link: "docs",
      },
    ],
  },
];

let wikiActiveCat = WIKI_CATEGORIES[0].id;
let wikiActiveIdx = 0;

function wikiCategory(id) {
  return WIKI_CATEGORIES.find((c) => c.id === id) || WIKI_CATEGORIES[0];
}

function renderWikiSidebar() {
  const sidebar = document.getElementById("wiki-sidebar");
  sidebar.innerHTML = WIKI_CATEGORIES.map((cat) => `
    <button class="wiki-sidebar-item${cat.id === wikiActiveCat ? " active" : ""}" data-cat="${cat.id}">
      <span>${cat.icon}</span><span>${cat.label}</span>
    </button>`
  ).join("");
  sidebar.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      wikiActiveCat = btn.dataset.cat;
      wikiActiveIdx = 0;
      wikiNewsDetail = null;
      renderWikiSidebar();
      renderWikiBody();
    });
  });
}

function renderWikiBody() {
  const cat = wikiCategory(wikiActiveCat);
  if (cat.special === "news") {
    document.getElementById("wiki-strip").hidden = true;
    renderWikiNews();
  } else {
    document.getElementById("wiki-strip").hidden = false;
    renderWikiEntry();
    renderWikiStrip();
  }
}

function renderWikiEntry() {
  const cat = wikiCategory(wikiActiveCat);
  const entry = cat.entries[wikiActiveIdx] || cat.entries[0];
  const content = document.getElementById("wiki-content");
  content.innerHTML = `
    <span class="wiki-entry-tag">${cat.label.toUpperCase()}</span>
    <h2 class="wiki-entry-title">${entry.icon} ${entry.title}</h2>
    <p class="wiki-entry-body">${entry.body}</p>
    ${entry.formats ? `<div class="wiki-entry-formats">${entry.formats.map((f) => `<span>${f}</span>`).join("")}</div>` : ""}
  `;
  if (entry.link) {
    const linkBtn = document.createElement("button");
    linkBtn.className = "settings-link";
    linkBtn.style.marginTop = "14px";
    linkBtn.textContent = "Abrir →";
    linkBtn.addEventListener("click", () => {
      const url = EXTERNAL_LINKS[entry.link];
      if (url) api().open_link(url);
    });
    content.appendChild(linkBtn);
  }
}

function renderWikiStrip() {
  const cat = wikiCategory(wikiActiveCat);
  const strip = document.getElementById("wiki-strip");
  strip.innerHTML = cat.entries.map((entry, i) => `
    <button class="wiki-thumb${i === wikiActiveIdx ? " active" : ""}" data-idx="${i}">
      <span class="wiki-thumb-icon">${entry.icon}</span><span>${entry.title}</span>
    </button>`
  ).join("");
  strip.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      wikiActiveIdx = Number(btn.dataset.idx);
      renderWikiEntry();
      renderWikiStrip();
    });
  });
}

// ── Novedades — layout especial (grid destacado + tabs + lista + detalle
// con breadcrumb), separado del layout genérico de tarjeta/tira. ──
function renderWikiNews() {
  const content = document.getElementById("wiki-content");
  if (wikiNewsDetail !== null) {
    const item = WIKI_NEWS[wikiNewsDetail];
    content.innerHTML = `
      <div class="wiki-news-crumb">
        <span class="wiki-news-crumb-link" id="wiki-news-back">🆕 Novedades</span>
        <span> › </span><span>${item.title}</span>
      </div>
      <span class="wiki-entry-tag">${item.tag}</span>
      <h2 class="wiki-entry-title">${item.icon} ${item.title}</h2>
      <p class="wiki-entry-body">${item.body}</p>
    `;
    document.getElementById("wiki-news-back").addEventListener("click", () => {
      wikiNewsDetail = null;
      renderWikiNews();
    });
    return;
  }

  const featured = WIKI_NEWS.filter((n) => n.featured).slice(0, 3);
  const items = WIKI_NEWS.filter((n) => n.tab === wikiNewsTab);

  content.innerHTML = `
    <span class="wiki-entry-tag">NOVEDADES</span>
    <div class="wiki-news-featured">
      ${featured.map((n) => `
        <button class="wiki-news-feat-card" data-news="${WIKI_NEWS.indexOf(n)}">
          <span class="wiki-news-feat-icon">${n.icon}</span>
          <span class="wiki-news-feat-tag">${n.tag}</span>
          <span class="wiki-news-feat-title">${n.title}</span>
          <span class="wiki-news-feat-sum">${n.summary}</span>
        </button>`
      ).join("")}
    </div>
    <div class="wiki-news-tabs">
      ${WIKI_NEWS_TABS.map((t) => `
        <button class="wiki-news-tab${t.id === wikiNewsTab ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`
      ).join("")}
    </div>
    <ul class="wiki-news-list">
      ${items.map((n) => `
        <li data-news="${WIKI_NEWS.indexOf(n)}">
          <span class="wiki-news-list-icon">${n.icon}</span>
          <div class="wiki-news-list-text">
            <span class="wiki-news-list-title">${n.title}</span>
            <span class="wiki-news-list-sum">${n.summary}</span>
          </div>
          <span class="wiki-news-list-chevron">›</span>
        </li>`
      ).join("")}
    </ul>
  `;

  content.querySelectorAll("[data-news]").forEach((el) => {
    el.addEventListener("click", () => {
      wikiNewsDetail = Number(el.dataset.news);
      renderWikiNews();
    });
  });
  content.querySelectorAll(".wiki-news-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      wikiNewsTab = btn.dataset.tab;
      renderWikiNews();
    });
  });
}

function openWiki() {
  wikiActiveCat = WIKI_CATEGORIES[0].id;
  wikiActiveIdx = 0;
  wikiNewsTab = "ultimas";
  wikiNewsDetail = null;
  renderWikiSidebar();
  renderWikiBody();
  document.getElementById("wiki-overlay").hidden = false;
}
function closeWiki() {
  document.getElementById("wiki-overlay").hidden = true;
}
document.getElementById("btn-wiki").addEventListener("click", openWiki);
document.getElementById("wiki-close").addEventListener("click", closeWiki);
document.getElementById("wiki-overlay").addEventListener("click", (e) => {
  if (e.target.id === "wiki-overlay") closeWiki();
});

document.getElementById("btn-min").addEventListener("click", () => {
  // BUGFIX reportado: "pywebview.window" no existe — pywebview solo expone
  // como window.pywebview.api.* los métodos pasados como js_api (ver Api en
  // launcher.py). minimize_window()/close_window() son el bridge real.
  api().minimize_window();
});
document.getElementById("btn-close").addEventListener("click", () => {
  api().close_window();
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

// Arrastrar el reproductor flotante — mismo mecanismo que Eclipse Tools
// (ver wireRadioWidgetDrag en EclipseTools/web/js/app.js): antes quedaba
// siempre fijo en left:20px/bottom:90px, se arrastra desde cualquier
// punto que no sea un botón (play/next siguen siendo clicks normales) y
// la posición elegida se guarda en localStorage para la próxima vez.
const RADIO_POS_KEY = "eclipseLauncherRadioPos";

function wireRadioWidgetDrag(widget) {
  let dragging = false;
  let startX = 0, startY = 0;
  let originLeft = 0, originTop = 0;

  function applyPosition(left, top) {
    const w = widget.offsetWidth, h = widget.offsetHeight;
    const maxLeft = Math.max(0, window.innerWidth - w);
    const maxTop = Math.max(0, window.innerHeight - h);
    left = Math.min(Math.max(0, left), maxLeft);
    top = Math.min(Math.max(0, top), maxTop);
    widget.style.left = `${left}px`;
    widget.style.top = `${top}px`;
    widget.style.right = "auto";
    widget.style.bottom = "auto";
    return { left, top };
  }

  try {
    const saved = JSON.parse(localStorage.getItem(RADIO_POS_KEY) || "null");
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      applyPosition(saved.left, saved.top);
    }
  } catch (_) { /* localStorage corrupto o vacío: se queda con el CSS */ }

  function onPointerDown(e) {
    if (e.target.closest("button")) return;
    dragging = true;
    widget.classList.add("dragging");
    widget.setPointerCapture(e.pointerId);
    const rect = widget.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    applyPosition(originLeft + dx, originTop + dy);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    widget.classList.remove("dragging");
    try { widget.releasePointerCapture(e.pointerId); } catch (_) { /* ya liberado */ }
    const rect = widget.getBoundingClientRect();
    localStorage.setItem(RADIO_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  widget.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  window.addEventListener("resize", () => {
    const rect = widget.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  });
}

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

  if (widget) {
    widget.style.display = "flex";
    wireRadioWidgetDrag(widget);
  }
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
