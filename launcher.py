#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ================================================================
#  ESTE CÓDIGO PERTENECE A SENPAI1940 — Eclipse Zone.
#  Está TOTALMENTE PROHIBIDO copiar, redistribuir, descompilar o
#  ayudar a cualquier persona a robar o crackear este software.
# ================================================================
# launcher.py — Eclipse Launcher (v1.0)
#
# ÚNICO objetivo: bajar/actualizar Eclipse Tools y abrirlo. A propósito
# NO hace nada más — sin licencia, sin traducción, sin nada que agregue
# superficie de "comportamiento raro" a ojos de un antivirus heurístico.
# Mismo criterio ya probado en este proyecto con webview2_setup.py
# (bootstrapper visible, carpeta estable, sin auto-borrarse).
#
# Este launcher SÍ se publica en un repo PÚBLICO de GitHub (a diferencia
# de "eclipse-releases", que es privado) — es la puerta de entrada
# pública, así que se descarga sin login ni token. Una vez corriendo,
# baja el .zip de Eclipse Tools desde el Worker de licencias, que YA
# sirve /update/manifest y /update/download SIN exigir licencia (ver
# license-worker.js, handleUpdateManifest/handleUpdateDownload — Free
# tiene el mismo acceso a la descarga que un usuario pago).
#
# Carpeta de instalación FIJA (no la elige el usuario, como cualquier
# app normal): %LOCALAPPDATA%\EclipseTools\App\ — no pide admin. El
# acceso directo al .exe SÍ lo elige el usuario (default: Escritorio).
# ================================================================

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import webview

APP_NAME = "EclipseTools"
LICENSE_API_BASE = "https://eclipse-license.espectador722.workers.dev"
LAUNCHER_VERSION = "1.0.2"

_HERE = os.path.dirname(os.path.abspath(__file__))


def _install_root():
    """Carpeta fija de instalación — %LOCALAPPDATA%\\EclipseTools\\App\\.
    Por-usuario a propósito (mismo criterio que el resto del proyecto):
    nunca hace falta admin para instalar ni actualizar."""
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = Path(base) / APP_NAME / "App"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _state_file():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = Path(base) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d / "launcher_state.json"


