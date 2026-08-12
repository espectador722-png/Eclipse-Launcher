#!/usr/bin/env python3
# ================================================================
# publish_launcher.py — Eclipse Launcher — Publicador de releases
#
# Herramienta LOCAL para publicar el .exe del launcher al repo
# PÚBLICO de GitHub (https://github.com/espectador722-png/Eclipse-Launcher)
# — a diferencia de publish_tool.py (EclipseTools), este repo es
# público a propósito: es la puerta de entrada, se descarga sin
# login ni licencia (ver comentario grande en launcher.py).
#
# NO SE DISTRIBUYE — corré esto solo vos, local: python publish_launcher.py
#
# Reusa las funciones de la API de GitHub de publish_tool.py (ya están
# parametrizadas por owner/repo, no hace falta duplicarlas) y el mismo
# token guardado que usás para publicar Eclipse Tools — un solo
# Personal Access Token con permiso de escritura alcanza para los dos
# repos si lo generás sin limitarlo a uno solo (o generá uno aparte
# fine-grained sobre Eclipse-Launcher nada más, más seguro).
# ================================================================
import os
import sys
import subprocess
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path
import zipfile

_HERE = Path(__file__).resolve().parent
_ECLIPSE_TOOLS_DIR = _HERE.parent / "EclipseTools"
sys.path.insert(0, str(_ECLIPSE_TOOLS_DIR))

from config import (  # noqa: E402
    BG, SURFACE, SURFACE2, SURFACE3, BORDER, TEXT, TEXT2, TEXT3,
    ACCENT, SUCCESS, DANGER, WARN, FONT_SUBTITLE, FONT_LABEL, FONT_LABEL_B,
    FONT_BTN, FONT_BTN_SM, FONT_MONO_SM, _f,
)
from widgets import SectionHeader, HintBox, FieldEntry, FieldTextArea, ActivityLog  # noqa: E402
import theme  # noqa: E402
from publish_tool import (  # noqa: E402
    check_token, create_release, get_release_by_tag, delete_asset_if_exists,
    upload_asset, load_saved_token, save_token_locally,
)

LAUNCHER_OWNER  = "espectador722-png"
LAUNCHER_REPO   = "Eclipse-Launcher"
LAUNCHER_BRANCH = "main"
LAUNCHER_ASSET_NAME = "Eclipse Launcher.zip"

TOKEN_PATH = Path.home() / ".eclipse_release_token"  # mismo token que publish_tool.py


def suggest_next_version(cur):
    parts = str(cur or "1.0.0").split(".")
    try:
        parts[-1] = str(int(parts[-1]) + 1)
    except Exception:
        return cur
    return ".".join(parts)


