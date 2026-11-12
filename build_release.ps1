#requires -Version 5.1
<#
.SYNOPSIS
  Produit un ZIP Foundry VTT a partir du module.json du depot.
.EXAMPLE
  .\build_release.ps1
.EXAMPLE
  .\build_release.ps1 -OutputDirectory "C:\Temp\Foundry" -SkipSyntaxCheck
#>
[CmdletBinding()]
param(
    [string] $OutputDirectory = 'dist',
    [switch] $SkipSyntaxCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$manifestPath = Join-Path $repoRoot 'module.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Impossible de trouver module.json dans $repoRoot"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$id = [string] $manifest.id
$version = [string] $manifest.version
$title = [string] $manifest.title
if ($id -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
    throw "Identifiant de module invalide : '$id'."
}
if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') {
    throw "Version invalide dans module.json : '$version'."
}

# Le nom du ZIP suit le nom public, tandis que l'ID reste historique.
$archiveBase = [regex]::Replace($title.ToLowerInvariant(), '[^a-z0-9]+', '-').Trim('-')
if (-not $archiveBase) { $archiveBase = $id }
if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    $outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$zipPath = Join-Path $outputPath "$archiveBase-v$version.zip"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("pf1-release-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# Exclusions : fichiers de travail, historiques Git, archives et outils.
$excludedDirectories = @(
    '.git', '.github', '.vscode', '.idea', '.vs',
    'dist', 'build', 'node_modules', 'coverage', 'tests', 'test',
    '.cache', '.venv', '__pycache__', 'tools'
)
$excludedFileNames = @(
    '.gitignore', '.gitattributes', '.editorconfig', 'Thumbs.db',
    'desktop.ini', 'package-lock.json', 'build_release.bat', 'build_release.ps1'
)

function Test-PackagedFile {
    param([System.IO.FileInfo] $File)
    $relative = $File.FullName.Substring($repoRoot.Length).TrimStart([char[]]@(92, 47))
    # Keep the source regression fixture in Git, but never ship the retired
    # firearm reload engine in the production PF1AE archive.
    if ($relative.Replace('\\','/') -eq 'scripts/reload-core.js') { return $false }
    $parts = $relative -split '[\\/]'
    foreach ($part in $parts) {
        if ($part -in $excludedDirectories) { return $false }
    }
    if ($File.FullName.StartsWith($outputPath.TrimEnd([char[]]@(92, 47)) + [System.IO.Path]::DirectorySeparatorChar,
            [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ($File.Name -in $excludedFileNames) { return $false }
    if ($File.Name.StartsWith('.')) { return $false }
    if ($File.Name -match '\.(zip|log|ps1|psm1|psd1)$') { return $false }
    if ($File.Name -match '\.test\.(js|cjs|mjs)$') { return $false }
    return $true
}

try {
    $files = @(Get-ChildItem -LiteralPath $repoRoot -File -Recurse -Force |
        Where-Object { Test-PackagedFile -File $_ })
    if ($files.Count -eq 0) { throw 'Aucun fichier a empaqueter.' }

    foreach ($file in $files) {
        $relative = $file.FullName.Substring($repoRoot.Length).TrimStart([char[]]@(92, 47))
        $target = Join-Path $staging $relative
        New-Item -ItemType Directory -Path (Split-Path -Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }

    # Les fichiers de scripts et de styles declares sont obligatoires.
    foreach ($propertyName in @('esmodules', 'scripts', 'styles')) {
        $property = $manifest.PSObject.Properties[$propertyName]
        if ($null -eq $property -or $null -eq $property.Value) { continue }
        foreach ($relativePath in @($property.Value)) {
            $path = [string] $relativePath
            if ([System.IO.Path]::IsPathRooted($path) -or
                $path -match '(^|[\\/])\.\.([\\/]|$)') {
                throw "Chemin non autorise dans $propertyName : $path"
            }
            $required = Join-Path $staging ($path.Replace('/', '\'))
            if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
                throw "Fichier declare dans module.json introuvable : $path"
            }
        }
    }

    $node = Get-Command 'node' -ErrorAction SilentlyContinue
    if (-not $SkipSyntaxCheck -and $null -ne $node) {
        foreach ($file in @($files | Where-Object { $_.Extension -in @('.js', '.mjs', '.cjs') })) {
            & $node.Source --check $file.FullName
            if ($LASTEXITCODE -ne 0) {
                throw "Erreur de syntaxe JavaScript : $($file.FullName)"
            }
        }
        Write-Host 'Syntaxe JavaScript : OK.' -ForegroundColor Green
    } elseif (-not $SkipSyntaxCheck) {
        Write-Warning 'Node.js non detecte : verification JavaScript ignoree.'
    }

    if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    # Construire directement les entrees avec '/' (portable pour Foundry).
    # Compress-Archive peut utiliser des separateurs Windows dans les noms.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipWriter = [System.IO.Compression.ZipFile]::Open(
        $zipPath, [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($repoRoot.Length).TrimStart([char[]]@(92, 47))
            $entryName = $relative.Replace('\', '/')
            $stagedFile = Join-Path $staging $relative
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zipWriter, $stagedFile, $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $zipWriter.Dispose()
    }

    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        if ($null -eq $archive.GetEntry('module.json')) {
            throw 'Archive invalide : module.json absent de la racine.'
        }
        foreach ($propertyName in @('esmodules', 'scripts', 'styles')) {
            $property = $manifest.PSObject.Properties[$propertyName]
            if ($null -eq $property -or $null -eq $property.Value) { continue }
            foreach ($relativePath in @($property.Value)) {
                $entry = ([string] $relativePath).Replace('\', '/')
                if ($null -eq $archive.GetEntry($entry)) {
                    throw "Archive invalide : fichier requis absent : $entry"
                }
            }
        }
        $entryCount = @($archive.Entries).Count
    } finally {
        $archive.Dispose()
    }

    $sizeKb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)
    Write-Host "Module : $title ($id) - version $version" -ForegroundColor Cyan
    Write-Host "ZIP cree : $zipPath" -ForegroundColor Green
    Write-Host "Contenu : $entryCount entrees, $sizeKb Ko"
    Write-Host "Installation manuelle : extraire dans Data\modules\$id\"
} finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}