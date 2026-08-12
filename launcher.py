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
LAUNCHER_VERSION = "1.0.0"

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


def _create_desktop_shortcut(target_exe, dest_dir=None, log=None):
    """Crea un .lnk sin depender de pywin32 (mantener el launcher LO
    MÁS CHICO Y ABURRIDO POSIBLE — cuantas menos libs raras, menos
    superficie para que un antivirus dude). Se arma con un mini-script
    de PowerShell vía el objeto COM WScript.Shell, que ya trae Windows
    de fábrica — cero dependencias nuevas."""
    log = log or (lambda s: None)
    try:
        if dest_dir is None:
            dest_dir = Path(os.path.join(os.path.expanduser("~"), "Desktop"))
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        lnk_path = dest_dir / "Eclipse Tools.lnk"
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

    def get_state(self, _=None):
        installed_exe = _find_installed_exe()
        st = _load_state()
        return {
            "installed": installed_exe is not None,
            "installedVersion": st.get("installed_version", ""),
            "launcherVersion": LAUNCHER_VERSION,
        }

    def check_and_install(self, choose_shortcut_dir=False, call_id=None):
        """Descarga (primera vez) o actualiza Eclipse Tools, en un hilo
        de fondo — progreso se manda vía window.evaluate_js."""
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
                if choose_shortcut_dir and self._window:
                    chosen = self._window.create_file_dialog(webview.FOLDER_DIALOG)
                    if chosen:
                        shortcut_dir = chosen[0]
                _create_desktop_shortcut(exe, dest_dir=shortcut_dir)

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


def main():
    api = Api()
    window = webview.create_window(
        "Eclipse Launcher",
        os.path.join(_HERE, "web", "index.html"),
        js_api=api,
        width=880, height=520,
        resizable=False,
        frameless=False,
        background_color="#0b0e14",
    )
    api.set_window(window)
    webview.start()


if __name__ == "__main__":
    main()
