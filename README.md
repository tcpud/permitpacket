# Tahoe Cedars Permit Packet by Email

Property owners enter their service address and email. The packet (Form TC2.1, Permit Guidance, Tahoe City Details) and their property map are emailed to them from tahoecedars@tcpud.org.

## How it works

- **Page** (`public/index.html`): address + email form, same look as the permit status lookup.
- **Worker** (`src/worker.js`): matches the address against `src/parcels.json`, then sends the request to the Power Automate flow (`FLOW_URL` secret). Limits each visitor, email, and property to 5 requests per minute. A hidden form field quietly drops bot submissions.
- **Flow**: gets the four PDFs from OneDrive/SharePoint, emails them from the tahoecedars@tcpud.org shared mailbox, replies to the Worker, then runs the Office Script and notifies the team.
- **Office Script** (`office-script/mark-application-provided.ts`): finds the row by APN. Fills Application Provided Date and Application Version if empty, and adds "Packet emailed to ... on ..." to NOTES. Touches nothing else.

The map attachment drops the word "Permit" from its name: `Ph1_Permit_7TH AVE 7024.pdf` is attached as `Ph1_7TH AVE 7024.pdf`.

## Request the Worker sends to the flow

```json
{
  "apn": "015-034-005",
  "address": "7025 7TH AVENUE",
  "email": "owner@example.com",
  "mapFileName": "Ph1_Permit_7TH AVE 7025.pdf",
  "mapAttachmentName": "Ph1_7TH AVE 7025.pdf",
  "appVersion": "NOT EARLY TC 2.1",
  "requestedAt": "2026-11-06T16:46:39.020Z"
}
```

The flow must reply with status 200 after the customer email is sent. Anything else shows the customer an error.

## Keeping things in sync

| What | Where it's set |
|---|---|
| Parcels and map file names | `data/parcels.csv`, then `npm run build` and commit `src/parcels.json` |
| Packet file names and folders | The three packet "Get file content using path" steps in the flow |
| Application Version text | `APP_VERSION` in `wrangler.jsonc` |
| Customer email wording | "Send an email from a shared mailbox" step in the flow |

## Deploy

GitHub repo connected to Cloudflare Workers. `FLOW_URL` is a Secret under the Worker's Settings > Variables and Secrets.
