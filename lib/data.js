import {
  readLinks as readLinksJson,
  writeLinks as writeLinksJson,
  upsertLink as upsertLinkJson,
  readTerminalPayments,
  writeTerminalPayments,
  readDepositAgreements,
  writeDepositAgreements,
  readDepositPaymentEvents,
  writeDepositPaymentEvents,
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
  writeLinks as writeLinksPostgres,
  upsertLink as upsertLinkPostgres
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

export async function upsertLink(record) {
  if (isPostgresLinkStorageEnabled()) {
    return upsertLinkPostgres(record);
  }

  return upsertLinkJson(record);
}

export {
  readTerminalPayments,
  writeTerminalPayments,
  readDepositAgreements,
  writeDepositAgreements,
  readDepositPaymentEvents,
  writeDepositPaymentEvents,
  readServiceCards,
  writeServiceCards,
  readArchivedServiceCards,
  readEventCatalog,
  writeEventCatalog,
  readEventRsvps,
  writeEventRsvps
};
