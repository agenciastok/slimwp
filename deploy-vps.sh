#!/bin/sh
set -e
cd "$(dirname "$0")"

echo "=== SlimFlix deploy VPS (build vps-8) ==="
docker compose down 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

sleep 2
echo ""
echo "=== Verificação no container (porta 8080) ==="
if curl -sf "http://127.0.0.1:8080/" | grep -q "vps-8"; then
  echo "OK: index.html contém vps-8"
else
  echo "ERRO: index.html no container NÃO tem vps-8 — arquivos antigos no build"
  exit 1
fi

if curl -sf "http://127.0.0.1:8080/login.js?v=vps-8" | head -1 | grep -q "login-vps-8"; then
  echo "OK: login.js começa com BUILD login-vps-8"
else
  echo "ERRO: login.js antigo no container"
  exit 1
fi

echo ""
echo "Deploy concluído. Abra https://slimflix.lat e confira:"
echo "  - Tela de login: 'build vps-8' no rodapé do card"
echo "  - Console: login-vps-8-proxy ativo"
echo "  - Network no login: /api/spacetg.shop/player_api.php (não http://)"
