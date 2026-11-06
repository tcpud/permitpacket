// Tahoe Cedars permit packet + map download Worker
//
// Routes
//   POST /api/lookup              { streetNumber, streetName } -> { found, address, id, files }
//   GET  /download/<id>/<file>    one of the PACKET_FILES below, or "map"
// Everything else is served from /public.
//
// Files live in SharePoint. For each download the Worker asks a Power
// Automate flow (FLOW_URL secret) for the file. The flow returns the PDF
// and, for Form TC2.1, updates the tracking sheet and emails the team.

import parcels from "./parcels.json";
import { normalizeNumber, normalizeStreet } from "./normalize.js";

// Packet documents (same for every parcel). "fileName" must match the file
// in the SharePoint packet folder exactly. Downloads of "application" fill
// the tracking spreadsheet.
const PACKET_FILES = [
  {
    slug: "application",
    fileName: "Form TC2.1 - Service Relocation Permit_fillable.pdf",
    label: "Application Form TC2.1",
    note: "Fillable form. Complete and return to TCPUD.",
  },
  {
    slug: "guidance",
    fileName: "PSR Permit Guidance V2.pdf",
    label: "Permit Guidance",
    note: "How to fill out and submit your application.",
  },
  {
    slug: "details",
    fileName: "TAHOE CITY DETAILS V3 JUNE 2026.pdf",
    label: "Tahoe City Construction Details",
    note: "Standard drawings for your contractor.",
  },
];
const bySlug = new Map(PACKET_FILES.map((f) => [f.slug, f]));

const byId = new Map(parcels.map((p) => [p.id, p]));
const BOT_UA = /bot|crawler|spider|preview|scanner|curl|wget|python-requests|headless/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lookup" && request.method === "POST") {
      return lookup(request);
    }

    const m = url.pathname.match(/^\/download\/([A-Za-z0-9_-]+)\/([a-z]+)$/);
    if (m && (request.method === "GET" || request.method === "HEAD")) {
      return download(request, env, ctx, m[1], m[2]);
    }

    return env.ASSETS.fetch(request);
  },
};

async function lookup(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const number = normalizeNumber(body.streetNumber);
  const street = normalizeStreet(body.streetName);
  if (!number || !street.full) return json({ found: false });

  const sameNumber = parcels.filter((p) => p.number === number);

  // Exact street match first ("9th Ave"), then without suffix ("9th").
  let hits = sameNumber.filter((p) => p.street === street.full);
  if (!hits.length) hits = sameNumber.filter((p) => p.streetBase === street.base);

  if (hits.length === 1) {
    const p = hits[0];
    return json({
      found: true,
      address: p.address,
      id: p.id,
      files: [
        ...PACKET_FILES.map(({ slug, label, note }) => ({ slug, label, note })),
        { slug: "map", label: "Your Property Map", note: `Map for ${p.address}.` },
      ],
    });
  }
  if (hits.length > 1) return json({ found: false, ambiguous: true });
  return json({ found: false });
}

async function download(request, env, ctx, id, kind) {
  const parcel = byId.get(id);
  if (!parcel) return new Response("Not found", { status: 404 });

  const doc = kind === "map" ? null : bySlug.get(kind);
  if (kind !== "map" && !doc) return new Response("Not found", { status: 404 });
  if (request.method === "HEAD") return new Response(null, { status: 200 });

  const ua = request.headers.get("user-agent") || "";
  const payload = {
    apn: parcel.apn,
    address: parcel.address,
    file: kind, // "application", "guidance", "details", or "map"
    folder: doc ? "packet" : "maps",
    fileName: doc ? doc.fileName : parcel.mapFile,
    appVersion: env.APP_VERSION || "",
    downloadedAt: new Date().toISOString(),
    log: !BOT_UA.test(ua), // false for bots and link scanners
  };

  let res;
  try {
    res = await fetch(env.FLOW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`Flow call failed for ${parcel.apn} ${kind}: ${err}`);
    return unavailable();
  }
  if (!res.ok) {
    console.error(`Flow returned ${res.status} for ${parcel.apn} ${kind} (${payload.fileName})`);
    return unavailable();
  }

  const filename = doc ? doc.fileName : customerFilename(parcel.mapFile);
  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "private, no-store",
  };
  const len = res.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  return new Response(res.body, { headers });
}

function unavailable() {
  return new Response(
    "This file isn't available right now. Please try again, or email tahoecedars@tcpud.org.",
    { status: 503, headers: { "Content-Type": "text/plain" } }
  );
}

// Removes the word "Permit" from the stored file name so customers don't
// mistake the map for an issued permit.
// "Ph1_Permit_7TH AVE 7024.pdf" -> "Ph1_7TH AVE 7024.pdf"
export function customerFilename(stored) {
  const name = String(stored).split("/").pop();
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : ".pdf";
  const cleaned = stem
    .replace(/(^|[_\s-])permit(?=[_\s-]|$)/gi, "$1")
    .replace(/([_\s-])\1+/g, "$1")
    .replace(/^[_\s-]+|[_\s-]+$/g, "");
  return (cleaned || "Tahoe-Cedars-Map") + ext;
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
