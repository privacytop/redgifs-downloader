#!/bin/bash

# RedGifs Downloader Build Script for Unix-like systems (Linux, macOS)
# This script builds the application for multiple platforms

set -e

# Default values
VERSION="3.0.0"
BUILD_TYPE="production"
PLATFORMS="linux/amd64,darwin/amd64,darwin/arm64"
CLEAN=false
PACKAGE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
RedGifs Downloader Build Script

Usage: $0 [OPTIONS]

Options:
    -v, --version VERSION     Set version (default: $VERSION)
    -t, --type TYPE          Set build type (default: $BUILD_TYPE)
    -p, --platforms PLATFORMS Set target platforms (default: $PLATFORMS)
    -c, --clean              Clean previous builds
    -P, --package            Create distribution packages
    -h, --help               Show this help message

Examples:
    $0 --version 3.0.1 --clean --package
    $0 --platforms "linux/amd64,darwin/amd64"
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -t|--type)
            BUILD_TYPE="$2"
            shift 2
            ;;
        -p|--platforms)
            PLATFORMS="$2"
            shift 2
            ;;
        -c|--clean)
            CLEAN=true
            shift
            ;;
        -P|--package)
            PACKAGE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Get build information
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

log_info "Starting RedGifs Downloader build process..."
log_info "Version: $VERSION"
log_info "Build Type: $BUILD_TYPE"
log_info "Platforms: $PLATFORMS"
log_info "Build Time: $BUILD_TIME"
log_info "Git Commit: $GIT_COMMIT"

# Clean previous builds if requested
if [ "$CLEAN" = true ]; then
    log_info "Cleaning previous builds..."
    rm -rf build/bin dist
fi

# Create build directories
mkdir -p build/bin dist

# Check prerequisites
log_info "Checking prerequisites..."

# Check Go
if ! command -v go &> /dev/null; then
    log_error "Go not found. Please install Go 1.21 or later."
    exit 1
fi
GO_VERSION=$(go version)
log_success "Go found: $GO_VERSION"

# Check Wails
if ! command -v wails &> /dev/null; then
    log_error "Wails not found. Please install Wails v2."
    exit 1
fi
WAILS_VERSION=$(wails version)
log_success "Wails found: $WAILS_VERSION"

# Check Node.js (for frontend)
if ! command -v node &> /dev/null; then
    log_error "Node.js not found. Please install Node.js 16 or later."
    exit 1
fi
NODE_VERSION=$(node --version)
log_success "Node.js found: $NODE_VERSION"

# Install frontend dependencies
log_info "Installing frontend dependencies..."
cd frontend
npm install
log_success "Frontend dependencies installed"
cd ..

# Build for each platform
IFS=',' read -ra PLATFORM_ARRAY <<< "$PLATFORMS"
for platform in "${PLATFORM_ARRAY[@]}"; do
    log_info "Building for platform: $platform"
    
    # Extract OS and architecture
    IFS='/' read -ra PARTS <<< "$platform"
    OS="${PARTS[0]}"
    ARCH="${PARTS[1]}"
    
    # Set output filename based on platform
    if [ "$OS" = "windows" ]; then
        OUTPUT_NAME="RedGifs Downloader.exe"
    else
        OUTPUT_NAME="RedGifs Downloader"
    fi
    
    # Build the application
    export CGO_ENABLED=1
    wails build -clean -platform "$platform" \
        -ldflags "-s -w -X main.version=$VERSION -X main.buildTime=$BUILD_TIME -X main.gitCommit=$GIT_COMMIT" \
        -o "build/bin/$OS-$ARCH/$OUTPUT_NAME"
    
    if [ $? -eq 0 ]; then
        log_success "Build completed for $platform"
    else
        log_error "Build failed for $platform"
        exit 1
    fi
    
    # Copy additional files
    cp README.md "build/bin/$OS-$ARCH/" 2>/dev/null || true
    cp LICENSE "build/bin/$OS-$ARCH/" 2>/dev/null || true
    cp config.example.yaml "build/bin/$OS-$ARCH/" 2>/dev/null || true
    
    # Create platform-specific archive
    if [ "$PACKAGE" = true ]; then
        log_info "Creating distribution package for $platform..."
        
        ARCHIVE_NAME="redgifs-downloader-v$VERSION-$OS-$ARCH"
        
        if [ "$OS" = "windows" ]; then
            ARCHIVE_NAME="$ARCHIVE_NAME.zip"
            (cd "build/bin/$OS-$ARCH" && zip -r "../../../dist/$ARCHIVE_NAME" .)
        else
            ARCHIVE_NAME="$ARCHIVE_NAME.tar.gz"
            tar -czf "dist/$ARCHIVE_NAME" -C "build/bin/$OS-$ARCH" .
        fi
        
        log_success "Package created: dist/$ARCHIVE_NAME"
        
        # Calculate checksum
        if command -v sha256sum &> /dev/null; then
            sha256sum "dist/$ARCHIVE_NAME" > "dist/$ARCHIVE_NAME.sha256"
        elif command -v shasum &> /dev/null; then
            shasum -a 256 "dist/$ARCHIVE_NAME" > "dist/$ARCHIVE_NAME.sha256"
        fi
    fi
done

# Create universal macOS app bundle if building for macOS
if [[ "$PLATFORMS" == *"darwin"* ]] && [ "$PACKAGE" = true ]; then
    log_info "Creating universal macOS app bundle..."
    
    # Check if we have both architectures
    if [ -f "build/bin/darwin-amd64/RedGifs Downloader" ] && [ -f "build/bin/darwin-arm64/RedGifs Downloader" ]; then
        mkdir -p "build/bin/darwin-universal"
        
        # Create universal binary using lipo
        lipo -create \
            "build/bin/darwin-amd64/RedGifs Downloader" \
            "build/bin/darwin-arm64/RedGifs Downloader" \
            -output "build/bin/darwin-universal/RedGifs Downloader"
        
        # Copy additional files
        cp README.md "build/bin/darwin-universal/" 2>/dev/null || true
        cp LICENSE "build/bin/darwin-universal/" 2>/dev/null || true
        cp config.example.yaml "build/bin/darwin-universal/" 2>/dev/null || true
        
        # Create universal archive
        UNIVERSAL_ARCHIVE="redgifs-downloader-v$VERSION-darwin-universal.tar.gz"
        tar -czf "dist/$UNIVERSAL_ARCHIVE" -C "build/bin/darwin-universal" .
        
        log_success "Universal macOS package created: dist/$UNIVERSAL_ARCHIVE"
        
        # Calculate checksum
        if command -v sha256sum &> /dev/null; then
            sha256sum "dist/$UNIVERSAL_ARCHIVE" > "dist/$UNIVERSAL_ARCHIVE.sha256"
        elif command -v shasum &> /dev/null; then
            shasum -a 256 "dist/$UNIVERSAL_ARCHIVE" > "dist/$UNIVERSAL_ARCHIVE.sha256"
        fi
    fi
fi

log_success "Build process completed successfully!"
log_info "Output files:"
ls -la dist/ | grep -v "^total" | awk '{print "  - " $9}' | grep -v "^  - $"
