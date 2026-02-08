<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  
  interface Device {
    id: string;
    elapsed_secs: number;
    key?: string;
    hostname: string;
    user: string;
    cpu: string;
    memory_mb: number;
    os_info: string;
  }
  
  interface ServerStats {
    cpu_usage: number;
    total_memory: number;
    used_memory: number;
    total_disk: number;
    used_disk: number;
    uptime: number;
  }

  let devices: Device[] = [];
  let stats: ServerStats | null = null;
  let loading = true;
  let error = '';
  let refreshInterval: number;

  async function fetchDevices() {
    try {
      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        devices = data.devices;
        stats = data.stats;
        error = '';
      } else {
        error = 'Failed to load devices';
      }
    } catch (e) {
      error = 'Failed to load devices';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    // Initial fetch
    await fetchDevices();
    
    // Auto-refresh every 3 seconds
    refreshInterval = setInterval(fetchDevices, 3000);
  });

  onDestroy(() => {
    // Cleanup interval on component destroy
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  function getDeviceLink(device: Device) {
    if (device.key) {
      return `/s/${device.id}#${device.key}`;
    }
    return `/s/${device.id}`;
  }

  function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s ago`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function formatDuration(seconds: number): string {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function formatMemory(mb: number): string {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${bytes} B`;
  }
</script>

<div class="min-h-screen bg-zinc-900 text-zinc-100 font-sans">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-4">
        <div>
          <h1 class="text-3xl font-bold">Device Management</h1>
          <p class="text-zinc-500 text-sm mt-1">Monitor and manage connected devices</p>
        </div>
        <div class="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span class="text-xs text-green-400 font-medium">Live</span>
        </div>
      </div>
      <button 
        class="text-zinc-400 hover:text-white transition-colors px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500"
        on:click={() => {
          localStorage.removeItem('auth');
          localStorage.removeItem('authTime');
          location.href = '/login';
        }}
      >
        Logout
      </button>
    </div>

    <!-- Server Stats -->
    {#if stats}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <!-- Connected Devices -->
        <div class="bg-zinc-800 p-4 rounded-lg border border-zinc-700">
          <div class="text-zinc-400 text-xs uppercase font-bold mb-1">Connected Devices</div>
          <div class="text-2xl font-bold text-white">{devices.length}</div>
        </div>

        <!-- CPU Usage -->
        <div class="bg-zinc-800 p-4 rounded-lg border border-zinc-700">
          <div class="text-zinc-400 text-xs uppercase font-bold mb-1">Server CPU</div>
          <div class="text-2xl font-bold text-white">{stats.cpu_usage.toFixed(1)}%</div>
          <div class="w-full bg-zinc-700 h-1.5 mt-2 rounded-full overflow-hidden">
            <div class="bg-blue-500 h-full transition-all duration-500" style="width: {stats.cpu_usage}%"></div>
          </div>
        </div>

        <!-- Memory Usage -->
        <div class="bg-zinc-800 p-4 rounded-lg border border-zinc-700">
          <div class="text-zinc-400 text-xs uppercase font-bold mb-1">Server RAM</div>
          <div class="text-2xl font-bold text-white">{formatBytes(stats.used_memory)} / {formatBytes(stats.total_memory)}</div>
           <div class="w-full bg-zinc-700 h-1.5 mt-2 rounded-full overflow-hidden">
            <div class="bg-purple-500 h-full transition-all duration-500" style="width: {(stats.used_memory / stats.total_memory) * 100}%"></div>
          </div>
        </div>

        <!-- Disk Usage -->
        <div class="bg-zinc-800 p-4 rounded-lg border border-zinc-700">
          <div class="text-zinc-400 text-xs uppercase font-bold mb-1">Server Disk</div>
          <div class="text-2xl font-bold text-white">{formatBytes(stats.used_disk)} / {formatBytes(stats.total_disk)}</div>
          <div class="w-full bg-zinc-700 h-1.5 mt-2 rounded-full overflow-hidden">
            <div class="bg-green-500 h-full transition-all duration-500" style="width: {(stats.used_disk / stats.total_disk) * 100}%"></div>
          </div>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="flex items-center justify-center p-12 text-zinc-500 animate-pulse">
        <div class="flex flex-col items-center space-y-4">
          <div class="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
          <p>Loading devices...</p>
        </div>
      </div>
    {:else if error}
      <div class="p-4 bg-red-900/20 text-red-200 border border-red-900/50 rounded-lg">
        {error}. Make sure the server is running.
      </div>
    {:else if devices.length === 0}
      <div class="text-center p-12 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
        <div class="text-zinc-400 text-lg mb-2">No active devices found.</div>
        <p class="text-zinc-500 text-sm">
          Run <code class="bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700 font-mono text-zinc-300">sshx --server http://localhost:8051</code> to connect a device.
        </p>
      </div>
    {:else}
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {#each devices as device}
          <a 
            href={getDeviceLink(device)}
            class="block p-6 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl border border-zinc-700 hover:border-blue-500/50 transition-all duration-200 group relative overflow-hidden hover:shadow-xl hover:shadow-blue-500/20"
          >
            <div class="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <div class="bg-blue-600 text-xs px-3 py-1.5 rounded-full text-white font-medium shadow-lg">
                Connect →
              </div>
            </div>
            
            <!-- Hostname -->
            <div class="mb-4 pb-4 border-b border-zinc-700/50">
              <div class="text-xl font-bold text-zinc-100 group-hover:text-blue-400 transition-colors mb-1">
                {device.hostname}
              </div>
              <div class="flex items-center text-xs text-zinc-500">
                <span class="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
                Online • {formatUptime(device.elapsed_secs)}
              </div>
            </div>
            
            <!-- System Specs -->
            <div class="space-y-3 mb-4">
              <!-- CPU -->
              <div class="flex items-start space-x-3">
                <svg class="w-4 h-4 mt-0.5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-zinc-500 mb-0.5">CPU</div>
                  <div class="text-sm text-zinc-300 truncate">{device.cpu}</div>
                </div>
              </div>
              
              <!-- Memory -->
              <div class="flex items-start space-x-3">
                <svg class="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <div class="flex-1">
                  <div class="text-xs text-zinc-500 mb-0.5">Memory</div>
                  <div class="text-sm text-zinc-300">{formatMemory(device.memory_mb)}</div>
                </div>
              </div>
              
              <!-- OS -->
              <div class="flex items-start space-x-3">
                <svg class="w-4 h-4 mt-0.5 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-zinc-500 mb-0.5">OS</div>
                  <div class="text-sm text-zinc-300 truncate">{device.os_info}</div>
                </div>
              </div>
            </div>
            
            <!-- User & Session -->
            <div class="pt-3 border-t border-zinc-700/50 space-y-2">
              <div class="flex items-center text-xs text-zinc-500">
                <svg class="w-3.5 h-3.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span class="truncate">{device.user}</span>
              </div>
              <div class="flex items-center text-xs text-zinc-600 font-mono">
                <svg class="w-3.5 h-3.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                <span class="truncate">{device.id}</span>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>
