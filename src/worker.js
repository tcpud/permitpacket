// Tahoe Cedars permit packet + map download Worker
//
// Routes
//   POST /api/lookup             { streetNumber, streetName } -> { found, address, id }
//   GET  /download/<id>/packet   permit packet (same file for everyone)
//   GET  /download/<id>/map      that parcel's map
// Everything else is served from /public.
//
// Each download is logged to Power Automate (FLOW_URL secret) in the
// background, so the file is never held up waiting on the flow.

import parcels from "./parcels.json";
import { normalizeNumber, normalizeStreet } from "./normalize.js";

const byId = new Map(parcels.map((p) => [p.id, p]));
const BOT_UA = /bot|crawler|spider|preview|scanner|curl|wget|python-requests|headless/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lookup" && request.method === "POST") {
      return lookup(request);
    }

    const m = url.pathname.match(/^\/download\/([A-Za-z0-9_-]+)\/(packet|map)$/);
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
    return json({ found: true, address: p.address, id: p.id });
  }
  if (hits.length > 1) return json({ found: false, ambiguous: true });
  return json({ found: false });
}

async function download(request, env, ctx, id, kind) {
  const parcel = byId.get(id);
  if (!parcel) return new Response("Not found", { status: 404 });

  const key = kind === "map" ? `maps/${parcel.mapFile}` : env.PACKET_KEY;
  const obj = await env.FILES.get(key);
  if (!obj) {
    console.error(`Missing file in R2: ${key}`);
    return new Response("File not available. Please contact TCPUD.", { status: 404 });
  }

  const filename = kind === "map"
    ? customerFilename(parcel.mapFile)
    : "Tahoe-Cedars-Permit-Application-Packet.pdf";

  const ua = request.headers.get("user-agent") || "";
  if (request.method === "GET" && !BOT_UA.test(ua) && env.FLOW_URL) {
    ctx.waitUntil(logDownload(env, parcel, kind));
  }

  return new Response(request.method === "HEAD" ? null : obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": String(obj.size),
      "Cache-Control": "private, no-store",
    },
  });
}

async function logDownload(env, parcel, kind) {
  const payload = {
    apn: parcel.apn,
    address: parcel.address,
    file: kind, // "packet" or "map"
    appVersion: env.APP_VERSION || "",
    downloadedAt: new Date().toISOString(),
  };
  try {
    const res = await fetch(env.FLOW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`Flow returned ${res.status} for ${parcel.apn}`);
  } catch (err) {
    console.error(`Flow call failed for ${parcel.apn}: ${err}`);
  }
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
