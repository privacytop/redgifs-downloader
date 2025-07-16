# RedGifs Downloader Makefile
# Provides convenient commands for building, testing, and managing the application

# Variables
APP_NAME := redgifs-downloader
VERSION := 3.0.0
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.buildTime=$(BUILD_TIME) -X main.gitCommit=$(GIT_COMMIT)

# Directories
BUILD_DIR := build
DIST_DIR := dist
FRONTEND_DIR := frontend

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Help target
.PHONY: help
help: ## Show this help message
	@echo "$(BLUE)RedGifs Downloader Build System$(NC)"
	@echo ""
	@echo "$(GREEN)Available targets:$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Development targets
.PHONY: dev
dev: ## Start development server with hot reload
	@echo "$(BLUE)Starting development server...$(NC)"
	wails dev

.PHONY: dev-frontend
dev-frontend: ## Start frontend development server only
	@echo "$(BLUE)Starting frontend development server...$(NC)"
	cd $(FRONTEND_DIR) && npm run dev

# Build targets
.PHONY: build
build: clean deps ## Build the application for current platform
	@echo "$(BLUE)Building application...$(NC)"
	wails build -clean -ldflags "$(LDFLAGS)"
	@echo "$(GREEN)Build completed successfully!$(NC)"

.PHONY: build-all
build-all: clean deps ## Build for all supported platforms
	@echo "$(BLUE)Building for all platforms...$(NC)"
	./build.sh --version $(VERSION) --clean --package
	@echo "$(GREEN)All builds completed successfully!$(NC)"

.PHONY: build-windows
build-windows: clean deps ## Build for Windows
	@echo "$(BLUE)Building for Windows...$(NC)"
	wails build -clean -platform windows/amd64 -ldflags "$(LDFLAGS)"
	@echo "$(GREEN)Windows build completed!$(NC)"

.PHONY: build-linux
build-linux: clean deps ## Build for Linux
	@echo "$(BLUE)Building for Linux...$(NC)"
	wails build -clean -platform linux/amd64 -ldflags "$(LDFLAGS)"
	@echo "$(GREEN)Linux build completed!$(NC)"

.PHONY: build-macos
build-macos: clean deps ## Build for macOS (both Intel and Apple Silicon)
	@echo "$(BLUE)Building for macOS...$(NC)"
	wails build -clean -platform darwin/amd64 -ldflags "$(LDFLAGS)"
	wails build -clean -platform darwin/arm64 -ldflags "$(LDFLAGS)"
	@echo "$(GREEN)macOS builds completed!$(NC)"

# Dependency management
.PHONY: deps
deps: ## Install all dependencies
	@echo "$(BLUE)Installing Go dependencies...$(NC)"
	go mod download
	go mod tidy
	@echo "$(BLUE)Installing frontend dependencies...$(NC)"
	cd $(FRONTEND_DIR) && npm install
	@echo "$(GREEN)Dependencies installed successfully!$(NC)"

.PHONY: deps-update
deps-update: ## Update all dependencies
	@echo "$(BLUE)Updating Go dependencies...$(NC)"
	go get -u ./...
	go mod tidy
	@echo "$(BLUE)Updating frontend dependencies...$(NC)"
	cd $(FRONTEND_DIR) && npm update
	@echo "$(GREEN)Dependencies updated successfully!$(NC)"

# Testing targets
.PHONY: test
test: ## Run all tests
	@echo "$(BLUE)Running Go tests...$(NC)"
	go test -v ./...
	@echo "$(GREEN)All tests passed!$(NC)"

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	@echo "$(BLUE)Running tests with coverage...$(NC)"
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "$(GREEN)Coverage report generated: coverage.html$(NC)"

.PHONY: benchmark
benchmark: ## Run benchmarks
	@echo "$(BLUE)Running benchmarks...$(NC)"
	go test -bench=. -benchmem ./...

# Code quality targets
.PHONY: lint
lint: ## Run linters
	@echo "$(BLUE)Running Go linters...$(NC)"
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run; \
	else \
		echo "$(YELLOW)golangci-lint not found, running basic checks...$(NC)"; \
		go vet ./...; \
		go fmt ./...; \
	fi
	@echo "$(GREEN)Linting completed!$(NC)"

.PHONY: format
format: ## Format code
	@echo "$(BLUE)Formatting Go code...$(NC)"
	go fmt ./...
	@echo "$(BLUE)Formatting frontend code...$(NC)"
	cd $(FRONTEND_DIR) && npm run format 2>/dev/null || echo "No format script found"
	@echo "$(GREEN)Code formatted!$(NC)"

