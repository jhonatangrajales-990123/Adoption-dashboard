@echo off
chcp 65001 >nul
title Publicar el dashboard de Adoption
cd /d "%~dp0"

echo.
echo ============================================================
echo   PUBLICAR EL DASHBOARD DE ADOPTION
echo ============================================================
echo.
echo   Sube a los dos destinos:
echo     - origin  ^-^> repo personal  ^-^> Vercel despliega solo
echo     - hub     ^-^> Alegra-Team    ^-^> Dashboards Hub
echo.
echo   Si es la primera vez puede abrirse el navegador para
echo   iniciar sesion en GitHub. Es normal.
echo.
pause
echo.

echo [1/4] Viendo que hay en GitHub...
git fetch hub main
if errorlevel 1 (
  echo.
  echo   No se pudo conectar con GitHub. Revisa tu internet
  echo   o el inicio de sesion, y vuelve a intentar.
  echo.
  pause
  exit /b 1
)
echo       Listo.
echo.

echo [2/4] Sincronizando...
git reset --soft FETCH_HEAD
echo       Listo.
echo.

echo [3/4] Guardando los cambios...
git add -A
git diff --staged --quiet
if errorlevel 1 (
  git -c user.name="Jhonatan Grajales" -c user.email="jhonatan.grajales@alegra.com" commit -q -m "Actualizacion del dashboard de Adoption"
  echo       Guardado.
) else (
  echo       No habia nada nuevo. Subo igual por si falta en algun destino.
)
echo.

echo [4/4] Subiendo...
echo.
echo    -- a Vercel ^(repo personal^) --
git push origin main
set ERR_ORIGIN=%errorlevel%
echo.
echo    -- a Dashboards Hub ^(Alegra-Team^) --
git push hub main
set ERR_HUB=%errorlevel%
echo.

echo ============================================================
if %ERR_ORIGIN%==0 (echo   Vercel          OK) else (echo   Vercel          FALLO)
if %ERR_HUB%==0    (echo   Dashboards Hub  OK) else (echo   Dashboards Hub  FALLO)
echo ============================================================
echo.

if %ERR_ORIGIN%==0 (
  echo   Vercel esta construyendo la nueva version.
  echo   En 1-2 minutos: https://adoption-explorer.vercel.app
  echo.
  echo   OJO: si todavia no pusiste las variables en Vercel,
  echo   el dashboard va a dar error al cargar los datos.
  echo   Settings ^> Environment Variables:
  echo      HUBSPOT_TOKEN      el token de tu .env.local
  echo      ADOPTION_PASSWORD  una clave para el equipo
  echo.
)
if not %ERR_ORIGIN%==0 (
  echo   Copia el error de arriba y pasamelo.
  echo.
)

pause
