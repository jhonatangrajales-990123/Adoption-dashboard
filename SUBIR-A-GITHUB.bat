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
echo   Si es la primera vez, se va a abrir una ventana del
echo   navegador para que inicies sesion en GitHub. Es normal.
echo.
pause
echo.

echo [1/3] Revisando que este todo guardado...
git add -A >nul 2>&1
git diff --staged --quiet
if errorlevel 1 (
  echo       Habia cambios sin guardar, los guardo...
  git -c user.name="Jhonatan Grajales" -c user.email="jhonatan.grajales@alegra.com" commit -q -m "Actualizacion del dashboard"
  echo       Listo.
) else (
  echo       Todo estaba guardado.
)
echo.

echo [2/3] Subiendo a GitHub...
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
  echo   Causas mas comunes:
  echo     - No tienes permiso de escritura en Alegra-Team
  echo     - Cancelaste el inicio de sesion de GitHub
  echo     - El repositorio ya tiene contenido ^(ver abajo^)
  echo.
  echo   Si dice "rejected" o "non-fast-forward", el repo
  echo   ya traia archivos. Avisame y lo resuelvo.
  echo.
) else (
  echo ============================================================
  echo   LISTO - EL CODIGO YA ESTA EN GITHUB
  echo ============================================================
  echo.
  echo   https://github.com/Alegra-Team/Adoption-dashboard
  echo.
  echo   AHORA FALTAN 3 PASOS EN EL NAVEGADOR:
  echo.
  echo   1. Guardar el token de HubSpot
  echo      En el repo: Settings ^> Secrets and variables ^> Actions
  echo      ^> New repository secret
  echo        Nombre: HUBSPOT_TOKEN
  echo        Valor:  el token que esta en tu archivo .env.local
  echo.
  echo   2. Conectar el repo en Dashboards Hub
  echo      Elegir "Adoption-dashboard" y dar Update access
  echo.
  echo   3. Probar la actualizacion automatica
  echo      En el repo: pestana Actions ^> "Actualizar dashboard"
  echo      ^> boton "Run workflow"
  echo.
)

echo.
pause