# Database targets
.PHONY: db-migrate
db-migrate: ## Run database migrations
	@echo "$(BLUE)Running database migrations...$(NC)"
	go run . --migrate
	@echo "$(GREEN)Migrations completed!$(NC)"

.PHONY: db-reset
db-reset: ## Reset database (WARNING: This will delete all data)
	@echo "$(RED)WARNING: This will delete all data!$(NC)"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		rm -f redgifs.db; \
		echo "$(GREEN)Database reset completed!$(NC)"; \
	else \
		echo "$(YELLOW)Database reset cancelled.$(NC)"; \
	fi

# Cleanup targets
.PHONY: clean
clean: ## Clean build artifacts
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	rm -rf $(BUILD_DIR) $(DIST_DIR)
	rm -f coverage.out coverage.html
	@echo "$(GREEN)Cleanup completed!$(NC)"

.PHONY: clean-all
clean-all: clean ## Clean everything including dependencies
	@echo "$(BLUE)Cleaning dependencies...$(NC)"
	go clean -modcache
	cd $(FRONTEND_DIR) && rm -rf node_modules package-lock.json
	@echo "$(GREEN)Full cleanup completed!$(NC)"

# Release targets
.PHONY: release
release: test build-all ## Create a release (run tests and build for all platforms)
	@echo "$(BLUE)Creating release v$(VERSION)...$(NC)"
	@echo "$(GREEN)Release v$(VERSION) created successfully!$(NC)"
	@echo "$(BLUE)Release artifacts:$(NC)"
	@ls -la $(DIST_DIR)/

.PHONY: release-notes
release-notes: ## Generate release notes
	@echo "$(BLUE)Generating release notes...$(NC)"
	@echo "# Release v$(VERSION)" > RELEASE_NOTES.md
	@echo "" >> RELEASE_NOTES.md
	@echo "## Changes" >> RELEASE_NOTES.md
	@git log --oneline --since="$(shell git describe --tags --abbrev=0 2>/dev/null || echo '1 month ago')" >> RELEASE_NOTES.md
	@echo "$(GREEN)Release notes generated: RELEASE_NOTES.md$(NC)"

# Docker targets (if needed in the future)
.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "$(BLUE)Building Docker image...$(NC)"
	docker build -t $(APP_NAME):$(VERSION) .
	docker tag $(APP_NAME):$(VERSION) $(APP_NAME):latest
	@echo "$(GREEN)Docker image built successfully!$(NC)"

# Installation targets
.PHONY: install
install: build ## Install the application locally
	@echo "$(BLUE)Installing application...$(NC)"
	@if [ "$(shell uname)" = "Darwin" ]; then \
		cp "$(BUILD_DIR)/bin/$(APP_NAME)" /usr/local/bin/; \
	elif [ "$(shell uname)" = "Linux" ]; then \
		sudo cp "$(BUILD_DIR)/bin/$(APP_NAME)" /usr/local/bin/; \
	else \
		echo "$(YELLOW)Manual installation required for this platform$(NC)"; \
	fi
	@echo "$(GREEN)Installation completed!$(NC)"

.PHONY: uninstall
uninstall: ## Uninstall the application
	@echo "$(BLUE)Uninstalling application...$(NC)"
	@if [ "$(shell uname)" = "Darwin" ]; then \
		rm -f /usr/local/bin/$(APP_NAME); \
	elif [ "$(shell uname)" = "Linux" ]; then \
		sudo rm -f /usr/local/bin/$(APP_NAME); \
	fi
	@echo "$(GREEN)Uninstallation completed!$(NC)"

# Information targets
.PHONY: info
info: ## Show build information
	@echo "$(BLUE)Build Information:$(NC)"
	@echo "  App Name:    $(APP_NAME)"
	@echo "  Version:     $(VERSION)"
	@echo "  Build Time:  $(BUILD_TIME)"
	@echo "  Git Commit:  $(GIT_COMMIT)"
	@echo "  Go Version:  $(shell go version)"
	@echo "  Platform:    $(shell go env GOOS)/$(shell go env GOARCH)"

.PHONY: check-deps
check-deps: ## Check if all required dependencies are installed
	@echo "$(BLUE)Checking dependencies...$(NC)"
	@command -v go >/dev/null 2>&1 || { echo "$(RED)Go is not installed$(NC)"; exit 1; }
	@command -v wails >/dev/null 2>&1 || { echo "$(RED)Wails is not installed$(NC)"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "$(RED)Node.js is not installed$(NC)"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "$(RED)npm is not installed$(NC)"; exit 1; }
	@echo "$(GREEN)All required dependencies are installed!$(NC)"
