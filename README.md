# Tahoe Cedars Permit Packet Download

Property owners enter their address and click one button to download four PDFs: Form TC2.1, Permit Guidance, Tahoe City Details, and their property map.

## How it works

- **Page** (`public/index.html`): same look as the permit status lookup.
- **Worker** (`src/worker.js`): matches the address, then asks the Power Automate flow for each file.
- **Flow**: gets the file from SharePoint and returns it. For Form TC2.1 it also fills Application Provided Date and Application Version in the tracking sheet (first download only) and emails tahoecedars@tcpud.org.
- **Parcel list** (`data/parcels.csv` → `src/parcels.json`): the only addresses the tool will match.

Download links use a random ID per parcel, so nobody can guess another property's link. The word "Permit" is removed from map names at download.

## Files to keep in sync

| What | Where it's set |
|---|---|
| Packet file names | `PACKET_FILES` in `src/worker.js` (must match SharePoint exactly) |
| Map file names | `MapFile` column in `data/parcels.csv` |
| Application Version text | `APP_VERSION` in `wrangler.jsonc` |
| SharePoint folders | "Get file content using path" step in the flow |

After changing `data/parcels.csv`, run `npm install` then `npm run build`, and commit the updated `src/parcels.json`.

## Flow request format

The Worker POSTs this to the flow for every download and expects the PDF back:

```json
{
  "apn": "015-034-005",
  "address": "7025 7TH AVENUE",
  "file": "application",
  "folder": "packet",
  "fileName": "Form TC2.1 - Service Relocation Permit_fillable.pdf",
  "appVersion": "NOT EARLY TC 2.1",
  "downloadedAt": "2026-11-05T23:56:31.851Z",
  "log": true
}
```

`file` is `application`, `guidance`, `details`, or `map`. `folder` is `packet` or `maps`. `log` is false for bots and link scanners.

## Deploy

GitHub repo connected to Cloudflare Workers (Import a repository). Set `FLOW_URL` as a secret under the Worker's Settings > Variables and Secrets.
