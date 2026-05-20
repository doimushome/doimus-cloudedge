# doimus-cloudedge

Doimus native plugin for CloudEdge/Meari SDK security cameras.

## Supported Brands

This plugin works with all cameras using the CloudEdge or Meari SDK, including:

- **ieGeek** — ZS-GX5, ZS-GX2S, ZS-GX1S, ZS-GQ4, ZS-GX5S, ZY-E1, doorbells
- **DEKCO** — DC2L, DC9L, DC8L, wired cameras, floodlights
- **ZUMIMALL** — F5, ZS-GX2S, ZS-GX1S, Bell J7 doorbell
- **ANRAN** — S1, S2, S3, S4
- **Cooau** — battery and wired cameras
- **MUBVIEW** — Bell J7 doorbell
- **Arenti** — smart cameras
- **Wansview** — wired and battery cameras
- **Laxihub** — security cameras
- **Galayou** — indoor/outdoor cameras

## Installation

```bash
npm install
```

## Configuration

```json
{
  "plugin": "doimus-cloudedge",
  "email": "your-account@example.com",
  "password": "your-password",
  "region": "eu",
  "pollInterval": 30,
  "pushSwitches": [
    {
      "deviceId": "your-device-id",
      "enabled": false
    }
  ]
}
```

### Options

| Field | Required | Default | Description |
|---|---|---|---|
| `email` | Yes | - | Account email used with the CloudEdge app |
| `password` | Yes | - | Account password |
| `region` | Yes | `eu` | Region: `eu`, `us`, `cn`, or `ot` |
| `pollInterval` | No | `30` | Device status polling interval in seconds (5-300) |
| `pushSwitches` | No | `[]` | Array of device push notification controls |

### Regions

| Code | Region | API Endpoint |
|---|---|---|
| `eu` | Europe | `openapi-euce.mearicloud.com` |
| `us` | United States | `openapi-usce.mearicloud.com` |
| `cn` | China | `openapi.mearicloud.com` |
| `ot` | Other | `openapi-asce.mearicloud.com` |

## Features

- **Device discovery** — automatically finds all cameras linked to your account
- **Push notification control** — enable/disable motion alerts per device
- **Live stream URLs** — retrieve RTSP/FLV stream URLs for camera feeds
- **Device status** — monitor online status, battery level, and WiFi signal
- **Parameter control** — send device-specific commands (PTZ, settings, etc.)

## API Reference

This plugin uses the Meari OpenAPI protocol. Key endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/openapi/user/login` | POST | Authenticate and get access token |
| `/openapi/user/logout` | POST | Invalidate session |
| `/openapi/user/refresh` | POST | Refresh access token |
| `/openapi/device/list` | GET | List all devices |
| `/openapi/device/status` | GET | Get device online status |
| `/openapi/device/param` | POST | Get device parameters |
| `/openapi/device/param/set` | POST | Set device parameters |
| `/openapi/device/push` | GET | Get push notification status |
| `/openapi/device/push/set` | POST | Enable/disable push notifications |
| `/openapi/device/live` | POST | Get live stream URL |

## Notes

- Free 7-day cloud storage trial available for most cameras
- All videos are encrypted via AES 256-bit encryption
- Micro SD card support on all devices
- No pet or vehicle recognition on CloudEdge platform
