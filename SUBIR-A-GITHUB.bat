@echo off
chcp 65001 >nul
title Subir el dashboard a GitHub
cd /d "%~dp0"

echo.
echo ============================================================
echo   SUBIR EL DASHBOARD DE ADOPTION A GITHUB
echo   destino: Alegra-Team/Adoption-dashboard
echo ============================================================
echo.
echo   Si es la primera vez, se abrira una ventana del navegador
echo   para que inicies sesion en GitHub. Es normal.
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
echo       ^(si el robot de actualizacion subio algo, se respeta
echo        el historial y tus archivos quedan encima^)
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
  echo       No habia nada nuevo que guardar.
  echo.
  echo   ============================================================
  echo     GITHUB YA ESTA AL DIA - no hay nada que subir
  echo   ============================================================
  echo.
  pause
  exit /b 0
)
echo.

echo [4/4] Subiendo a GitHub...
echo.
git push hub main
echo.

if errorlevel 1 (
  echo ============================================================
  echo   NO SE PUDO SUBIR
  echo ============================================================
  echo.
  echo   Copia el mensaje de error de arriba y pasamelo.
  echo.
) else (
  echo ============================================================
  echo   LISTO - YA ESTA EN GITHUB
  echo ============================================================
  echo.
  echo   https://github.com/Alegra-Team/Adoption-dashboard
  echo.
  echo   Ahora entra a Dashboards Hub y recarga la pagina
  echo   del dashboard. Deberia mostrarse.
  echo.
)

echo.
pause
