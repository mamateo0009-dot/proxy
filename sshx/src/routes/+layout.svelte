<script lang="ts">
  import "@fontsource-variable/inter";

  import "sshx-xterm/css/xterm.css";
  import "../app.css";

  import ToastContainer from "$lib/ui/ToastContainer.svelte";
  
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let unsub: () => void;

  onMount(() => {
    unsub = page.subscribe(p => {
      // If we are navigating to anything other than login, check auth
      if (!p.url.pathname.startsWith('/login')) {
        const auth = localStorage.getItem('auth');
        if (!auth) {
           goto('/login');
        }
      }
    });
  });

  onDestroy(() => {
    if (unsub) unsub();
  });
</script>

<ToastContainer />

<slot />
