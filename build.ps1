# RedGifs Downloader Build Script for Windows
# This script builds the application for Windows with proper signing and packaging

param(
    [string]$Version = "3.0.0",
    [string]$BuildType = "production",
    [switch]$Sign = $false,
    [switch]$Package = $false,
    [switch]$Clean = $false
)

$ErrorActionPreference = "Stop"

# Colors for output
$Red = [System.ConsoleColor]::Red
$Green = [System.ConsoleColor]::Green
$Yellow = [System.ConsoleColor]::Yellow
$Blue = [System.ConsoleColor]::Blue

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    } else {
        $input | Write-Output
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Log-Info($message) {
    Write-ColorOutput $Blue "[INFO] $message"
}

function Log-Success($message) {
    Write-ColorOutput $Green "[SUCCESS] $message"
}

function Log-Warning($message) {
    Write-ColorOutput $Yellow "[WARNING] $message"
}

function Log-Error($message) {
    Write-ColorOutput $Red "[ERROR] $message"
}

# Get build information
$BuildTime = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
$GitCommit = try { git rev-parse --short HEAD } catch { "unknown" }

Log-Info "Starting RedGifs Downloader build process..."
Log-Info "Version: $Version"
Log-Info "Build Type: $BuildType"
Log-Info "Build Time: $BuildTime"
Log-Info "Git Commit: $GitCommit"

# Clean previous builds if requested
if ($Clean) {
    Log-Info "Cleaning previous builds..."
    if (Test-Path "build/bin") {
        Remove-Item -Recurse -Force "build/bin"
    }
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
}

# Create build directories
New-Item -ItemType Directory -Force -Path "build/bin" | Out-Null
New-Item -ItemType Directory -Force -Path "dist" | Out-Null

# Check prerequisites
Log-Info "Checking prerequisites..."

# Check Go
try {
    $goVersion = go version
    Log-Success "Go found: $goVersion"
} catch {
    Log-Error "Go not found. Please install Go 1.21 or later."
    exit 1
}

# Check Wails
try {
    $wailsVersion = wails version
    Log-Success "Wails found: $wailsVersion"
} catch {
    Log-Error "Wails not found. Please install Wails v2."
    exit 1
}

# Check Node.js (for frontend)
try {
    $nodeVersion = node --version
    Log-Success "Node.js found: $nodeVersion"
} catch {
    Log-Error "Node.js not found. Please install Node.js 16 or later."
    exit 1
}

# Install frontend dependencies
Log-Info "Installing frontend dependencies..."
Set-Location frontend
try {
    npm install
    Log-Success "Frontend dependencies installed"
} catch {
    Log-Error "Failed to install frontend dependencies"
    exit 1
} finally {
    Set-Location ..
}

# Build the application
Log-Info "Building application..."
try {
    $env:CGO_ENABLED = "1"
    wails build -clean -platform windows/amd64 -ldflags "-s -w -X main.version=$Version -X main.buildTime=$BuildTime -X main.gitCommit=$GitCommit"
    Log-Success "Application built successfully"
} catch {
    Log-Error "Build failed: $_"
    exit 1
}

# Copy additional files
Log-Info "Copying additional files..."
Copy-Item "README.md" "build/bin/" -ErrorAction SilentlyContinue
Copy-Item "LICENSE" "build/bin/" -ErrorAction SilentlyContinue
Copy-Item "config.example.yaml" "build/bin/" -ErrorAction SilentlyContinue

# Create installer if requested
if ($Package) {
    Log-Info "Creating installer package..."
    
    # Check for NSIS
    $nsisPath = Get-Command makensis -ErrorAction SilentlyContinue
    if (-not $nsisPath) {
        Log-Warning "NSIS not found. Skipping installer creation."
    } else {
        try {
            & makensis /DVERSION=$Version "build/windows/installer.nsi"
            Log-Success "Installer created successfully"
        } catch {
            Log-Error "Failed to create installer: $_"
        }
    }
}

# Sign the executable if requested
if ($Sign) {
    Log-Info "Signing executable..."
    $certPath = $env:CERT_PATH
    $certPassword = $env:CERT_PASSWORD
    
    if (-not $certPath -or -not $certPassword) {
        Log-Warning "Certificate path or password not provided. Skipping signing."
    } else {
        try {
            & signtool sign /f $certPath /p $certPassword /t http://timestamp.digicert.com "build/bin/RedGifs Downloader.exe"
            Log-Success "Executable signed successfully"
        } catch {
            Log-Error "Failed to sign executable: $_"
        }
    }
}

# Create distribution archive
Log-Info "Creating distribution archive..."
$archiveName = "redgifs-downloader-v$Version-windows-amd64.zip"
try {
    Compress-Archive -Path "build/bin/*" -DestinationPath "dist/$archiveName" -Force
    Log-Success "Distribution archive created: dist/$archiveName"
} catch {
    Log-Error "Failed to create distribution archive: $_"
}

# Calculate checksums
Log-Info "Calculating checksums..."
try {
    $hash = Get-FileHash "dist/$archiveName" -Algorithm SHA256
    $hash.Hash | Out-File "dist/$archiveName.sha256" -Encoding ASCII
    Log-Success "Checksum calculated: $($hash.Hash)"
} catch {
    Log-Error "Failed to calculate checksum: $_"
}

Log-Success "Build process completed successfully!"
Log-Info "Output files:"
Get-ChildItem "dist/" | ForEach-Object { Log-Info "  - $($_.Name)" }
