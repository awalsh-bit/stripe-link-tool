import {
  readLinks as readLinksJson,
  writeLinks as writeLinksJson,
  readTerminalPayments,
  writeTerminalPayments,
  readServiceCards,
  writeServiceCards,
  readArchivedServiceCards,
  readEventCatalog,
  writeEventCatalog,
  readEventRsvps,
  writeEventRsvps
} from "./data-json.js";
import {
  isPostgresLinkStorageEnabled,
  readLinks as readLinksPostgres,
  writeLinks as writeLinksPostgres
} from "./data-postgres.js";

export async function readLinks() {
  if (isPostgresLinkStorageEnabled()) {
    return readLinksPostgres();
  }

  return readLinksJson();
}

export async function writeLinks(data) {
  if (isPostgresLinkStorageEnabled()) {
    return writeLinksPostgres(data);
  }

  return writeLinksJson(data);
}

export {
  readTerminalPayments,
  writeTerminalPayments,
  readServiceCards,
  writeServiceCards,
  readArchivedServiceCards,
  readEventCatalog,
  writeEventCatalog,
  readEventRsvps,
  writeEventRsvps
};