def read_current_version():
    try:
        ns = {}
        exec((_HERE / "launcher.py").read_text(encoding="utf-8").split("\n\n")[0], ns)
    except Exception:
        pass
    try:
        for line in (_HERE / "launcher.py").read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("LAUNCHER_VERSION"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return "1.0.0"


def write_version_in_launcher(new_version):
    p = _HERE / "launcher.py"
    text = p.read_text(encoding="utf-8")
    out = []
    for line in text.splitlines(keepends=True):
        if line.strip().startswith("LAUNCHER_VERSION"):
            out.append(f'LAUNCHER_VERSION = "{new_version}"\n')
        else:
            out.append(line)
    p.write_text("".join(out), encoding="utf-8")


def compile_launcher(log_fn):
    log = log_fn or print
    bat = _HERE / "BUILD_LAUNCHER_NUITKA.bat"
    proc = subprocess.Popen(
        [str(bat), "/silent"], cwd=str(_HERE),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    for line in proc.stdout:
        log(line.rstrip("\n"))
    proc.wait()
    return proc.returncode == 0


def zip_launcher_dist(log_fn=None):
    log = log_fn or print
    dist_dir = _HERE / "dist_launcher" / "Eclipse Launcher"
    exe_path = dist_dir / "Eclipse Launcher.exe"
    if not exe_path.exists():
        return False, f"No existe {exe_path} — compilá primero."
    zip_path = _HERE / "dist_launcher" / LAUNCHER_ASSET_NAME
    if zip_path.exists():
        zip_path.unlink()
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in dist_dir.rglob("*"):
            if f.is_file():
                zf.write(f, Path(dist_dir.name) / f.relative_to(dist_dir))
                count += 1
    log(f"  {count} archivos empaquetados desde: {dist_dir}")
    return True, str(zip_path)


def publish(token, version, changelog, zip_path, log_fn):
    log = log_fn or print
    ok, msg = check_token(token, LAUNCHER_OWNER, LAUNCHER_REPO)
    log(("OK " if ok else "ERROR ") + msg)
    if not ok:
        return False

    tag = f"v{version}"
    log(f"Tag de release: {tag}")
    release = get_release_by_tag(token, LAUNCHER_OWNER, LAUNCHER_REPO, tag)
    if release:
        log("Ya existe un release con ese tag — se reutiliza y se reemplaza el asset.")
    else:
        release, err = create_release(token, LAUNCHER_OWNER, LAUNCHER_REPO, tag, tag, changelog)
        if err:
            log(f"ERROR {err}")
            return False
        log(f"OK Release creado: {release.get('html_url')}")

    upload_url = release["upload_url"]
    delete_asset_if_exists(token, LAUNCHER_OWNER, LAUNCHER_REPO, release, LAUNCHER_ASSET_NAME)
    log(f"Subiendo '{LAUNCHER_ASSET_NAME}'...")
    ok, msg = upload_asset(token, upload_url, zip_path, LAUNCHER_ASSET_NAME)
    log(("OK " if ok else "ERROR ") + msg)
    if not ok:
        return False

    log(f"\nOK Publicacion completa. Release: {release.get('html_url')}")
    return True


class PublishLauncherWindow(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Eclipse — Publicar Launcher")
        self.configure(bg=BG)
        self.geometry("640x680")
        theme.apply_theme(self)

        pad = tk.Frame(self, bg=BG, padx=18, pady=16)
        pad.pack(fill="both", expand=True)

        SectionHeader(pad, f"Repo público: {LAUNCHER_OWNER}/{LAUNCHER_REPO}", "🚀").pack(fill="x", pady=(0, 6))
        HintBox(pad, "Este repo es PÚBLICO — cualquiera puede bajar el launcher sin "
                     "login ni licencia. No subas nada acá que no quieras que se vea.").pack(fill="x", pady=(0, 12))

        self.f_token = FieldEntry(pad, "Personal Access Token (mismo que Eclipse Tools o uno aparte)", load_saved_token() or "")
        self.f_token.pack(fill="x", pady=(0, 10))
        self.f_token.set_secret(True) if hasattr(self.f_token, "set_secret") else None

        self.remember_tok = tk.BooleanVar(value=bool(load_saved_token()))
        tk.Checkbutton(pad, text="Recordar token en este equipo", variable=self.remember_tok,
                       bg=BG, fg=TEXT2, selectcolor=SURFACE2, activebackground=BG,
                       font=FONT_LABEL).pack(anchor="w", pady=(0, 12))

        cur_v = read_current_version()
        self.f_version = FieldEntry(pad, f"Versión del launcher — actual: {cur_v}", suggest_next_version(cur_v))
        self.f_version.pack(fill="x", pady=(0, 10))

        self.f_changelog = FieldTextArea(pad, "Novedades de esta versión del launcher", "", height=4)
        self.f_changelog.pack(fill="x", pady=(0, 12))

        btn_row = tk.Frame(pad, bg=BG)
        btn_row.pack(fill="x", pady=(0, 10))
        self._btn_compile = tk.Button(btn_row, text="🔨 Compilar", command=self._on_compile,
                                       bg=SURFACE2, fg=TEXT, font=FONT_BTN, relief="flat", padx=14, pady=8)
        self._btn_compile.pack(side="left")
        self._btn_publish = tk.Button(btn_row, text="🚀 Publicar", command=self._on_publish,
                                       bg=ACCENT, fg=BG, font=FONT_BTN, relief="flat", padx=14, pady=8)
        self._btn_publish.pack(side="left", padx=(10, 0))

        self._log = ActivityLog(pad)
        self._log.pack(fill="both", expand=True)

    def _log_line(self, msg):
        self.after(0, lambda: self._log.log(msg, "ERROR" if msg.upper().startswith("ERROR") else
                                                    "OK" if msg.upper().startswith("OK") else "INFO"))

    def _on_compile(self):
        self._btn_compile.config(state="disabled", text="Compilando…")
        self._log.clear()

        def _worker():
            ok = compile_launcher(self._log_line)
            self.after(0, lambda: self._btn_compile.config(state="normal", text="🔨 Compilar"))
            if ok:
                zok, zmsg = zip_launcher_dist(self._log_line)
                self._log_line(("OK " if zok else "ERROR ") + zmsg)

        threading.Thread(target=_worker, daemon=True).start()

    def _on_publish(self):
        token = self.f_token.get().strip()
        version = self.f_version.get().strip()
        changelog = self.f_changelog.get().strip()
        if not token or not version:
            messagebox.showerror("Faltan datos", "Completá el token y la versión.")
            return

        zip_path = _HERE / "dist_launcher" / LAUNCHER_ASSET_NAME
        if not zip_path.exists():
            messagebox.showerror("Falta compilar", "Compilá primero (botón 🔨 Compilar).")
            return

        if not messagebox.askyesno(
            "Confirmar publicación",
            f"Esto va a crear/actualizar un Release PÚBLICO v{version} en "
            f"{LAUNCHER_OWNER}/{LAUNCHER_REPO}.\n\n¿Continuar?"
        ):
            return

        if self.remember_tok.get():
            save_token_locally(token)

        self._btn_publish.config(state="disabled", text="Publicando…")

        def _worker():
            write_version_in_launcher(version)
            ok = publish(token, version, changelog, str(zip_path), self._log_line)
            self.after(0, lambda: self._btn_publish.config(state="normal", text="🚀 Publicar"))
            if ok:
                self.after(0, lambda: messagebox.showinfo("Eclipse — Publicado", "✓ Launcher publicado correctamente."))

        threading.Thread(target=_worker, daemon=True).start()


if __name__ == "__main__":
    PublishLauncherWindow().mainloop()
