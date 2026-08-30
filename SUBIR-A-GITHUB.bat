@echo off
chcp 65001 >nul
title Publicar el dashboard de Adoption
cd /d "%~dp0"

echo.
echo ============================================================
echo   PUBLICAR EL DASHBOARD DE ADOPTION
echo   repo: jhonatangrajales-990123/Adoption-dashboard
echo ============================================================
echo.
echo   Si es la primera vez puede abrirse el navegador para
echo   iniciar sesion en GitHub. Es normal.
echo.
pause
echo.

echo [1/3] Guardando los cambios...
git add -A
git diff --staged --quiet
if errorlevel 1 (
  git -c user.name="Jhonatan Grajales" -c user.email="jhonatan.grajales@alegra.com" commit -q -m "Actualizacion del dashboard de Adoption"
  echo       Guardado.
) else (
  echo       No habia nada nuevo. Subo igual por si falta algo alla.
)
echo.

echo [2/3] Subiendo...
echo.
git push nuevo main
set ERR=%errorlevel%
echo.

if not %ERR%==0 (
  echo [3/3] Reintentando tras sincronizar...
  echo.
  git fetch nuevo main
  git reset --soft FETCH_HEAD
  git add -A
  git diff --staged --quiet
  if errorlevel 1 git -c user.name="Jhonatan Grajales" -c user.email="jhonatan.grajales@alegra.com" commit -q -m "Actualizacion del dashboard de Adoption"
  git push nuevo main
  set ERR=%errorlevel%
  echo.
)

echo ============================================================
if %ERR%==0 (
  echo   LISTO - YA ESTA EN GITHUB
  echo ============================================================
  echo.
  echo   https://github.com/jhonatangrajales-990123/Adoption-dashboard
  echo.
  echo   Si Vercel ya apunta a este repo, esta construyendo
  echo   la nueva version. En 1-2 minutos:
  echo   https://adoption-explorer.vercel.app
  echo.
) else (
  echo   NO SE PUDO SUBIR
  echo ============================================================
  echo.
  echo   Copia el error de arriba y pasamelo.
  echo.
  echo   Si dice "Repository not found", el repo todavia no
  echo   existe: creralo en GitHub ^(privado^) y vuelve a correr esto.
  echo.
)

pause