def _start_menu_dir():
    """Carpeta 'Programas' del Menú Inicio del usuario actual — ruta
    estándar de Windows, sin admin."""
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = Path(base) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_state():
    try:
        return json.loads(_state_file().read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(**kv):
    st = _load_state()
    st.update(kv)
    try:
        _state_file().write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


_STARTUP_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
_STARTUP_REG_NAME = "EclipseLauncher"


def _startup_enabled():
    """Lee HKCU\\...\\Run — sin admin, por-usuario, mismo criterio de
    'nunca pedir privilegios de más' que el resto del proyecto."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _STARTUP_REG_PATH) as k:
            winreg.QueryValueEx(k, _STARTUP_REG_NAME)
            return True
    except Exception:
        return False


def _set_startup_enabled(enabled):
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _STARTUP_REG_PATH, 0, winreg.KEY_SET_VALUE) as k:
            if enabled:
                exe = sys.executable if getattr(sys, "frozen", False) else __file__
                winreg.SetValueEx(k, _STARTUP_REG_NAME, 0, winreg.REG_SZ, f'"{exe}"')
            else:
                try:
                    winreg.DeleteValue(k, _STARTUP_REG_NAME)
                except FileNotFoundError:
                    pass
    except Exception:
        pass


_UNINSTALL_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\EclipseLauncher"


def _folder_size_kb(path):
    total = 0
    try:
        for p in Path(path).rglob("*"):
            if p.is_file():
                try:
                    total += p.stat().st_size
                except Exception:
                    pass
    except Exception:
        pass
    return total // 1024


def _register_uninstall_entry():
    """Entrada por-usuario (HKCU) en 'Agregar o quitar programas' — sin
    admin, mismo criterio que el Run key de inicio con Windows. Se
    reescribe cada vez que hay una instalación/actualización exitosa o
    se crea el acceso directo del propio Launcher, para que Windows
    sepa de este 'programa' apenas hay algo instalado que desinstalar."""
    try:
        self_exe = sys.executable if getattr(sys, "frozen", False) else __file__
        if Path(self_exe).name.lower() in ("python.exe", "pythonw.exe", "py.exe"):
            return
        import winreg
        size_kb = _folder_size_kb(Path(self_exe).parent) + _folder_size_kb(_install_root())
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _UNINSTALL_REG_PATH) as k:
            winreg.SetValueEx(k, "DisplayName", 0, winreg.REG_SZ, "Eclipse Launcher")
            winreg.SetValueEx(k, "DisplayIcon", 0, winreg.REG_SZ, self_exe)
            winreg.SetValueEx(k, "DisplayVersion", 0, winreg.REG_SZ, LAUNCHER_VERSION)
            winreg.SetValueEx(k, "Publisher", 0, winreg.REG_SZ, "Eclipse Zone")
            winreg.SetValueEx(k, "InstallLocation", 0, winreg.REG_SZ, str(Path(self_exe).parent))
            winreg.SetValueEx(k, "UninstallString", 0, winreg.REG_SZ, f'"{self_exe}" --uninstall')
            winreg.SetValueEx(k, "QuietUninstallString", 0, winreg.REG_SZ, f'"{self_exe}" --uninstall --silent')
            winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)
            if size_kb:
                winreg.SetValueEx(k, "EstimatedSize", 0, winreg.REG_DWORD, size_kb)
    except Exception:
        pass


def _unregister_uninstall_entry():
    try:
        import winreg
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, _UNINSTALL_REG_PATH)
    except Exception:
        pass


def _add_shortcut_path(path):
    """Registra dónde se creó cada .lnk para poder borrarlo con certeza
    al desinstalar (antes no se guardaba, así que un uninstall solo
    podía adivinar Escritorio/Menú Inicio)."""
    st = _load_state()
    paths = st.get("shortcut_paths", [])
    path = str(path)
    if path not in paths:
        paths.append(path)
    _save_state(shortcut_paths=paths)


def _remove_known_shortcuts():
    st = _load_state()
    for p in st.get("shortcut_paths", []):
        try:
            Path(p).unlink(missing_ok=True)
        except Exception:
            pass
    # Fallback por si el estado se perdió: rutas estándar conocidas.
    for name in ("Eclipse Tools.lnk", "Eclipse Launcher.lnk"):
        for base in (Path(os.path.join(os.path.expanduser("~"), "Desktop")), _start_menu_dir()):
            try:
                (base / name).unlink(missing_ok=True)
            except Exception:
                pass


def _uninstall_tools_files():
    """Borra SOLO lo que pertenece a Eclipse Tools (la app instalada),
    dejando el Launcher intacto — usado tanto por Api.uninstall_tools()
    (botón en la UI) como por _uninstall_everything() (desinstalar todo
    desde Windows)."""
    shutil.rmtree(_install_root(), ignore_errors=True)
    appdata = os.environ.get("APPDATA")
    if appdata:
        shutil.rmtree(Path(appdata) / APP_NAME, ignore_errors=True)
    for p in Path.home().glob(".eclipse_tools_*"):
        try:
            p.unlink()
        except Exception:
            pass
    st = _load_state()
    remaining = [p for p in st.get("shortcut_paths", []) if "eclipse tools" not in Path(p).stem.lower()]
    for p in st.get("shortcut_paths", []):
        if "eclipse tools" in Path(p).stem.lower():
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass
    for base in (Path(os.path.join(os.path.expanduser("~"), "Desktop")), _start_menu_dir()):
        try:
            (base / "Eclipse Tools.lnk").unlink(missing_ok=True)
        except Exception:
            pass
    _save_state(installed_version="", shortcut_paths=remaining)


def _uninstall_everything():
    """Borrado en cascada completo — llamado desde 'Agregar o quitar
    programas' (Launcher.exe --uninstall). Deja el sistema como si
    Eclipse Launcher nunca se hubiera instalado."""
    _uninstall_tools_files()
    local = os.environ.get("LOCALAPPDATA")
    if local:
        try:
            (Path(local) / APP_NAME / "launcher_state.json").unlink(missing_ok=True)
        except Exception:
            pass
    _set_startup_enabled(False)
    _remove_known_shortcuts()
    _unregister_uninstall_entry()
    # El proceso no puede borrar su propia carpeta mientras sigue
    # corriendo — se lanza un .bat de un solo uso que espera a que este
    # proceso termine y recién ahí borra la carpeta (mismo truco que
    # cualquier auto-borrado en Windows, ya usado antes en este proyecto
    # para el self-updater que se quitó de Eclipse Tools).
    try:
        self_exe = sys.executable if getattr(sys, "frozen", False) else None
        if self_exe:
            install_dir = Path(self_exe).parent
            bat = Path(tempfile.gettempdir()) / "eclipse_launcher_uninstall.bat"
            bat.write_text(
                "@echo off\r\n"
                "timeout /t 2 /nobreak > nul\r\n"
                f'rmdir /s /q "{install_dir}"\r\n'
                f'del "%~f0"\r\n',
                encoding="utf-8",
            )
            subprocess.Popen(
                ["cmd", "/c", str(bat)],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
    except Exception:
        pass


def _find_installed_exe():
    """Busca el .exe principal dentro de la carpeta instalada — no se
    asume un nombre fijo (puede cambiar entre versiones, ver el mismo
    problema resuelto en updater.py/install_exe): el único .exe grande
    en la raíz, que no sea un helper conocido."""
    root = _install_root()
    exes = [p for p in root.glob("*.exe")
            if "uninstall" not in p.name.lower()]
    if not exes:
        return None
    return max(exes, key=lambda p: p.stat().st_size)


def _find_stray_tools_install():
    """Busca una instalación de Eclipse Tools hecha A MANO (zip bajado
    directo, no a través del Launcher) en ubicaciones típicas donde la
    gente descomprime cosas — Escritorio, Descargas, Documentos.

    Señal de que existe algo en algún lado: ~/.eclipse_tools_prefs.json
    (Eclipse Tools lo crea la primera vez que corre, sin importar dónde
    esté el .exe — mismo dotfile que ya usa _uninstall_everything() vía
    Path.home().glob(".eclipse_tools_*")). Si existe pero
    _find_installed_exe() (que solo mira _install_root(), la carpeta
    gestionada por el Launcher) no encuentra nada, hay una copia suelta
    sin gestionar. Devuelve la carpeta que contiene el .exe encontrado,
    o None si no hay indicios de nada."""
    if _find_installed_exe() is not None:
        return None
    if not (Path.home() / ".eclipse_tools_prefs.json").exists():
        return None
    search_roots = [
        Path(os.path.join(os.path.expanduser("~"), "Desktop")),
        Path(os.path.join(os.path.expanduser("~"), "Downloads")),
        Path(os.path.join(os.path.expanduser("~"), "Documents")),
    ]
    for base in search_roots:
        if not base.is_dir():
            continue
        try:
            for exe in base.glob("**/Eclipse Tools.exe"):
                # Ignora carpetas de build dentro del propio repo de código
                # fuente (Eclipse-Source\EclipseTools\dist_nuitka*) — no son
                # una instalación de usuario, son output de compilar.
                if "eclipse-source" in str(exe).lower():
                    continue
                return exe.parent
        except Exception:
            continue
    return None


def _ver(v_str):
    try:
        return tuple(int(x) for x in str(v_str).strip().split("."))
    except Exception:
        return (0,)


def fetch_manifest(timeout=10):
    """Mismo endpoint que usa el auto-updater adentro de Eclipse Tools
    — SIN licencia (ver comentario grande arriba)."""
    url = f"{LICENSE_API_BASE}/update/manifest"
    req = urllib.request.Request(
        url, headers={"User-Agent": f"EclipseLauncher/{LAUNCHER_VERSION}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def download_asset(asset_name, dest_path, progress_cb=None, timeout=180):
    url = f"{LICENSE_API_BASE}/update/download?" + urllib.parse.urlencode({"asset": asset_name})
    req = urllib.request.Request(
        url, headers={"User-Agent": f"EclipseLauncher/{LAUNCHER_VERSION}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        with open(dest_path, "wb") as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if progress_cb:
                    progress_cb(done, total)


def _verify_sha256(path, expected):
    if not expected:
        return True
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().lower() == expected.strip().lower()


def _create_desktop_shortcut(target_exe, dest_dir=None, log=None, shortcut_name="Eclipse Tools"):
    """Crea un .lnk sin depender de pywin32 (mantener el launcher LO
    MÁS CHICO Y ABURRIDO POSIBLE — cuantas menos libs raras, menos
    superficie para que un antivirus dude). Se arma con un mini-script
    de PowerShell vía el objeto COM WScript.Shell, que ya trae Windows
    de fábrica — cero dependencias nuevas.

    shortcut_name: además del acceso a Eclipse Tools.exe, se usa el
    mismo helper para crear el del propio Eclipse Launcher.exe — así
    el usuario siempre tiene forma fácil de volver acá para actualizar
    (mismo patrón que "abrir el launcher del juego para actualizar")."""
    log = log or (lambda s: None)
    try:
        if dest_dir is None:
            dest_dir = Path(os.path.join(os.path.expanduser("~"), "Desktop"))
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        lnk_path = dest_dir / f"{shortcut_name}.lnk"
        target_exe = str(target_exe)
        work_dir = str(Path(target_exe).parent)
        ps = (
            "$s = New-Object -ComObject WScript.Shell;"
            f"$sc = $s.CreateShortcut('{lnk_path}');"
            f"$sc.TargetPath = '{target_exe}';"
            f"$sc.WorkingDirectory = '{work_dir}';"
            f"$sc.IconLocation = '{target_exe}';"
            "$sc.Save()"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
            check=True, capture_output=True, timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return True
    except Exception as e:
        log(f"No se pudo crear el acceso directo: {e}")
        return False


class Api:
    def __init__(self):
        self._window = None

    def set_window(self, w):
        self._window = w

    def minimize_window(self, _=None):
        # BUGFIX reportado: el botón minimizar/cerrar del titlebar propio
        # llamaba a "pywebview.window.minimize()"/"window.close()" del lado
        # JS, pero pywebview no expone ningún objeto "pywebview.window" —
        # solo expone los métodos que se pasan como js_api (esta clase). El
        # bridge real para controlar la ventana es este, vía self._window
        # (ya seteado por set_window en main()).
        if self._window:
            self._window.minimize()

    def close_window(self, _=None):
        if self._window:
            self._window.destroy()

    def get_state(self, _=None):
        """v1.0.1 — ahora TAMBIÉN chequea si hay una actualización de
        Eclipse Tools disponible (no solo si está instalado). Antes el
        botón principal solo distinguía Descargar/Jugar — una vez
        instalado quedaba en "Jugar" para siempre, aunque hubiera
        versión nueva, así que el launcher nunca ofrecía actualizar (a
        diferencia de un launcher de juego real, que muestra
        Actualizar/Pre-descarga cuando corresponde). El chequeo de red
        es best-effort: si falla (sin internet), simplemente no se
        marca actualización disponible — no bloquea nada."""
        installed_exe = _find_installed_exe()
        st = _load_state()
        installed_v = st.get("installed_version", "") if installed_exe else ""
        update_available = False
        latest_v = ""
        try:
            manifest = fetch_manifest(timeout=5)
            latest_v = manifest.get("tools_version", "")
            if installed_exe and latest_v and _ver(latest_v) > _ver(installed_v):
                update_available = True
        except Exception:
            pass
        stray = _find_stray_tools_install()
        return {
            "installed": installed_exe is not None,
            "installedVersion": installed_v,
            "launcherVersion": LAUNCHER_VERSION,
            "updateAvailable": update_available,
            "latestVersion": latest_v,
            "strayInstallPath": str(stray) if stray else "",
        }

    def check_and_install(self, shortcut_mode="desktop", call_id=None):
        """Descarga (primera vez) o actualiza Eclipse Tools, en un hilo
        de fondo — progreso se manda vía window.evaluate_js.

        v1.0.1 — shortcut_mode reemplaza al viejo choose_shortcut_dir
        (booleano): "desktop" (default) y "startmenu" resuelven la
        carpeta ellos mismos, SIN ningún diálogo — "browse" es el único
        caso que abre el selector nativo de Windows, como último
        recurso para quien de verdad quiera otro lugar (pedido: el
        selector nativo desentona con el resto del launcher, mejor
        evitarlo salvo que haga falta de verdad)."""
        def emit(event, data):
            if not self._window:
                return
            try:
                payload = json.dumps(data)
                self._window.evaluate_js(f"window.onLauncherEvent({event!r}, {payload})")
            except Exception:
                pass

        def _job():
            try:
                emit("status", {"msg": "Buscando la última versión…"})
                manifest = fetch_manifest()
                latest_v = manifest.get("tools_version", "0")
                asset_name = manifest.get("tools_asset_name", "Eclipse Tools.zip")
                st = _load_state()
                installed_exe = _find_installed_exe()
                installed_v = st.get("installed_version", "0") if installed_exe else "0"

                if installed_exe and _ver(installed_v) >= _ver(latest_v):
                    emit("done", {"launched": False, "upToDate": True})
                    return

                emit("status", {"msg": f"Descargando Eclipse Tools v{latest_v}…"})
                fd, tmp_zip = tempfile.mkstemp(suffix=".zip")
                os.close(fd)

                def _prog(done, total):
                    pct = int(done * 100 / total) if total else 0
                    emit("progress", {"pct": pct, "done": done, "total": total})

                try:
                    download_asset(asset_name, tmp_zip, progress_cb=_prog)

                    emit("status", {"msg": "Verificando integridad…"})
                    if not _verify_sha256(tmp_zip, manifest.get("tools_sha256", "")):
                        emit("error", {"msg": "La descarga no pasó la verificación de integridad. Probá de nuevo."})
                        return

                    emit("status", {"msg": "Instalando…"})
                    root = _install_root()
                    with tempfile.TemporaryDirectory() as tmp_extract:
                        with zipfile.ZipFile(tmp_zip, "r") as zf:
                            zf.extractall(tmp_extract)
                        inner = Path(tmp_extract) / "Eclipse Tools"
                        src = inner if inner.is_dir() else Path(tmp_extract)
                        # Sincroniza la carpeta completa (borra lo viejo que
                        # ya no está en la versión nueva, como robocopy /MIR).
                        for item in root.iterdir():
                            try:
                                if item.is_dir():
                                    shutil.rmtree(item, ignore_errors=True)
                                else:
                                    item.unlink()
                            except Exception:
                                pass
                        for item in src.iterdir():
                            dest = root / item.name
                            if item.is_dir():
                                shutil.copytree(item, dest, dirs_exist_ok=True)
                            else:
                                shutil.copy2(item, dest)
                finally:
                    try:
                        os.unlink(tmp_zip)
                    except Exception:
                        pass

                _save_state(installed_version=latest_v)
                exe = _find_installed_exe()
                if not exe:
                    emit("error", {"msg": "Se instaló pero no se encontró el ejecutable — revisá el zip."})
                    return

                emit("status", {"msg": "Creando acceso directo…"})
                shortcut_dir = None
                if shortcut_mode == "startmenu":
                    shortcut_dir = _start_menu_dir()
                elif shortcut_mode == "browse" and self._window:
                    chosen = self._window.create_file_dialog(webview.FOLDER_DIALOG)
                    if chosen:
                        shortcut_dir = chosen[0]
                    else:
                        # el usuario canceló el diálogo — no crear nada
                        # en vez de caer de nuevo al Escritorio sin avisar.
                        emit("done", {"launched": False, "upToDate": False, "version": latest_v, "noShortcut": True})
                        return
                if _create_desktop_shortcut(exe, dest_dir=shortcut_dir):
                    dest = shortcut_dir or Path(os.path.join(os.path.expanduser("~"), "Desktop"))
                    _add_shortcut_path(Path(dest) / "Eclipse Tools.lnk")
                _register_uninstall_entry()

                emit("done", {"launched": False, "upToDate": False, "version": latest_v})
            except urllib.error.URLError as e:
                emit("error", {"msg": f"Sin conexión o el servidor no respondió: {e}"})
            except Exception as e:
                emit("error", {"msg": f"Error inesperado: {e}"})

        threading.Thread(target=_job, daemon=True).start()
        return {"ok": True}

    def play(self, _=None):
        exe = _find_installed_exe()
        if not exe:
            return {"ok": False, "msg": "Eclipse Tools no está instalado todavía."}
        try:
            subprocess.Popen([str(exe)], cwd=str(exe.parent))
        except Exception as e:
            return {"ok": False, "msg": str(e)}
        # Se cierra el launcher unos segundos después de abrir la app
        # real — mismo patrón que cualquier launcher de juegos.
        threading.Thread(target=lambda: (time.sleep(1.5), os._exit(0)), daemon=True).start()
        return {"ok": True}

    def open_link(self, url):
        import webbrowser
        try:
            webbrowser.open(url)
        except Exception:
            pass
        return {"ok": True}

    def open_install_folder(self, _=None):
        root = _install_root()
        try:
            os.startfile(str(root))
        except Exception:
            pass
        return {"ok": True}

    def create_launcher_shortcut(self, _=None):
        """Acceso directo al PROPIO Eclipse Launcher.exe (no al de
        Eclipse Tools) — para que el usuario tenga una forma fácil de
        volver acá y buscar actualizaciones, ahora que este launcher es
        el único lugar donde Eclipse Tools se instala/actualiza (mismo
        criterio que el launcher de cualquier juego: siempre queda un
        acceso directo al launcher, no solo al juego)."""
        try:
            self_exe = Path(sys.executable)
        except Exception:
            return {"ok": False, "msg": "No se pudo determinar la ruta de este ejecutable."}
        if self_exe.name.lower() in ("python.exe", "pythonw.exe", "py.exe"):
            return {"ok": False, "msg": "Este acceso directo solo funciona en el build compilado."}
        ok = _create_desktop_shortcut(self_exe, shortcut_name="Eclipse Launcher")
        if not ok:
            return {"ok": False, "msg": "No se pudo crear el acceso directo."}
        _add_shortcut_path(Path(os.path.join(os.path.expanduser("~"), "Desktop")) / "Eclipse Launcher.lnk")
        _register_uninstall_entry()
        return {"ok": True}

    def resolve_stray_install(self, action=None, _=None):
        """Resuelve una instalación de Eclipse Tools encontrada suelta
        (ver _find_stray_tools_install) — borra esa carpeta vieja para
        que no queden dos copias. Tanto 'delete' como 'migrate' terminan
        borrando la copia suelta: no se copian sus archivos porque no
        hay forma de saber si esa versión está sana o corrupta — el
        camino seguro es borrar y dejar que el usuario baje la última
        versión desde el propio Launcher (flujo normal de
        check_and_install)."""
        stray = _find_stray_tools_install()
        if stray is None:
            return {"ok": True, "msg": "No se encontró ninguna instalación suelta."}
        try:
            shutil.rmtree(stray, ignore_errors=True)
        except Exception as e:
            return {"ok": False, "msg": str(e)}
        return {"ok": True}

    def uninstall_tools(self, _=None):
        """Desinstala SOLO Eclipse Tools (borra App\\, datos locales,
        acceso directo) — deja el Launcher intacto para poder volver a
        instalar después. Botón '🗑 Desinstalar Eclipse Tools' del menú
        ☰ (ver web/js/launcher.js)."""
        try:
            _uninstall_tools_files()
        except Exception as e:
            return {"ok": False, "msg": str(e)}
        return {"ok": True}

    def get_settings(self, _=None):
        st = _load_state()
        return {
            "startup": _startup_enabled(),
            "autoCheck": st.get("setting_autocheck", True),
            "closeOnLaunch": st.get("setting_closeonlaunch", True),
        }

    def save_settings(self, settings):
        _save_state(
            setting_autocheck=bool(settings.get("autoCheck", True)),
            setting_closeonlaunch=bool(settings.get("closeOnLaunch", True)),
        )
        _set_startup_enabled(bool(settings.get("startup", False)))
        return {"ok": True}


class _UninstallApi:
    def __init__(self, window_ref):
        self._window_ref = window_ref

    def confirm(self, _=None):
        _uninstall_everything()
        try:
            self._window_ref[0].destroy()
        except Exception:
            pass
        return {"ok": True}

    def cancel(self, _=None):
        try:
            self._window_ref[0].destroy()
        except Exception:
            pass
        return {"ok": True}


def run_uninstaller(silent=False):
    """Modo desinstalador — se invoca como '<Launcher.exe> --uninstall',
    que es el UninstallString registrado en 'Agregar o quitar programas'
    (ver _register_uninstall_entry). Con --silent no muestra ventana de
    confirmación (QuietUninstallString), útil si Windows lo llama sin
    interacción del usuario."""
    if silent:
        _uninstall_everything()
        return
    window_ref = [None]
    api = _UninstallApi(window_ref)
    html = """<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#0b0e14;color:#eef3f7;font-family:"Segoe UI",sans-serif;
        display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center}
      h2{margin:0 0 10px;font-size:16px}
      p{color:#b7c2cf;font-size:12.5px;max-width:320px;line-height:1.6}
      .row{display:flex;gap:10px;margin-top:18px}
      button{border:none;border-radius:8px;padding:10px 20px;font-weight:700;font-size:12.5px;cursor:pointer}
      #yes{background:#ff6b6b;color:#fff}
      #no{background:rgba(255,255,255,.08);color:#eef3f7}
    </style></head><body>
      <h2>Desinstalar Eclipse Launcher</h2>
      <p>Esto borra Eclipse Launcher, Eclipse Tools, sus accesos directos y todos los datos guardados
         (glosario, caché de traducción, preferencias). No se puede deshacer.</p>
      <div class="row"><button id="no">Cancelar</button><button id="yes">Desinstalar todo</button></div>
      <script>
        document.getElementById("yes").onclick = () => window.pywebview.api.confirm();
        document.getElementById("no").onclick = () => window.pywebview.api.cancel();
      </script>
    </body></html>"""
    window_ref[0] = webview.create_window(
        "Desinstalar Eclipse Launcher", html=html, js_api=api,
        width=420, height=260, resizable=False, background_color="#0b0e14",
    )
    webview.start()


def main():
    # v1.0.2 — ver comentario grande junto a easy_drag más abajo: sin
    # esto, CUALQUIER mousedown en toda la ventana arranca un arrastre
    # (según webview/js/customize.js, easy_drag activa un listener
    # global de mousedown sin filtrar por selector salvo que se pida
    # DIRECT_TARGET_ONLY) — los botones del titlebar y de toda la app
    # dejarían de poder clickearse bien. Con esto en True, el arrastre
    # SOLO arranca si el mousedown cae justo en un elemento con la
    # clase "pywebview-drag-region" (ver .titlebar-brand/.titlebar-spacer
    # en index.html) — todo lo demás sigue siendo un click normal.
    webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY'] = True

    # v1.0.3 — BUGFIX reportado: correr el launcher varias veces seguidas
    # durante desarrollo mostraba una versión vieja de web/index.html,
    # web/css/style.css o web/js/launcher.js aunque el archivo en disco ya
    # tenía los cambios nuevos. El backend de WebView2 que usa pywebview
    # cachea recursos file:// entre sesiones vía su carpeta de datos de
    # usuario — el query string en la URL de index.html solo evitaba el
    # caché del PROPIO index.html, no el de style.css/launcher.js (que se
    # piden con su URL de siempre, sin cambios, así que WebView2 seguía
    # sirviendo la versión vieja de esos dos). Ahora se genera una copia
    # de index.html con el mtime real de cada archivo referenciado
    # (placeholders __CSS_MTIME__/__JS_MTIME__), forzando URLs distintas
    # para los tres recursos en cada edición, sin tocar el index.html
    # original en disco.
    web_dir = os.path.join(_HERE, "web")
    index_src_path = os.path.join(web_dir, "index.html")
    css_mtime = int(os.path.getmtime(os.path.join(web_dir, "css", "style.css")))
    js_mtime = int(os.path.getmtime(os.path.join(web_dir, "js", "launcher.js")))
    with open(index_src_path, "r", encoding="utf-8") as f:
        index_html = f.read()
    index_html = index_html.replace("__CSS_MTIME__", str(css_mtime))
    index_html = index_html.replace("__JS_MTIME__", str(js_mtime))
    index_path = os.path.join(web_dir, "_index_generated.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index_html)
    cache_bust = int(os.path.getmtime(index_src_path))
    api = Api()
    window = webview.create_window(
        "Eclipse Launcher",
        f"{index_path}?v={cache_bust}",
        js_api=api,
        width=1180, height=760, min_size=(980, 640),
        resizable=True,
        # v1.0.1 — BUGFIX visual: frameless=False dejaba el chrome NATIVO
        # de Windows (con su propio minimizar/cerrar) ADEMÁS del propio
        # que ya dibuja web/index.html (.titlebar) — dos barras de título
        # apiladas, una encima de la otra. El launcher tiene su propio
        # chrome hecho a mano así que el nativo tiene que ir frameless.
        #
        # v1.0.2 — BUGFIX: "no puedo mover la ventana". pywebview NO usa
        # -webkit-app-region:drag (eso es cosa de Electron/CSS estándar,
        # pywebview no lo implementa) — con frameless=True, el arrastre
        # depende de easy_drag=True MÁS un elemento con la clase
        # ".pywebview-drag-region" (ver webview/util.py,
        # DRAG_REGION_SELECTOR). Tenía easy_drag=False a propósito por
        # error de tipeo — quedó sin ninguna forma de mover la ventana.
        frameless=True,
        easy_drag=True,
        background_color="#0b0e14",
    )
    api.set_window(window)
    webview.start()


if __name__ == "__main__":
    if "--uninstall" in sys.argv:
        run_uninstaller(silent="--silent" in sys.argv)
    else:
        main()
