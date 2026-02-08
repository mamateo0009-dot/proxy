# Makefile for cross-platform builds
# Works on Windows (with make), Linux, and macOS

.PHONY: help build run clean install test dev

# Default target
help:
	@echo "Remote Terminal - Build Commands"
	@echo ""
	@echo "Usage:"
	@echo "  make build        - Build release binary"
	@echo "  make run          - Build and run server"
	@echo "  make dev          - Run in development mode"
	@echo "  make clean        - Clean build artifacts"
	@echo "  make install      - Install to system (Linux/macOS)"
	@echo "  make test         - Run tests"
	@echo ""

# Build release binary
build:
	@echo "Building release binary..."
	cargo build --release
	@echo "Done! Binary at: ./target/release/sshx-server"

# Build and run
run: build
	@echo "Starting server..."
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File start-server.ps1
else
	chmod +x start-server.sh
	./start-server.sh
endif

# Development mode with hot reload
dev:
	@echo "Starting development server..."
	cargo run --bin sshx-server -- --bind 0.0.0.0:8051

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	cargo clean
	@echo "Done!"

# Install to system (Linux/macOS only)
install: build
ifeq ($(OS),Windows_NT)
	@echo "Install not supported on Windows. Use the binary directly."
else
	@echo "Installing to /usr/local/bin..."
	sudo cp target/release/sshx-server /usr/local/bin/
	sudo chmod +x /usr/local/bin/sshx-server
	@echo "Done! Run with: sshx-server"
endif

# Run tests
test:
	@echo "Running tests..."
	cargo test

# Build for specific targets
build-linux:
	cargo build --release --target x86_64-unknown-linux-musl

build-windows:
	cargo build --release --target x86_64-pc-windows-msvc

build-macos:
	cargo build --release --target x86_64-apple-darwin

# Cross-compile for all platforms (Linux host required)
build-all:
	chmod +x build.sh
	./build.sh

# Build optimized for VPS
build-vps:
	@echo "Building optimized for low-resource VPS..."
	RUSTFLAGS="-C target-cpu=native" cargo build --release
	@echo "Done! Binary size:"
ifeq ($(OS),Windows_NT)
	@powershell -Command "Get-Item target\release\sshx-server.exe | Select-Object Length"
else
	@ls -lh target/release/sshx-server | awk '{print $$5}'
endif
