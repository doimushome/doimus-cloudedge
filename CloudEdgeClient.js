const axios = require("axios");
const crypto = require("crypto");

const REGIONS = {
  eu: {
    api: "https://openapi-euce.mearicloud.com",
    app: "cloudedge",
    countryCode: "+41",
    timezone: "Europe/Zurich",
  },
  us: {
    api: "https://openapi-usce.mearicloud.com",
    app: "cloudedge",
    countryCode: "+1",
    timezone: "America/New_York",
  },
  cn: {
    api: "https://openapi.mearicloud.com",
    app: "cloudedge",
    countryCode: "+86",
    timezone: "Asia/Shanghai",
  },
  ot: {
    api: "https://openapi-asce.mearicloud.com",
    app: "cloudedge",
    countryCode: "+65",
    timezone: "Asia/Singapore",
  },
};

class CloudEdgeClient {
  constructor({ email, password, region = "eu" }) {
    this.email = email;
    this.password = password;
    this.region = REGIONS[region] || REGIONS.eu;
    this.baseUrl = this.region.api;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.userId = null;
    this.clientId = this._generateClientId();
    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  _generateClientId() {
    return (
      "CET_" +
      crypto.randomBytes(6).toString("hex").toUpperCase().match(/.{1,2}/g).join(":")
    );
  }

  _getTimestamp() {
    return Math.floor(Date.now() / 1000);
  }

  async _request(method, path, data = {}, useAuth = true) {
    const headers = {};
    if (useAuth && this.accessToken) {
      headers["access_token"] = this.accessToken;
      headers["userid"] = this.userId;
      headers["client_id"] = this.clientId;
    }
    const timestamp = this._getTimestamp();
    headers["timestamp"] = timestamp;

    try {
      const response = await this.api.request({
        method,
        url: path,
        data: method === "GET" ? undefined : data,
        params: method === "GET" ? data : undefined,
        headers,
      });
      if (response.data.code !== 0) {
        throw new Error(`API Error ${response.data.code}: ${response.data.msg || response.data.message || "Unknown error"}`);
      }
      return response.data;
    } catch (error) {
      if (error.response?.data?.code === 10002 || error.response?.data?.code === 10001) {
        await this.login();
        headers["access_token"] = this.accessToken;
        headers["userid"] = this.userId;
        const retryResponse = await this.api.request({
          method,
          url: path,
          data: method === "GET" ? undefined : data,
          params: method === "GET" ? data : undefined,
          headers,
        });
        if (retryResponse.data.code !== 0) {
          throw new Error(`API Error ${retryResponse.data.code}: ${retryResponse.data.msg || retryResponse.data.message || "Unknown error"}`);
        }
        return retryResponse.data;
      }
      throw error;
    }
  }

  async login() {
    const loginData = {
      email: this.email,
      password: this.password,
      client_id: this.clientId,
      app: this.region.app,
      country_code: this.region.countryCode,
      timezone: this.region.timezone,
    };

    const response = await this._request("POST", "/openapi/user/login", loginData, false);

    this.accessToken = response.data.access_token;
    this.refreshToken = response.data.refresh_token;
    this.userId = response.data.user_id;
    this.tokenExpiry = this._getTimestamp() + (response.data.expires_in || 7200);

    return response.data;
  }

  async getDevices() {
    const response = await this._request("GET", "/openapi/device/list");
    return response.data || [];
  }

  async getDeviceStatus(deviceId) {
    const response = await this._request("GET", "/openapi/device/status", { device_id: deviceId });
    return response.data;
  }

  async getDeviceParams(deviceId, params = []) {
    const response = await this._request("POST", "/openapi/device/param", {
      device_id: deviceId,
      params,
    });
    return response.data;
  }

  async setDeviceParams(deviceId, params = {}) {
    const response = await this._request("POST", "/openapi/device/param/set", {
      device_id: deviceId,
      params,
    });
    return response.data;
  }

  async getPushStatus(deviceId) {
    const response = await this._request("GET", "/openapi/device/push", { device_id: deviceId });
    return response.data;
  }

  async setPushStatus(deviceId, enabled) {
    const response = await this._request("POST", "/openapi/device/push/set", {
      device_id: deviceId,
      status: enabled ? 1 : 0,
    });
    return response.data;
  }

  async getVideoUrl(deviceId) {
    const response = await this._request("POST", "/openapi/device/live", {
      device_id: deviceId,
      stream_type: 0,
    });
    return response.data;
  }

  async getSnapshot(deviceId) {
    const response = await this._request("GET", "/openapi/device/snapshot", { device_id: deviceId });
    if (response.data?.snapshot) {
      return Buffer.from(response.data.snapshot, "base64");
    }
    return null;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      return this.login();
    }

    const response = await this._request("POST", "/openapi/user/refresh", {
      refresh_token: this.refreshToken,
      client_id: this.clientId,
    }, false);

    this.accessToken = response.data.access_token;
    this.refreshToken = response.data.refresh_token;
    this.tokenExpiry = this._getTimestamp() + (response.data.expires_in || 7200);

    return response.data;
  }

  async logout() {
    try {
      await this._request("POST", "/openapi/user/logout", {
        client_id: this.clientId,
      });
    } catch (error) {
    }
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
  }
}

module.exports = CloudEdgeClient;
