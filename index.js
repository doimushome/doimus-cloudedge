const CloudEdgeClient = require("./CloudEdgeClient");

let client = null;
let devices = new Map();
let pollTimer = null;

function makeDeviceId(device) {
  const crypto = require("crypto");
  if (device.device_id) return `cloudedge-${device.device_id}`;
  const hash = crypto.createHash("sha256").update(device.device_name || "").digest("hex").slice(0, 16);
  return `cloudedge-${hash}`;
}

module.exports = {
  start(cfg, api) {
    client = new CloudEdgeClient({
      email: cfg.email,
      password: cfg.password,
      region: cfg.region || "eu",
    });

    api.onCommand(async (deviceId, key, value) => {
      const info = devices.get(deviceId);
      if (!info) return;

      try {
        if (key === "on") {
          await client.setPushStatus(info.raw.device_id, value);
          api.updateDeviceState(deviceId, { on: value });
        }
      } catch (e) {
        api.log("error", `Command failed for ${deviceId}: ${e.message}`);
      }
    });

    syncDevices(cfg, api).catch((e) => api.log("error", `Initial sync error: ${e.message}`));

    const intervalMs = (cfg.pollInterval || 30) * 1000;
    pollTimer = setInterval(async () => {
      try {
        await syncDevices(cfg, api);
        for (const [did] of devices) {
          try {
            const frame = await client.getSnapshot(did);
            if (frame) api.sendMjpegFrame(did, "main", frame.toString("base64"));
          } catch (_) { /* snapshot best-effort */ }
        }
      } catch (e) {
        api.log("error", `Periodic sync error: ${e.message}`);
      }
    }, intervalMs);
    if (pollTimer.unref) pollTimer.unref();
  },

  stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (client) {
      client.logout().catch(() => {});
      client = null;
    }
    devices.clear();
  },
};

async function syncDevices(cfg, api) {
  const rawDevices = await client.getDevices();
  const seen = new Set();

  for (const device of rawDevices) {
    const did = makeDeviceId(device);
    seen.add(did);

    const caps = ["online"];
    const state = { online: device.online_status === 1 || device.is_online === true };

    if (device.battery_percentage !== undefined) {
      caps.push("battery", "battery_low");
      state.battery = device.battery_percentage;
      state.battery_low = device.battery_percentage < 20;
    }

    if (cfg.pushSwitches?.some((ps) => ps.deviceId === device.device_id)) {
      caps.push("on");
      state.on = false;
    }

    if (!devices.has(did)) {
      api.registerDevice({
        id: did,
        name: device.device_name || device.device_id,
        type: "camera",
        capabilities: caps,
        state,
      });
      api.log("info", `Registered camera: ${device.device_name || device.device_id}`);
    }

    devices.set(did, { raw: device });
    api.updateDeviceState(did, state);
  }

  for (const [did] of devices) {
    if (!seen.has(did)) {
      devices.delete(did);
      api.log("info", `Removed stale device: ${did}`);
    }
  }
}
