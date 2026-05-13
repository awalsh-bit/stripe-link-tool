import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const SERVICE_RECENT_WORK_DAYS = 30;
const SERVICE_ARCHIVE_PURGE_DAYS = 90;
const DEFAULT_EVENT_CATALOG = [
  {
    slug: "fire-and-flavor",
    name: "Fire & Flavor",
    subtitle: "Wilson Outdoor Living Showcase",
    publicPath: "fireflavor.html",
    startsAt: "2026-05-15T13:00:00-05:00",
    endsAt: "2026-05-15T17:00:00-05:00",
    location: "Wilson AC & Appliance showroom",
    status: "active",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z"
  }
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureJsonFile(filename, defaultValue = []) {
  ensureDataDir();
  const fullPath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, JSON.stringify(defaultValue, null, 2), "utf8");
  }

  return fullPath;
}

const LINKS_FILE = ensureJsonFile("links.json", []);
const TERMINAL_PAYMENTS_FILE = ensureJsonFile("terminal-payments.json", []);
const SERVICE_CARDS_FILE = ensureJsonFile("service-cards.json", []);
const SERVICE_CARDS_ARCHIVE_FILE = ensureJsonFile("service-cards-archive.json", []);
const EVENTS_FILE = ensureJsonFile("events.json", []);
const EVENT_RSVPS_FILE = ensureJsonFile("event-rsvps.json", []);

async function readJson(filePath, fallback = []) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    console.error(`Error reading JSON from ${filePath}:`, err);
    throw err;
  }
}

async function writeJson(filePath, data) {
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Error writing JSON to ${filePath}:`, err);
    throw err;
  }
}

function normalizeEventRecord(event, nowIso = new Date().toISOString()) {
  return {
    slug: String(event?.slug || "").trim(),
    name: String(event?.name || "").trim() || "Untitled Event",
    subtitle: String(event?.subtitle || "").trim(),
    publicPath: String(event?.publicPath || "").trim(),
    startsAt: String(event?.startsAt || "").trim(),
    endsAt: String(event?.endsAt || "").trim(),
    location: String(event?.location || "").trim(),
    status: String(event?.status || "active").trim().toLowerCase() === "archived" ? "archived" : "active",
    createdAt: String(event?.createdAt || nowIso),
    updatedAt: String(event?.updatedAt || event?.createdAt || nowIso)
  };
}

function getServiceCardAgeInDays(row, now = new Date()) {
  if (!row?.createdAt) {
    return -1;
  }

  const createdDate = new Date(row.createdAt);
  if (Number.isNaN(createdDate.getTime())) {
    return -1;
  }

  const createdDay = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((currentDay.getTime() - createdDay.getTime()) / 86400000);
}

function isArchivableServiceStatus(status) {
  return status === "Call Scheduled" || status === "Call Cancelled";
}

function shouldMoveServiceCardToArchive(row, now = new Date()) {
  if (!isArchivableServiceStatus(row?.queueStatus || "Call Status Pending")) {
    return false;
  }

  const ageDays = getServiceCardAgeInDays(row, now);
  return ageDays >= SERVICE_RECENT_WORK_DAYS + 1;
}

function shouldPurgeArchivedServiceCard(row, now = new Date()) {
  const ageDays = getServiceCardAgeInDays(row, now);
  return ageDays > SERVICE_ARCHIVE_PURGE_DAYS;
}

async function maintainServiceCardStorage() {
  const [activeRows, archiveRows] = await Promise.all([
    readJson(SERVICE_CARDS_FILE, []),
    readJson(SERVICE_CARDS_ARCHIVE_FILE, [])
  ]);

  const now = new Date();
  const keptActiveRows = [];
  const archiveMap = new Map(
    archiveRows
      .filter((row) => !shouldPurgeArchivedServiceCard(row, now))
      .map((row) => [row.id, row])
  );
  let didChange = archiveMap.size !== archiveRows.length;

  for (const row of activeRows) {
    if (shouldMoveServiceCardToArchive(row, now)) {
      archiveMap.set(row.id, row);
      didChange = true;
      continue;
    }

    keptActiveRows.push(row);
  }

  const nextArchiveRows = Array.from(archiveMap.values()).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );

  if (didChange) {
    await Promise.all([
      writeJson(SERVICE_CARDS_FILE, keptActiveRows),
      writeJson(SERVICE_CARDS_ARCHIVE_FILE, nextArchiveRows)
    ]);
  }

  return {
    activeRows: keptActiveRows,
    archiveRows: nextArchiveRows
  };
}

export async function readLinks() {
  return readJson(LINKS_FILE, []);
}

export async function writeLinks(data) {
  return writeJson(LINKS_FILE, data);
}

export async function readTerminalPayments() {
  return readJson(TERMINAL_PAYMENTS_FILE, []);
}

export async function writeTerminalPayments(data) {
  return writeJson(TERMINAL_PAYMENTS_FILE, data);
}

export async function readServiceCards() {
  const { activeRows } = await maintainServiceCardStorage();
  return activeRows;
}

export async function writeServiceCards(data) {
  return writeJson(SERVICE_CARDS_FILE, data);
}

export async function readArchivedServiceCards() {
  const { archiveRows } = await maintainServiceCardStorage();
  return archiveRows;
}

export async function readEventCatalog() {
  const existing = await readJson(EVENTS_FILE, []);
  const nowIso = new Date().toISOString();
  const normalized = existing.map((event) => normalizeEventRecord(event, nowIso)).filter((event) => event.slug);
  let didChange = normalized.length !== existing.length;

  for (const defaultEvent of DEFAULT_EVENT_CATALOG) {
    if (!normalized.find((event) => event.slug === defaultEvent.slug)) {
      normalized.push(normalizeEventRecord(defaultEvent, nowIso));
      didChange = true;
    }
  }

  normalized.sort((a, b) => String(b.startsAt || "").localeCompare(String(a.startsAt || "")));

  if (didChange) {
    await writeJson(EVENTS_FILE, normalized);
  }

  return normalized;
}

export async function writeEventCatalog(data) {
  const normalized = data
    .map((event) => normalizeEventRecord(event))
    .filter((event) => event.slug)
    .sort((a, b) => String(b.startsAt || "").localeCompare(String(a.startsAt || "")));

  return writeJson(EVENTS_FILE, normalized);
}

export async function readEventRsvps() {
  return readJson(EVENT_RSVPS_FILE, []);
}

export async function writeEventRsvps(data) {
  return writeJson(EVENT_RSVPS_FILE, data);
}
