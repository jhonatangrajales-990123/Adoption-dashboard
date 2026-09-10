@echo off
chcp 65001 >nul
title Publicar el dashboard de Adoption
cd /d "%~dp0"

echo.
echo ============================================================
echo   PUBLICAR EL DASHBOARD DE ADOPTION
echo ============================================================
echo.
echo   Vercel esta conectado al repo "adoption-explorer".
echo   Ese es el push que dispara el despliegue.
echo   El repo "Adoption-dashboard" se actualiza tambien, para
echo   que no se quede viejo.
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

echo [2/3] Subiendo a adoption-explorer ^(este actualiza Vercel^)...
echo.
git push origin main
set ERR=%errorlevel%
echo.

if not %ERR%==0 (
  echo       Reintentando tras sincronizar...
  echo.
  git fetch origin main
  git reset --soft FETCH_HEAD
  git add -A
  git diff --staged --quiet
  if errorlevel 1 git -c user.name="Jhonatan Grajales" -c user.email="jhonatan.grajales@alegra.com" commit -q -m "Actualizacion del dashboard de Adoption"
  git push origin main
  set ERR=%errorlevel%
  echo.
)

echo [3/3] Copia en Adoption-dashboard...
echo.
git push nuevo main
echo.

echo ============================================================
if %ERR%==0 (
  echo   LISTO - YA ESTA EN GITHUB
  echo ============================================================
  echo.
  echo   Vercel esta construyendo la nueva version.
  echo   En 1-2 minutos: https://adoption-explorer.vercel.app
  echo.
  echo   OJO: ese enlace hoy esta ABIERTO a cualquiera que lo
  echo   tenga, con nombres de clientes y MRR. Para cerrarlo hay
  echo   que poner ADOPTION_PASSWORD en las variables de entorno
  echo   del proyecto en Vercel.
  echo.
) else (
  echo   NO SE PUDO SUBIR
  echo ============================================================
  echo.
  echo   Copia el error de arriba y pasamelo.
  echo.
)

pause
