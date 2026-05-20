# ROV Trail Widget — BlueOS Extension

Real-time ROV position tracking with trail history, target waypoints, and KML import.
Runs as a BlueOS Docker extension and can be iframed inside Cockpit.

## Local Development

**Build:**
```bash
docker build -t rov-trail-widget .
```

**Run:**
```bash
mkdir -p ./data
docker run --rm -p 8000:8000 -v "$(pwd)/data:/data" rov-trail-widget
```

Open `http://localhost:8000`

**Test trail persistence:**
```bash
# Save data
curl -X POST http://localhost:8000/trail \
  -H "Content-Type: application/json" \
  -d '{"trail":[{"lat":51.1,"lon":-1.5}],"targets":[],"activeTargetIndex":-1}'

# Retrieve (survives container restart when /data volume is mounted)
curl http://localhost:8000/trail
```

**Check BlueOS manifest:**
```bash
curl http://localhost:8000/register_service
```

## BlueOS Installation (Manual)

BlueOS UI → Extensions → Extension Manager → Install (manual):

| Field | Value |
|---|---|
| Extension Identifier | `rogengineering.rov-trail-widget` |
| Extension Name | `ROV Trail Widget` |
| Docker Image | `<your-dockerhub-username>/rov-trail-widget` |
| Docker Tag | `main` |

**Settings JSON:**
```json
{
  "ExposedPorts": { "8000/tcp": {} },
  "HostConfig": {
    "Binds": ["/usr/blueos/extensions/rov-trail-widget:/data"],
    "PortBindings": { "8000/tcp": [{ "HostPort": "" }] }
  }
}
```

## GitHub Actions Setup

Set the following in your repo (Settings → Secrets and variables → Actions):

**Secrets:**
- `DOCKER_USERNAME`
- `DOCKER_PASSWORD`

**Variables:**
- `IMAGE_NAME` = `rov-trail-widget`
- `BUILD_PLATFORMS` = `linux/arm64/v8,linux/amd64`
- `MY_NAME` = your name
- `MY_EMAIL` = your email
- `ORG_NAME` = organisation name
- `ORG_EMAIL` = organisation email

Run the deploy workflow manually from the Actions tab.

## Architecture

```
app/
├── main.py                  Litestar backend — serves static files + trail API
├── requirements-runtime.txt
└── static/
    ├── index.html           Widget UI
    ├── js/app.js            Widget logic
    ├── css/style.css        Styles
    ├── icons/               SVG icons
    └── register_service     BlueOS extension manifest
```

**API routes:**
- `GET /` — widget UI
- `GET /register_service` — BlueOS manifest
- `GET /trail` — load persisted trail from `/data/trail.json`
- `POST /trail` — save trail to `/data/trail.json`

## How to Use

- Click the file-import icon to import a .kml or .gpx file.
- Use the compass / navigation icon to toggle between North-up and ROV-up modes.
- Use the chevron to open and close the targets panel.
- In the target panel:
    - Click the target icon to set a target as the active target.
    - Click the X icon to remove a target.
    - Drag to reorder targets.

## Roadmap

- **PR 2** — Replace `window.cockpit` with MAVLink2Rest REST polling + wire trail auto-save
- **PR 3** — Replace canvas rendering with Leaflet.js (transparent, no tiles)
