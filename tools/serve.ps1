param([int]$Port = 8731)

# Static server for outputs/. Kept as a file rather than typed in each
# time, because the ad-hoc one died mid-session and took the browser
# preview and every screenshot with it.
$root = Join-Path (Split-Path $PSScriptRoot -Parent) "outputs"
if (-not (Test-Path $root)) { throw "no outputs directory at $root" }

$types = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.js'='text/javascript; charset=utf-8'; '.json'='application/json'
  '.xml'='application/xml'; '.txt'='text/plain; charset=utf-8'
  '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.png'='image/png'
  '.gif'='image/gif'; '.svg'='image/svg+xml'; '.webp'='image/webp'
  '.ico'='image/x-icon'; '.mp4'='video/mp4'; '.webm'='video/webm'
  '.pdf'='application/pdf'; '.woff2'='font/woff2'; '.woff'='font/woff'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "serving $root on http://localhost:$Port/"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }

    $full = Join-Path $root $rel
    # Keep requests inside outputs/ - a path with .. must not escape it.
    $resolved = [System.IO.Path]::GetFullPath($full)
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue
    }

    if (Test-Path $resolved -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($resolved)
      $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
      $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control','no-store')   # always serve the current edit
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $notFound = Join-Path $root '404.html'
      $ctx.Response.StatusCode = 404
      if (Test-Path $notFound) {
        $bytes = [System.IO.File]::ReadAllBytes($notFound)
        $ctx.Response.ContentType = 'text/html; charset=utf-8'
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    }
    $ctx.Response.Close()
  } catch {
    try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
  }
}
