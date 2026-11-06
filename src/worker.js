// Tahoe Cedars permit packet email Worker
//
// Route
//   POST /api/send  { streetNumber, streetName, email, website }
//     -> { sent: true, address }            packet emailed
//     -> { found: false }                   address not in the project list
//     -> { found: false, ambiguous: true }  more than one match
//     -> { error: "..." }                   bad email, too many requests, or flow failure
// Everything else is served from /public.
//
// The Worker matches the address, then hands the request to a Power Automate
// flow (FLOW_URL secret). The flow emails the packet and map from
// tahoecedars@tcpud.org, then updates the tracking sheet.

import parcels from "./parcels.json";
import { normalizeNumber, normalizeStreet } from "./normalize.js";

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[A-Za-z]{2,}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/send" && request.method === "POST") {
      return send(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

function findParcel(streetNumber, streetName) {
  const number = normalizeNumber(streetNumber);
  const street = normalizeStreet(streetName);
  if (!number || !street.full) return { hits: [] };
  const sameNumber = parcels.filter((p) => p.number === number);
  // Exact street match first ("9th Ave"), then without suffix ("9th").
  let hits = sameNumber.filter((p) => p.street === street.full);
  if (!hits.length) hits = sameNumber.filter((p) => p.streetBase === street.base);
  return { hits };
}

async function send(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  // Hidden form field that people never fill in. Bots usually do.
  if (body.website) return json({ sent: true, address: "" });

  const email = String(body.email || "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: "bad_email" }, 400);
  }

  // Limit repeat requests per visitor and per email address.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await allowed(env, "ip:" + ip)) || !(await allowed(env, "email:" + email.toLowerCase()))) {
    return json({ error: "too_many" }, 429);
  }

  const { hits } = findParcel(body.streetNumber, body.streetName);
  if (hits.length > 1) return json({ found: false, ambiguous: true });
  if (hits.length === 0) return json({ found: false });
  const parcel = hits[0];

  if (!(await allowed(env, "apn:" + parcel.apn))) {
    return json({ error: "too_many" }, 429);
  }

  const payload = {
    apn: parcel.apn,
    address: parcel.address,
    email,
    mapFileName: parcel.mapFile,
    mapAttachmentName: customerFilename(parcel.mapFile),
    appVersion: env.APP_VERSION || "",
    requestedAt: new Date().toISOString(),
  };

  if (!env.FLOW_URL) {
    console.error("FLOW_URL secret is not set");
    return json({ error: "unavailable" }, 503);
  }

  let res;
  try {
    res = await fetch(env.FLOW_URL.trim().replace(/^["']|["']$/g, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`Flow call failed for ${parcel.apn}: ${err}`);
    return json({ error: "unavailable" }, 503);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    console.error(`Flow returned ${res.status} for ${parcel.apn}: ${detail}`);
    return json({ error: "unavailable" }, 503);
  }

  return json({ sent: true, address: parcel.address });
}

// Uses the Workers rate limiting binding if configured (wrangler.jsonc).
async function allowed(env, key) {
  if (!env.RATE_LIMITER) return true;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return success;
  } catch {
    return true;
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
