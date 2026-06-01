#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Delivery_Agent — instalador rápido (Ubuntu/Debian con Docker)
#  Uso:  ./setup.sh        (desde la raíz del proyecto ya clonado)
# ════════════════════════════════════════════════════════════════════
set -e

cd "$(dirname "$0")"

echo "════════════════════════════════════════════"
echo "   🍽️  Delivery_Agent — instalación"
echo "════════════════════════════════════════════"

# ── 1. Docker ────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[setup] Docker no está instalado."
  read -r -p "¿Instalarlo ahora con get.docker.com? [s/N] " ans
  if [[ "$ans" =~ ^[sSyY]$ ]]; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER" || true
    echo "[setup] ⚠ Docker instalado. CIERRA SESIÓN y vuelve a entrar (o reinicia) y corre ./setup.sh de nuevo."
    exit 0
  else
    echo "[setup] Instala Docker manualmente y reintenta. Saliendo."; exit 1
  fi
fi

# ── 2. .env ──────────────────────────────────────────────────────────
set_env() {  # set_env CLAVE VALOR
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    # escapa & y / para sed
    local esc; esc=$(printf '%s' "$val" | sed -e 's/[\/&]/\\&/g')
    sed -i.bak "s/^${key}=.*/${key}=${esc}/" .env && rm -f .env.bak
  else
    echo "${key}=${val}" >> .env
  fi
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

if [[ -f .env ]]; then
  echo "[setup] Ya existe .env — no se sobrescribe. (Edítalo a mano si hace falta.)"
else
  cp .env.example .env
  echo "[setup] Configurando .env (Enter para dejar el valor por defecto)…"

  read -r -p "  Nombre del negocio [Donatto Resto-Bar]: " v; set_env BRAND_NAME "${v:-Donatto Resto-Bar}"
  read -r -p "  ¿Activar bot de WhatsApp? [S/n]: " wa
  if [[ "$wa" =~ ^[nN]$ ]]; then
    set_env WHATSAPP_LOCAL_ENABLED false
  else
    set_env WHATSAPP_LOCAL_ENABLED true
    read -r -p "  GEMINI_API_KEY: " v; [[ -n "$v" ]] && set_env GEMINI_API_KEY "$v"
    read -r -p "  WhatsApp de la cocina (ej. 573104859728): " v; [[ -n "$v" ]] && set_env DISPATCH_NUMBER "$v"
  fi
  read -r -p "  IP de la impresora térmica (Enter si aún no): " v; [[ -n "$v" ]] && set_env PRINTER_IP "$v"
  read -r -p "  Contraseña inicial de admin [donatto2026]: " v; set_env ADMIN_INITIAL_PASSWORD "${v:-donatto2026}"

  set_env SESSION_SECRET "$(gen_secret)"
  echo "[setup] .env listo (SESSION_SECRET generado automáticamente) ✓"
fi

# ── 3. Construir y arrancar ──────────────────────────────────────────
echo "[setup] Construyendo y arrancando (puede tardar unos minutos la 1ª vez)…"
docker compose up -d --build

# ── 4. Resumen ───────────────────────────────────────────────────────
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PORT=$(grep -E '^KIOSK_PORT=' .env | cut -d= -f2); PORT="${PORT:-3000}"
echo
echo "════════════════════════════════════════════"
echo "   ✅ Listo. Accesos en la LAN:"
echo "   🍽️  Kiosko:  http://${IP:-<IP-VM>}:${PORT}/kiosko"
echo "   🎛️  Admin:   http://${IP:-<IP-VM>}:${PORT}/admin"
echo "   👨‍🍳 Cocina:  http://${IP:-<IP-VM>}:${PORT}/kds"
echo "════════════════════════════════════════════"
echo "   • WhatsApp: escanea el QR con  ->  docker compose logs -f"
echo "   • Entra a /admin y cambia la contraseña."
echo "════════════════════════════════════════════"
