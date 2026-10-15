(() => {
  const apiBase = (window.PEACHY_API_URL || "").replace(/\/$/, "");
  const el = (id) => document.getElementById(id);
  const state = { guilds: [], guildId: null, token: null };

  function notice(message, error = false) {
    const box = el("dashboard-panel").classList.contains("hidden") ? el("welcome-notice") : el("notice");
    box.textContent = message;
    box.classList.toggle("error", error);
    box.classList.remove("hidden");
  }

  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: "omit",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Request failed (${response.status})`);
    }
    return response.status === 204 ? null : response.json();
  }

  function showWelcome() {
    el("loading").classList.add("hidden");
    el("dashboard-panel").classList.add("hidden");
    el("welcome-panel").classList.remove("hidden");
  }

  async function loadGuildSettings() {
    state.guildId = el("guild-select").value;
    if (!state.guildId) return;
    try {
      const settings = await api(`/api/guilds/${state.guildId}/settings`);
      el("automatic-replies").checked = settings.automatic_replies;
      el("automatic-memory").checked = settings.automatic_memory_creation;
      el("memory-batch-size").value = String(settings.memory_batch_size);
      el("response-interval").value = settings.response_interval;
      el("message-threshold").value = String(settings.message_threshold);
      el("reply-chance").value = String(settings.reply_chance);
      el("response-length").value = settings.response_length;
      el("style").value = settings.style;
      document.querySelectorAll("[data-personality]").forEach((input) => {
        input.checked = Boolean(settings.personality[input.dataset.personality]);
      });
      el("notice").classList.add("hidden");
    } catch (error) {
      notice(error.message, true);
    }
  }

  function readSettings() {
    const personality = {};
    document.querySelectorAll("[data-personality]").forEach((input) => {
      personality[input.dataset.personality] = input.checked;
    });
    return {
      automatic_replies: el("automatic-replies").checked,
      automatic_memory_creation: el("automatic-memory").checked,
      memory_batch_size: Number(el("memory-batch-size").value),
      response_interval: Number(el("response-interval").value),
      message_threshold: Number(el("message-threshold").value),
      reply_chance: Number(el("reply-chance").value),
      style: el("style").value,
      response_length: el("response-length").value,
      personality,
    };
  }

  function numericInputsValid() {
    const fields = [
      ["response-interval", 5, 1440],
      ["message-threshold", 10, 1000],
      ["reply-chance", 0, 100],
      ["memory-batch-size", 10, 1000],
    ];
    for (const [id, minimum, maximum] of fields) {
      const field = el(id);
      const raw = field.value;
      if (!/^[0-9]+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum) {
        field.setCustomValidity(`Enter a whole number from ${minimum} to ${maximum}.`);
        field.reportValidity();
        field.setCustomValidity("");
        return false;
      }
    }
    return true;
  }

  async function start() {
    if (!apiBase || apiBase.includes("YOUR-BOT-API-HOST")) {
      el("loading").classList.add("hidden");
      el("welcome-panel").classList.remove("hidden");
      el("login-button").classList.add("disabled");
      el("login-button").setAttribute("aria-disabled", "true");
      el("login-button").removeAttribute("href");
      notice("Set the public HTTPS API URL in config.js before connecting this page.", true);
      return;
    }
    el("login-button").href = `${apiBase}/auth/discord`;
    el("welcome-notice").classList.add("hidden");
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const ticket = fragment.get("ticket");
    if (ticket) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
      try {
        const response = await fetch(`${apiBase}/auth/exchange`, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket }),
        });
        if (!response.ok) throw new Error("Sign-in expired. Please continue with Discord again.");
        state.token = (await response.json()).token;
      } catch (error) {
        showWelcome();
        notice(error.message, true);
        return;
      }
    }
    if (!state.token) {
      showWelcome();
      return;
    }
    try {
      const user = await api("/api/me");
      el("account-name").textContent = user.username;
      el("logout-button").classList.remove("hidden");
      const guilds = await api("/api/guilds");
      state.guilds = guilds;
      el("guild-select").replaceChildren(...guilds.map((guild) => {
        const option = document.createElement("option");
        option.value = guild.id;
        option.textContent = guild.name;
        return option;
      }));
      el("loading").classList.add("hidden");
      el("welcome-panel").classList.add("hidden");
      el("dashboard-panel").classList.remove("hidden");
      if (guilds.length === 0) {
        notice("No manageable servers found where PeachyAI is installed.", true);
        el("settings-form").classList.add("hidden");
        return;
      }
      await loadGuildSettings();
    } catch (error) {
      if (String(error.message).includes("Unauthorized") || String(error.message).includes("Sign in")) {
        state.token = null;
        showWelcome();
      } else {
        showWelcome();
        notice(error.message, true);
      }
    }
  }

  el("guild-select").addEventListener("change", loadGuildSettings);
  el("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!numericInputsValid()) return;
    const button = el("save-button");
    button.disabled = true;
    try {
      await api(`/api/guilds/${state.guildId}/settings`, { method: "PUT", body: JSON.stringify(readSettings()) });
      notice("Settings saved for this server.");
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  el("reset-button").addEventListener("click", async () => {
    if (!state.guildId || !window.confirm("Reset all PeachyAI profile overrides for this server to the bot defaults?")) return;
    try {
      await api(`/api/guilds/${state.guildId}/settings`, { method: "DELETE" });
      await loadGuildSettings();
      notice("Server overrides reset to the bot defaults.");
    } catch (error) {
      notice(error.message, true);
    }
  });
  el("logout-button").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch (_) { /* return to signed-out view */ }
    state.token = null;
    showWelcome();
    el("account-name").textContent = "";
    el("logout-button").classList.add("hidden");
  });
  if (new URLSearchParams(window.location.search).has("signed_in")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  start();
})();
