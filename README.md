# Tahoe Cedars Permit Packet Download

Property owners enter their address and download the permit application packet (same for everyone) and their property's map. Each download is logged to Power Automate, which marks the tracking spreadsheet and notifies staff.

## How it works

- **Page** (`public/index.html`): same look as the permit status lookup.
- **Worker** (`src/worker.js`): matches the address, serves files from R2, and logs each download to Power Automate in the background.
- **Parcel list** (`data/parcels.csv` → `src/parcels.json`): the only addresses the tool will match.
- **Files** (R2 bucket `tahoe-cedars-permit-files`):
  - `packet/Tahoe-Cedars-Permit-Packet.pdf`
  - `maps/<MapFile>` for each parcel, stored under its original name

Customers never see the file list. Download links use a random ID per parcel, so nobody can guess another property's link.

**File names:** the word "Permit" is removed from map names at download. `Ph1_Permit_7TH AVE 7024.pdf` downloads as `Ph1_7TH AVE 7024.pdf`. The packet downloads as `Tahoe-Cedars-Permit-Application-Packet.pdf`.

## 1. Fill in the parcel list

Edit `data/parcels.csv` (one row per parcel):

| APN | StreetNumber | StreetName | MapFile |
|---|---|---|---|
| 015-033-011 | 7024 | 7TH AVENUE | Ph1_Permit_7TH AVE 7024.pdf |

- APN must match the tracking spreadsheet exactly (same dashes and spacing). The flow uses it to find the row.
- MapFile must match the PDF name exactly.

Then run:

```
npm install
npm run build
```

## 2. Put the PDFs in place

- Maps go in `data/maps/`
- The packet goes in `data/packet/Tahoe-Cedars-Permit-Packet.pdf`

## 3. Cloudflare setup (one time)

```
npx wrangler login
npx wrangler r2 bucket create tahoe-cedars-permit-files
```

Upload the files (re-run any time maps change; it prints `MISSING` for any map listed in the CSV that isn't in `data/maps/`):

```
scripts/upload-files.sh
```

## 4. Power Automate flow

Prep the spreadsheet (the Tahoe Cedars tracking table the status lookup already reads):

- Columns A-H are synced with GIS. The flow never writes to them; it only uses **APN** (column A) to find the row.
- The flow writes only two columns: **Application Provided Date** (I) and **Application Version** (J). No new columns needed.
- Only packet downloads are recorded. Map downloads are sent to the flow too but ignored.

Build the flow:

1. **Trigger: When an HTTP request is received.** Method POST, "Who can trigger": Anyone. Request body JSON schema:
   ```json
   {
     "type": "object",
     "properties": {
       "apn": { "type": "string" },
       "address": { "type": "string" },
       "file": { "type": "string" },
       "appVersion": { "type": "string" },
       "downloadedAt": { "type": "string" }
     }
   }
   ```
2. **Condition (Packet only):** `file` is equal to `packet`. Put everything below in the **If yes** branch; leave **If no** empty.
3. **Excel Online (Business): Get a row.** Pick the file and table. Key Column: `APN`. Key Value: `apn`.
4. **Compose (Download date):**
   `convertFromUtc(triggerBody()?['downloadedAt'], 'Pacific Standard Time', 'MM/dd/yyyy')`
5. **Compose (Download time):**
   `convertFromUtc(triggerBody()?['downloadedAt'], 'Pacific Standard Time', 'MMM d, yyyy h:mm tt')`
6. **Condition (First download):** the row's `Application Provided Date` is empty.
   - **If yes:**
     - **Update a row.** Key Column `APN`, Key Value `apn`. Set:
       - Application Provided Date = Download date output
       - Application Version = `appVersion` (currently "NOT EARLY TC 2.1")
       - Leave every other field blank so nothing else changes.
     - **Send an email (V2).** To: `tahoecedars@tcpud.org`
       - Subject: `Application packet downloaded: @{triggerBody()?['address']}`
       - Body:
         ```
         An application packet was downloaded from the online tool.

         Address: @{triggerBody()?['address']}
         APN: @{triggerBody()?['apn']}
         Downloaded: @{outputs('Download_time')}
         Version: @{triggerBody()?['appVersion']}

         Application Provided Date and Application Version have been filled in the tracking sheet.
         ```
   - **If no:** nothing. A row that already has a date is never overwritten, and repeat downloads don't send another email.
7. **Error handling:** "Get a row" fails if the APN isn't in the sheet. Add a parallel branch after it, set "Configure run after" to *has failed*, and send an email to tahoecedars@tcpud.org saying the APN wasn't found, so mismatches get caught.

**Header check:** the sheet has two header rows. In the "Update a row" action, confirm the fields you set are the ones for columns I and J. If Power Automate shows different names for them (like blank or "Column9"), use those.

**Changing the version later:** when the packet is updated, replace the PDF in R2 and change `APP_VERSION` in `wrangler.jsonc`, then redeploy. The flow doesn't need to change.

Save the flow and copy the HTTP POST URL.

## 5. Deploy

```
npx wrangler secret put FLOW_URL     # paste the flow URL
npm run deploy
```

The URL stays server-side (not visible in the page source like the status lookup's).

The site is live at `permitpacket.<your-subdomain>.workers.dev`. Add a custom domain in the Cloudflare dashboard if wanted.

## Testing locally

```
scripts/upload-files.sh --local
echo 'FLOW_URL="<test flow URL>"' > .dev.vars
npm run dev
```

Open http://localhost:8787.

## Notes

- Downloads from bots and link scanners are ignored so they don't mark the sheet.
- Lookups match "Avenue" or "Ave", any capitalization, and street names without a suffix ("Pilot" finds "Pilot Rd") when only one street matches.
- Address-only lookup means a neighbor could download someone else's map and mark them as downloaded. If that becomes a problem, add an APN or account number field.
