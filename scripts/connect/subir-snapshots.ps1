# Sube a la app los snapshots de retención y activación (los que salen de Metabase).
# Antes:  node scripts/connect/exportar-snapshots.cjs
#
# Variables de entorno (las claves nunca van escritas aquí):
#   CONNECT_TOKEN  (obligatoria)  el mismo valor que CONNECT_TOKEN en Vercel
#   CONNECT_URL    (opcional)     por defecto https://alegra-adoption-dasboard-vercel.vercel.app
#
# Uso:
#   .\subir-snapshots.ps1                       # sube ret, act y actA desde .\dist-snapshots
#   .\subir-snapshots.ps1 -Solo ret             # solo uno de ellos
#   .\subir-snapshots.ps1 -Estado               # no sube nada: muestra qué tan frescos están los datos en la app
param(
  [ValidateSet("ret", "act", "actA")]
  [string[]]$Solo = @("ret", "act", "actA"),
  [string]$Carpeta = "dist-snapshots",
  [switch]$Estado
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$token = $env:CONNECT_TOKEN
if (-not $token) { Write-Error "Falta la variable de entorno CONNECT_TOKEN."; exit 1 }
$base = if ($env:CONNECT_URL) { $env:CONNECT_URL.TrimEnd("/") } else { "https://alegra-adoption-dasboard-vercel.vercel.app" }
$url = "$base/api/connect/snapshot"
$h = @{ "x-connect-token" = $token }

if ($Estado) { Invoke-RestMethod -Uri $url -Headers $h | ConvertTo-Json -Depth 5; exit 0 }

foreach ($tipo in $Solo) {
  $f = Join-Path $Carpeta "$tipo.json"
  if (-not (Test-Path $f)) { Write-Host "· $tipo`: no hay $f, se omite"; continue }
  $datos = Get-Content -Raw -Encoding UTF8 $f
  $cuerpo = '{"tipo":"' + $tipo + '","datos":' + $datos + '}'
  $r = Invoke-RestMethod -Uri $url -Method Post -Headers $h -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($cuerpo))
  Write-Host "✓ $tipo subido ($([math]::Round($cuerpo.Length / 1KB)) KB)"
}
