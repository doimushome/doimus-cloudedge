const CloudEdgeClient = require("./CloudEdgeClient");

function createLogger(api, prefix) {
  return (level, msg) => api.log(level, `[${prefix}] ${msg}`);
}

let client = null;
let devices = new Map();
let pollTimer = null;
let savedApi = null;
let log = null;
let syncing = false;
// Live view: deviceId → ffmpeg child process
let liveViewProcesses = new Map();

function makeDeviceId(device) {
  const crypto = require("crypto");
  if (device.device_id) return `cloudedge-${device.device_id}`;
  const fingerprint = JSON.stringify({
    name: device.device_name,
    id: device.device_id,
    mac: device.mac,
    sn: device.sn,
    model: device.device_model,
  });
  const hash = crypto
    .createHash("sha256")
    .update(fingerprint)
    .digest("hex")
    .slice(0, 16);
  return `cloudedge-${hash}`;
}

// ── RTSP → MJPEG relay for live view (p2p_start / p2p_stop) ───────────
async function startLiveView(did, rawDeviceId, api) {
  if (liveViewProcesses.has(did)) {
    log("debug", `Live view already active for ${did}`);
    return;
  }

  try {
    const videoData = await client.getVideoUrl(rawDeviceId);
    const streamUrl = videoData?.url || videoData?.rtsp_url;

    if (!streamUrl) {
      log("error", `No stream URL returned for ${did}`);
      return;
    }

    if (!streamUrl.startsWith("rtsp://")) {
      log(
        "error",
        `Unsupported stream URL format for ${did}: ${streamUrl}`,
      );
      return;
    }

    log("info", `Starting live view for ${did}`);

    const { spawn } = require("child_process");
    const proc = spawn(
      "ffmpeg",
      [
        "-i",
        streamUrl,
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "10",
        "-r",
        "5",
        "-vf",
        "scale=640:-1",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let buffer = Buffer.alloc(0);
    const SOI = Buffer.from([0xff, 0xd8]);
    const EOI = Buffer.from([0xff, 0xd9]);

    proc.stderr.on("data", (data) => {
      log("debug", "ffmpeg: " + data.toString());
    });

    proc.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 10 * 1024 * 1024) {
        log("warn", "Live view buffer overflow, resetting");
        buffer = Buffer.alloc(0);
      }

      while (true) {
        const soiIdx = buffer.indexOf(SOI);
        if (soiIdx === -1) break;

        const eoiIdx = buffer.indexOf(EOI, soiIdx + 2);
        if (eoiIdx === -1) break;

        const jpeg = buffer.subarray(soiIdx, eoiIdx + 2);
        buffer = buffer.subarray(eoiIdx + 2);

        if (jpeg.length > 0) {
          api.sendMjpegFrame(did, "main", jpeg);
          api.updateDeviceImage(did, "snapshot_latest", jpeg, "image/jpeg");
        }
      }
    });

    proc.on("error", (err) => {
      log("error", `Live view ffmpeg error for ${did}: ${err.message}`);
      liveViewProcesses.delete(did);
    });

    proc.on("close", (code) => {
      log("info", `Live view stopped for ${did} (code=${code})`);
      liveViewProcesses.delete(did);
    });

    liveViewProcesses.set(did, proc);
  } catch (e) {
    log("error", `Failed to start live view for ${did}: ${e.message}`);
  }
}

function stopLiveView(did, api) {
  const proc = liveViewProcesses.get(did);
  if (!proc) return;
  log("info", `Stopping live view for ${did}`);
  try {
    proc.kill("SIGTERM");
  } catch (_) {}
  liveViewProcesses.delete(did);
}

module.exports = {
  start(cfg, api) {
    savedApi = api;
    log = createLogger(api, "CloudEdge");
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
        // ── Live view commands (p2p_start / p2p_stop) ──────────
        else if (key === "p2p_start") {
          startLiveView(deviceId, info.raw.device_id, api);
        } else if (key === "p2p_stop") {
          stopLiveView(deviceId, api);
        }
        // ── WebRTC signaling relay from mobile app ─────────────
        else if (key === "webrtc" && value && typeof value === "object") {
          if (value.action === "start") {
            startLiveView(deviceId, info.raw.device_id, api);
          } else if (value.action === "stop") {
            stopLiveView(deviceId, api);
          }
        }
      } catch (e) {
        log("error", `Command failed for ${deviceId}: ${e.message}`);
      }
    });

    syncDevices(cfg, api).catch((e) =>
      log("error", `Initial sync error: ${e.message}`),
    );

    const intervalMs = (cfg.pollInterval || 30) * 1000;
    pollTimer = setInterval(async () => {
      if (syncing) return;
      syncing = true;
      try {
        await syncDevices(cfg, api);
        for (const [did] of devices) {
          const info = devices.get(did);
          if (!info) continue;
          try {
            const frame = await client.getSnapshot(info.raw.device_id);
            if (frame) {
              api.sendMjpegFrame(did, "main", frame);
              api.updateDeviceImage(
                did,
                "snapshot_latest",
                frame,
                "image/jpeg",
              );
            }
          } catch (_) {
            /* snapshot best-effort */
          }
        }
      } finally {
        syncing = false;
      }
    }, intervalMs);
    if (pollTimer.unref) pollTimer.unref();
  },

  setConfig(cfg) {
    this.stop();
    this.start(cfg, savedApi);
  },

  stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    for (const [did] of liveViewProcesses) {
      stopLiveView(did, savedApi);
    }
    liveViewProcesses.clear();
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

    const caps = ["online", "p2p_start", "p2p_stop"];
    const state = {
      online: device.online_status === 1 || device.is_online === true,
    };

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
      log(
        "info",
        `Registered camera: ${device.device_name || device.device_id}`,
      );
    }

    devices.set(did, { raw: device });
    api.updateDeviceState(did, state);
  }

  for (const [did] of devices) {
    if (!seen.has(did)) {
      devices.delete(did);
      log("info", `Removed stale device: ${did}`);
    }
  }
}
