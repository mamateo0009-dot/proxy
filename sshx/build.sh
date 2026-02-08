#!/bin/bash
# Cross-compilation script for sshx (Client & Server)
# Runs on Linux, builds for Linux, Windows, and macOS

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== sshx Cross-Compilation Builder ===${NC}"

# 1. Check Requirements
echo -e "${YELLOW}[1/4] Checking requirements...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is required for cross-compilation.${NC}"
    echo "Please install Docker first: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! command -v cross &> /dev/null; then
    echo -e "${YELLOW}Installing 'cross' tool (requires Rust/Cargo)...${NC}"
    cargo install cross --git https://github.com/cross-rs/cross
fi

# 2. Define Targets
TARGET_LINUX="x86_64-unknown-linux-musl"
TARGET_WINDOWS="x86_64-pc-windows-gnu"
TARGET_MACOS="x86_64-apple-darwin"

OUTPUT_DIR="build_artifacts"
mkdir -p "$OUTPUT_DIR"

# Use separate target directory to avoid GLIBC mismatch with host
export CARGO_TARGET_DIR="target-cross"

# 3. Build Function
build_target() {
    local target=$1
    local os_name=$2
    local ext=$3
    
    echo -e "${YELLOW}[Building for $os_name ($target)]...${NC}"
    
    # Use cross to build
    cross build --release --target "$target"
    
    # Copy artifacts
    echo "Copying artifacts..."
    
    # Client
    cp "$CARGO_TARGET_DIR/$target/release/sshx$ext" "$OUTPUT_DIR/sshx-$os_name$ext"
    
    # Server
    cp "$CARGO_TARGET_DIR/$target/release/sshx-server$ext" "$OUTPUT_DIR/sshx-server-$os_name$ext"
    
    echo -e "${GREEN}✓ Success: $OUTPUT_DIR/sshx-$os_name$ext${NC}"
}

# 4. Execute Builds

# Linux (Static)
build_target "$TARGET_LINUX" "linux" ""

# Windows
build_target "$TARGET_WINDOWS" "windows" ".exe"

# macOS
# Note: macOS cross-compilation requires Apple SDK which cannot be distributed in Docker.
# We skip it here to avoid build failures. Please build on a Mac.
# build_target "$TARGET_MACOS" "macos" ""
echo -e "${YELLOW}[Skipping macOS] Cross-compilation for macOS requires Apple SDK.${NC}"
echo "Please run 'cargo build --release' on a Mac machine locally."

echo -e "${GREEN}=== Build Complete! ===${NC}"
echo -e "Artifacts are in the '${YELLOW}$OUTPUT_DIR${NC}' directory:"
ls -lh "$OUTPUT_DIR"
