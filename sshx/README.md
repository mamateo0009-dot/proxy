# VPS Deployment Guide - Low Resource Optimization

This build has been optimized for low-resource VPS environments (512MB-1GB RAM, 1-2 CPU cores).

## Optimizations Applied

### Memory Optimizations
- **Shell buffer**: Reduced from 2 MiB to 512 KiB per shell
- **Snapshot size**: Reduced from 4 MiB to 1 MiB
- **Broadcast channels**: Reduced from 64 to 16 slots
- **Dependencies**: Disabled unnecessary features

### CPU Optimizations
- **Tokio threads**: Limited to 2 worker threads (configurable)
- **Binary size**: Optimized with LTO and size optimization (`opt-level = "z"`)
- **Stripped binary**: Debug symbols removed

## Building for VPS

### Standard build:
```bash
cargo build --release
```

### For even smaller binary (Linux static):
```bash
cargo build --release --target x86_64-unknown-linux-musl
```

## Running on VPS

### Quick start:
```bash
chmod +x start-server-vps.sh
./start-server-vps.sh
```

### Manual start with custom settings:
```bash
# Adjust worker threads based on your VPS CPU cores
export TOKIO_WORKER_THREADS=2

# Reduce logging for better performance
export RUST_LOG=warn

# Start server
./target/release/sshx-server --bind 0.0.0.0:8051
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKIO_WORKER_THREADS` | 2 | Number of Tokio worker threads |
| `RUST_LOG` | warn | Log level (error, warn, info, debug, trace) |
| `SSHX_SERVER` | http://localhost:8051 | Server URL for clients |

## Resource Usage Estimates

With optimizations:
- **Idle**: ~20-30 MB RAM
- **1 active session**: ~40-60 MB RAM
- **5 active sessions**: ~100-150 MB RAM
- **CPU**: Minimal when idle, scales with active connections

## Systemd Service (Optional)

Create `/etc/systemd/system/sshx-server.service`:

```ini
[Unit]
Description=Remote Terminal Server
After=network.target

[Service]
Type=simple
User=sshx
WorkingDirectory=/opt/sshx
Environment="TOKIO_WORKER_THREADS=2"
Environment="RUST_LOG=warn"
ExecStart=/opt/sshx/target/release/sshx-server --bind 0.0.0.0:8051
Restart=on-failure
RestartSec=5s

# Resource limits for safety
MemoryMax=512M
CPUQuota=150%

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable sshx-server
sudo systemctl start sshx-server
```

## Monitoring

Check resource usage:
```bash
# Memory
ps aux | grep sshx-server

# Detailed stats
top -p $(pgrep sshx-server)
```

## Troubleshooting

### Out of Memory
- Reduce `TOKIO_WORKER_THREADS` to 1
- Limit max concurrent sessions
- Check for memory leaks with `valgrind` (development only)

### High CPU Usage
- Reduce log level to `error`
- Check for infinite loops in client connections
- Monitor with `htop` or `perf`

### Connection Issues
- Check firewall: `sudo ufw allow 8051/tcp`
- Verify binding: `netstat -tlnp | grep 8051`
- Check logs: `journalctl -u sshx-server -f`
