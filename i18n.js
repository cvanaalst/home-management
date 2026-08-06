/**
 * i18n.js — NL/EN dictionaries, t(), applyTranslations() (BLUEPRINT §11).
 *
 * Rules that are not negotiable:
 *   • EVERY user-visible string lives here. Toasts, errors, empty states, log
 *     labels, aria-labels — no exceptions.
 *   • Dynamic strings call t() at render time. Never cache a translated string
 *     in a module-level constant; the language can change without a reload.
 *   • Static markup carries data-i18n / data-i18n-placeholder / data-i18n-aria /
 *     data-i18n-title and is walked by applyTranslations().
 *
 * tests.html asserts the two dictionaries hold exactly the same keys, so a
 * string added to one language and forgotten in the other fails the suite.
 *
 * NL is the default language.
 */

import { state } from "./state.js";

const dict = {
  nl: {
    // ── app shell ───────────────────────────────────────────────────────────
    "app.name": "Huisbeheer",
    "app.tagline": "Alles over je huis, offline bij de hand",

    // ── tabs & navigation ───────────────────────────────────────────────────
    "nav.timeline": "Tijdlijn",
    "view.timeline.title": "Tijdlijn",

    // ── the timeline (§4) ───────────────────────────────────────────────────
    "timeline.count": "{count} van {total}",
    "timeline.total": "{amount} uitgegeven",
    "timeline.undated": "Zonder datum",
    "timeline.untitled": "Naamloze gebeurtenis",
    "timeline.newestFirst": "Nieuwste eerst",
    "timeline.oldestFirst": "Oudste eerst",
    "timeline.empty.title": "Nog niets gebeurd",
    "timeline.empty.body":
      "Leg vast wat er in huis gebeurt: onderhoud, storingen, betalingen en wijzigingen. Open een item en kies \u201eGebeurtenis vastleggen\u201d.",
    "timeline.empty.filtered.title": "Niets gevonden",
    "timeline.empty.filtered.body": "Geen gebeurtenis voldoet aan deze filters.",

    // ── the event form (§5) ─────────────────────────────────────────────────
    "event.section": "Wat er gebeurde",
    "event.occurredAt": "Datum",
    "event.amount": "Bedrag",
    "event.amount.placeholder": "bv. 89,50",
    "event.hint":
      "De datum is wanneer het gebeurde, niet wanneer je het opschreef. Het bedrag is optioneel en telt mee in de totalen.",

    // ── a record's own history (§5) ─────────────────────────────────────────
    "history.section": "Geschiedenis",
    "history.add": "Gebeurtenis vastleggen",
    "history.empty": "Nog niets vastgelegd voor dit item.",
    "history.count": "{count} gebeurtenissen",
    "history.total": "{amount} in totaal",
    "nav.list": "Overzicht",
    "nav.settings": "Instellingen",
    "nav.back": "Terug",
    "nav.close": "Sluiten",

    // ── views ───────────────────────────────────────────────────────────────
    "view.list.title": "Overzicht",
    "view.detail.title": "Details",
    "view.add.title": "Nieuw item",
    "view.settings.title": "Instellingen",
    "view.report.title": "Inzichten",
    "view.trash.title": "Onlangs verwijderd",
    "view.synclog.title": "Synclogboek",
    "view.help.title": "Help",

    // ── record types ────────────────────────────────────────────────────────
    "type.document": "Document",
    "type.configuration": "Configuratie",
    "type.account": "Account",
    "type.utilities": "Nutsvoorzieningen",
    "type.devices": "Apparaten",
    "type.calendar": "Kalender",
    "type.various": "Diversen",
    "type.all": "Alles",
    "type.label": "Soort",

    // ── the event axis (§5) ─────────────────────────────────────────────────
    "kind.record": "Gegeven",
    "kind.event": "Gebeurtenis",
    "eventType.maintenance": "Onderhoud",
    "eventType.payment": "Betaling",
    "eventType.incident": "Storing",
    "eventType.change": "Wijziging",
    "eventType.reading": "Meterstand",
    "eventType.other": "Overig",
    "eventType.all": "Alles",
    "eventType.label": "Wat gebeurde er",

    // ── list view ───────────────────────────────────────────────────────────
    "list.search": "Zoeken…",
    "list.search.aria": "Zoek in alle items",
    "list.filter": "Filters",
    "list.filter.aria": "Filters en sortering tonen of verbergen",
    "list.sort": "Sorteren",
    "list.new": "Nieuw item",
    "list.loadMore": "Meer laden",
    "list.count": "{count} van {total}",
    "list.empty.title": "Nog niets opgeslagen",
    "list.empty.body": "Voeg je eerste item toe met de knop hieronder.",
    "list.empty.locked": "Ontgrendel de app om items toe te voegen.",
    "list.empty.filtered.title": "Geen resultaten",
    "list.empty.filtered.body": "Pas je zoekterm of filters aan.",
    "list.clearFilters": "Filters wissen",
    "list.filterByTag": "Labels",
    "list.dateFrom": "Van",
    "list.dateTo": "Tot",
    "list.noTags": "Nog geen labels gebruikt",
    "list.types.showAll": "Alle soorten tonen",
    "list.types.showLess": "Minder soorten tonen",
    "list.refreshed": "Overzicht bijgewerkt",

    // ── sorting ─────────────────────────────────────────────────────────────
    "sort.updatedAt": "Laatst gewijzigd",
    "sort.createdAt": "Aangemaakt",
    "sort.title": "Titel",
    "sort.reminderAt": "Herinnering",
    "sort.desc": "Aflopend",
    "sort.asc": "Oplopend",
    "sort.direction.aria": "Sorteerrichting omkeren",

    // ── record fields ───────────────────────────────────────────────────────
    "field.title": "Titel",
    "field.title.placeholder": "Waar gaat dit over?",
    "field.body": "Inhoud",
    "field.body.placeholder": "Schrijf hier. Markdown mag: **vet**, # kop, - lijst.",
    "field.comment": "Notitie bij dit item",
    "field.comment.placeholder": "Korte aantekening",
    "field.tags": "Labels",
    "field.tags.placeholder": "Label toevoegen…",
    "field.tags.add": "Toevoegen",
    "field.tags.remove": "Label {tag} verwijderen",
    "field.reminder": "Herinnering",
    "field.reminder.date": "Datum",
    "field.reminder.clear": "Herinnering wissen",
    "field.reminderType": "Soort herinnering",
    "field.reminderType.placeholder": "bv. jaarlijks onderhoud",
    "field.reminderType.hint": "Eén soort per item. Kies een eerdere waarde of typ een nieuwe.",
    "field.links": "Links",
    "field.links.label": "Omschrijving",
    "field.links.url": "Adres (URL)",
    "field.links.add": "Link toevoegen",
    "field.links.remove": "Link verwijderen",
    "field.links.open": "Openen in een nieuw tabblad",
    "field.attachments": "Bestanden",
    "field.attachments.add": "Bestand toevoegen",
    "field.attachments.remove": "Bestand verwijderen",
    "field.attachments.open": "Bestand openen",
    "field.attachments.download": "Bestand downloaden",
    "field.attachments.view": "Bestand bekijken",
    "field.linked": "Gekoppelde items",
    "field.linked.add": "Item koppelen",
    "field.linked.remove": "Koppeling verwijderen",
    "field.backlinks": "Verwijst naar dit item",
    "field.pinned": "Vastgezet",
    "field.pin": "Vastzetten",
    "field.unpin": "Losmaken",
    "field.created": "Aangemaakt",
    "field.updated": "Gewijzigd",

    // ── markdown preview ────────────────────────────────────────────────────
    "editor.write": "Schrijven",
    "editor.preview": "Voorbeeld",
    "editor.empty": "Nog niets geschreven.",

    // ── add view ────────────────────────────────────────────────────────────
    "add.chooseType": "Wat wil je opslaan?",
    "add.chooseType.hint": "De soort bepaalt het icoon en waar het item terugkomt in filters en inzichten.",

    // ── detail view ─────────────────────────────────────────────────────────
    "detail.notFound": "Dit item bestaat niet meer.",
    "detail.noBody": "Geen inhoud.",
    "detail.noTags": "Geen labels.",
    "detail.noLinked": "Geen gekoppelde items.",
    "detail.noLinks": "Geen links.",
    "detail.noAttachments": "Geen bestanden.",
    "detail.newRecord": "Nieuw item",
    "detail.unsaved": "Niet opgeslagen wijzigingen",

    // ── reminders ───────────────────────────────────────────────────────────
    "reminder.overdue": "{days} dagen te laat",
    "reminder.overdue.one": "1 dag te laat",
    "reminder.today": "Vandaag",
    "reminder.days": "Over {days} dagen",
    "reminder.days.one": "Over 1 dag",

    // ── record picker ───────────────────────────────────────────────────────
    "picker.title": "Item kiezen",
    "picker.search": "Zoek een item…",
    "picker.empty": "Geen items gevonden.",

    // ── file viewer ─────────────────────────────────────────────────────────
    "viewer.download": "Downloaden",
    "viewer.cannotPreview":
      "Dit bestandstype kan hier niet getoond worden. Download het om het te openen.",
    "viewer.pdfHint": "Zie je niets? Download het bestand om het te openen.",

    // ── settings view ───────────────────────────────────────────────────────
    "settings.appearance": "Weergave",
    "settings.theme": "Thema",
    "settings.theme.dark": "Donker",
    "settings.theme.light": "Licht",
    "settings.theme.midnight": "Middernacht",
    "settings.theme.paper": "Papier",
    "settings.density": "Dichtheid",
    "settings.density.comfortable": "Ruim",
    "settings.density.compact": "Compact",
    "settings.language": "Taal",
    "settings.language.nl": "Nederlands",
    "settings.language.en": "Engels",
    "settings.locked": "Alleen-lezen",
    "settings.locked.hint":
      "Vergrendel de app zodat codes en contractnummers niet per ongeluk gewijzigd worden.",
    "settings.data": "Gegevens",
    "settings.storage": "Opslag",
    "settings.export": "Exporteren",
    "settings.report": "Inzichten",
    "settings.trash": "Onlangs verwijderd",
    "settings.synclog": "Synclogboek",
    "settings.print": "Afdrukken",
    "settings.about": "Over",
    "settings.help": "Help",

    // ── storage (§8.13) ─────────────────────────────────────────────────────
    "storage.used": "{used} van {quota} in gebruik",
    "storage.unavailable": "Deze browser geeft geen opslaggegevens door.",
    "storage.persistent": "Beschermde opslag",
    "storage.persistent.on": "Actief",
    "storage.persistent.off": "Niet actief",
    "storage.persistent.hint":
      "Met beschermde opslag ruimt de browser je gegevens niet vanzelf op als er ruimte nodig is.",
    "storage.records": "{count} items",
    "storage.files": "{count} bestanden",
    "storage.refresh": "Vernieuwen",

    // ── export (§8.6) ───────────────────────────────────────────────────────
    "export.json": "JSON exporteren",
    "export.csv": "CSV exporteren",
    "export.json.hint":
      "Volledige kopie, inclusief verwijderde items. Dit is het echte back-upbestand.",
    "export.csv.hint":
      "Platte tabel voor Excel, met puntkomma's. Geen back-up: bestanden en verwijderde items ontbreken.",
    "export.done": "{name} gedownload",
    "export.empty": "Er is nog niets om te exporteren.",

    // ── print (§8.7) ────────────────────────────────────────────────────────
    "print.overview": "Overzicht afdrukken",
    "print.record": "Dit item afdrukken",
    "print.includeBody": "Volledige inhoud meenemen",
    "print.hint":
      "Opent het afdrukvenster van je browser. Kies daar \u201cOpslaan als pdf\u201d om er een bestand van te maken.",
    "print.generated": "Gemaakt op",
    "print.count": "{count} items",
    "print.summary": "Samenvatting",
    "print.noRecords": "Geen items om af te drukken.",
    "print.col.title": "Titel",
    "print.col.type": "Soort",
    "print.col.tags": "Labels",
    "print.col.reminder": "Herinnering",
    "print.col.updated": "Gewijzigd",
    "print.overdue": "{days} dagen te laat",
    "print.overdue.one": "1 dag te laat",

    // ── insights (§8.8) ─────────────────────────────────────────────────────
    "report.total": "Items",
    "report.pinned": "Vastgezet",
    "report.due": "Aandacht nodig",
    "report.overdue": "Te laat",
    "report.dueToday": "Vandaag",
    "report.dueWeek": "Komende 7 dagen",
    "report.tagsCount": "Labels",
    "report.links": "Links",
    "report.attachments": "Bestanden",
    "report.byType": "Per soort",
    "report.perWeek": "Nieuwe items per week",
    "report.weeksHint": "Laatste 12 weken",
    "report.tagCloud": "Labels",
    "report.empty": "Nog niets opgeslagen, dus nog niets te tonen.",
    "report.week": "Week van {date}: {count}",

    // ── CSV column headers ──────────────────────────────────────────────────
    "csv.type": "Soort",
    "csv.title": "Titel",
    "csv.tags": "Labels",
    "csv.reminderAt": "Herinnering",
    "csv.kind": "Soort regel",
    "csv.occurredAt": "Gebeurd op",
    "csv.eventType": "Soort gebeurtenis",
    "csv.amount": "Bedrag",
    "csv.reminderType": "Soort herinnering",
    "csv.pinned": "Vastgezet",
    "csv.comment": "Notitie",
    "csv.links": "Links",
    "csv.attachments": "Bestanden",
    "csv.body": "Inhoud",
    "csv.createdAt": "Aangemaakt",
    "csv.updatedAt": "Gewijzigd",
    "csv.id": "Id",

    // ── sync (§7, §8.1–8.4) ─────────────────────────────────────────────────
    "install.title": "Installeren",
    "install.hint":
      "Zet Huisbeheer op je beginscherm: dan opent hij als een gewone app, zonder adresbalk, en werkt hij ook zonder internet.",
    "install.hint.ios":
      "Tik onderaan op Deel en kies \u201cZet op beginscherm\u201d. Daarna opent Huisbeheer als een gewone app, ook zonder internet.",
    "install.action": "Installeren",
    "install.dismiss": "Niet meer tonen",
    "install.done": "Huisbeheer is ge\u00efnstalleerd",

    "settings.sync": "Synchronisatie",
    "sync.intro":
      "Synchroniseer je items via je eigen Google Drive. De app krijgt alleen toegang tot de map die ze zelf aanmaakt — de rest van je Drive blijft onzichtbaar.",
    "sync.status": "Status",
    "sync.status.off": "Niet ingesteld",
    "sync.status.signedOut": "Afgemeld",
    "sync.status.ready": "Aangemeld",
    "sync.status.syncing": "Bezig…",
    "sync.never": "Nog nooit gesynchroniseerd",
    "sync.lastAt": "Laatst gesynchroniseerd: {when}",
    "sync.clientId": "OAuth client ID",
    "sync.clientId.placeholder": "123456789-abc.apps.googleusercontent.com",
    "sync.clientId.hint":
      "Maak er één aan in Google Cloud Console. Dit is geen geheim en mag hier gewoon staan. Zie de handleiding in BLUEPRINT.md.",
    "sync.clientId.origin": "Authorized JavaScript origin (zonder pad): {origin}",
    "sync.clientId.redirect": "Authorized redirect URI (mét slash op het einde): {uri}",
    "sync.clientId.save": "Opslaan",
    "sync.clientId.saved": "Client ID opgeslagen",
    "sync.auto": "Automatisch synchroniseren bij het openen",
    "sync.now": "Nu synchroniseren",
    "sync.backup": "Back-up maken",
    "sync.restore": "Terugzetten…",
    "sync.signOut": "Afmelden",
    "sync.signedOut": "Afgemeld",
    "sync.notConfigured": "Vul eerst een OAuth client ID in.",
    "sync.offline": "Geen verbinding — synchroniseren overgeslagen.",
    "sync.done": "Gesynchroniseerd: {detail}",
    "sync.failed": "Synchroniseren mislukt: {detail}",
    "sync.backupDone": "Back-up gemaakt: {name}",
    "sync.import": "Importeren uit bestand",
    "sync.import.hint":
      "Lees een JSON-export terug. “Samenvoegen” houdt beide kanten aan; “Vervangen” gooit alles hier weg.",
    "sync.import.choose": "Bestand kiezen…",
    "sync.import.done": "{count} items geïmporteerd",
    "sync.import.failed": "Dit bestand kon niet gelezen worden.",

    // ── restore dialog (§8.3) ───────────────────────────────────────────────
    "restore.title": "Back-up terugzetten",
    "restore.empty": "Er staan nog geen back-ups in Drive.",
    "restore.merge": "Samenvoegen",
    "restore.replace": "Vervangen",
    "restore.merge.hint": "Voegt de back-up samen met wat er nu is. Verwijderde items blijven verwijderd.",
    "restore.replace.hint":
      "Vervangt alles op dit apparaat door de back-up en zet die meteen terug naar Drive.",
    "restore.replace.confirm":
      "Alles op dit apparaat wordt vervangen door deze back-up, en die wordt meteen naar Drive geschreven. Doorgaan?",
    "restore.done": "Teruggezet ({count} items)",
    "restore.failed": "Terugzetten mislukt.",

    // ── trash (§8.5) ────────────────────────────────────────────────────────
    "trash.hint":
      "Verwijderde items blijven hier bewaard zodat de verwijdering ook op je andere apparaten aankomt.",
    "trash.empty.title": "Niets verwijderd",
    "trash.empty.body": "Wat je verwijdert, komt hier terecht.",
    "trash.deletedAt": "Verwijderd op {when}",
    "trash.restore": "Terugzetten",
    "trash.restored": "„{title}” teruggezet",
    "trash.purge": "Definitief wissen",
    "trash.purge.ok": "Definitief wissen",
    "trash.purge.confirm":
      "„{title}” wordt definitief gewist. De inhoud en de bestanden zijn dan echt weg — dit kan niet ongedaan gemaakt worden.",
    "trash.purged": "Definitief gewist",

    // ── sync log (§8.4) ─────────────────────────────────────────────────────
    "synclog.hint":
      "Het logboek van deze app. Ook overgeslagen synchronisaties staan erin — dat is normaal: een aanmelding vervalt na ongeveer een uur.",
    "synclog.empty.title": "Nog niets gesynchroniseerd",
    "synclog.empty.body": "Zodra je synchroniseert of een back-up maakt, staat het hier.",
    "synclog.clear": "Logboek wissen",
    "synclog.clear.confirm": "Het volledige logboek wissen?",
    "synclog.cleared": "Logboek gewist",
    "synclog.kind.sync": "Synchronisatie",
    "synclog.kind.autosync": "Automatisch",
    "synclog.kind.backup": "Back-up",
    "synclog.kind.restore": "Terugzetten",
    "synclog.outcome.success": "Gelukt",
    "synclog.outcome.error": "Mislukt",
    "synclog.outcome.skipped": "Overgeslagen",

    // ── read-only lock ──────────────────────────────────────────────────────
    "lock.locked": "Vergrendeld",
    "lock.unlocked": "Bewerken",
    "lock.toLock": "Klik om te vergrendelen",
    "lock.toUnlock": "Klik om te bewerken",
    "lock.blocked": "De app staat op alleen-lezen. Ontgrendel om te bewerken.",

    // ── generic actions ─────────────────────────────────────────────────────
    "action.save": "Opslaan",
    "action.cancel": "Annuleren",
    "action.delete": "Verwijderen",
    "action.undo": "Ongedaan maken",
    "action.ok": "OK",
    "action.confirm": "Bevestigen",
    "action.retry": "Opnieuw",
    "action.more": "Meer acties",
    "action.done": "Klaar",
    "action.print": "Afdrukken",

    // ── status ──────────────────────────────────────────────────────────────
    "status.offline": "Geen verbinding",
    "status.loading": "Laden…",
    "status.soon": "Komt in een volgende fase",
    "update.available": "Nieuwe versie beschikbaar",
    "update.reload": "Herladen",

    // ── toasts ──────────────────────────────────────────────────────────────
    "toast.saved": "Opgeslagen",
    "toast.created": "Item toegevoegd",
    "toast.deleted": "„{title}” verwijderd",
    "toast.pinned": "Vastgezet",
    "toast.unpinned": "Losgemaakt",
    "toast.linkAdded": "Link toegevoegd",
    "toast.linkRemoved": "Link verwijderd",
    "toast.attachmentAdded": "Bestand toegevoegd",
    "toast.attachmentRemoved": "Bestand verwijderd",
    "toast.discarded": "Wijzigingen verworpen",

    // ── confirmations ───────────────────────────────────────────────────────
    "confirm.discard": "Je hebt wijzigingen die nog niet zijn opgeslagen. Weggooien?",
    "confirm.discard.ok": "Weggooien",

    // ── errors ──────────────────────────────────────────────────────────────
    "error.storage":
      "De opslag van deze browser is niet beschikbaar. Wijzigingen worden niet bewaard.",
    "error.titleRequired": "Geef het item eerst een titel.",
    "error.linkIncomplete": "Vul zowel een omschrijving als een adres in.",
    "error.linkInvalid": "Dit adres begrijp ik niet. Begin met https://",
    "error.fileTooBig": "Dit bestand is groter dan {limit} en wordt niet opgeslagen.",
    "error.fileFailed": "Het bestand kon niet gelezen worden.",
    "error.fileMissing": "Bestand ontbreekt",
    "error.saveFailed": "Opslaan is mislukt.",

    // ── about ───────────────────────────────────────────────────────────────
    "about.version": "Versie",
    "about.privacy":
      "Al je gegevens staan op dit apparaat. Er worden geen statistieken verzameld en er is geen server.",
  },

  en: {
    // ── app shell ───────────────────────────────────────────────────────────
    "app.name": "Home Management",
    "app.tagline": "Everything about your home, offline and to hand",

    // ── tabs & navigation ───────────────────────────────────────────────────
    "nav.timeline": "Timeline",
    "view.timeline.title": "Timeline",

    // ── the timeline (§4) ───────────────────────────────────────────────────
    "timeline.count": "{count} of {total}",
    "timeline.total": "{amount} spent",
    "timeline.undated": "Undated",
    "timeline.untitled": "Untitled event",
    "timeline.newestFirst": "Newest first",
    "timeline.oldestFirst": "Oldest first",
    "timeline.empty.title": "Nothing has happened yet",
    "timeline.empty.body":
      "Record what happens around the house: maintenance, incidents, payments and changes. Open a record and choose \u201cLog an event\u201d.",
    "timeline.empty.filtered.title": "Nothing found",
    "timeline.empty.filtered.body": "No event matches these filters.",

    // ── the event form (§5) ─────────────────────────────────────────────────
    "event.section": "What happened",
    "event.occurredAt": "Date",
    "event.amount": "Amount",
    "event.amount.placeholder": "e.g. 89.50",
    "event.hint":
      "The date is when it happened, not when you wrote it down. The amount is optional and counts towards the totals.",

    // ── a record's own history (§5) ─────────────────────────────────────────
    "history.section": "History",
    "history.add": "Log an event",
    "history.empty": "Nothing recorded for this item yet.",
    "history.count": "{count} events",
    "history.total": "{amount} in total",
    "nav.list": "Overview",
    "nav.settings": "Settings",
    "nav.back": "Back",
    "nav.close": "Close",

    // ── views ───────────────────────────────────────────────────────────────
    "view.list.title": "Overview",
    "view.detail.title": "Details",
    "view.add.title": "New item",
    "view.settings.title": "Settings",
    "view.report.title": "Insights",
    "view.trash.title": "Recently deleted",
    "view.synclog.title": "Sync log",
    "view.help.title": "Help",

    // ── record types ────────────────────────────────────────────────────────
    "type.document": "Document",
    "type.configuration": "Configuration",
    "type.account": "Account",
    "type.utilities": "Utilities",
    "type.devices": "Devices",
    "type.calendar": "Calendar",
    "type.various": "Various",
    "type.all": "All",
    "type.label": "Type",

    // ── the event axis (§5) ─────────────────────────────────────────────────
    "kind.record": "Record",
    "kind.event": "Event",
    "eventType.maintenance": "Maintenance",
    "eventType.payment": "Payment",
    "eventType.incident": "Incident",
    "eventType.change": "Change",
    "eventType.reading": "Reading",
    "eventType.other": "Other",
    "eventType.all": "All",
    "eventType.label": "What happened",

    // ── list view ───────────────────────────────────────────────────────────
    "list.search": "Search…",
    "list.search.aria": "Search all items",
    "list.filter": "Filters",
    "list.filter.aria": "Show or hide filters and sorting",
    "list.sort": "Sort",
    "list.new": "New item",
    "list.loadMore": "Load more",
    "list.count": "{count} of {total}",
    "list.empty.title": "Nothing saved yet",
    "list.empty.body": "Add your first item with the button below.",
    "list.empty.locked": "Unlock the app to add items.",
    "list.empty.filtered.title": "No results",
    "list.empty.filtered.body": "Adjust your search term or filters.",
    "list.clearFilters": "Clear filters",
    "list.filterByTag": "Tags",
    "list.dateFrom": "From",
    "list.dateTo": "To",
    "list.noTags": "No tags used yet",
    "list.types.showAll": "Show all types",
    "list.types.showLess": "Show fewer types",
    "list.refreshed": "Overview refreshed",

    // ── sorting ─────────────────────────────────────────────────────────────
    "sort.updatedAt": "Last changed",
    "sort.createdAt": "Created",
    "sort.title": "Title",
    "sort.reminderAt": "Reminder",
    "sort.desc": "Descending",
    "sort.asc": "Ascending",
    "sort.direction.aria": "Reverse the sort direction",

    // ── record fields ───────────────────────────────────────────────────────
    "field.title": "Title",
    "field.title.placeholder": "What is this about?",
    "field.body": "Content",
    "field.body.placeholder": "Write here. Markdown works: **bold**, # heading, - list.",
    "field.comment": "Note about this item",
    "field.comment.placeholder": "Short remark",
    "field.tags": "Tags",
    "field.tags.placeholder": "Add a tag…",
    "field.tags.add": "Add",
    "field.tags.remove": "Remove tag {tag}",
    "field.reminder": "Reminder",
    "field.reminder.date": "Date",
    "field.reminder.clear": "Clear the reminder",
    "field.reminderType": "Reminder type",
    "field.reminderType.placeholder": "e.g. yearly service",
    "field.reminderType.hint": "One type per item. Pick a previous value or type a new one.",
    "field.links": "Links",
    "field.links.label": "Description",
    "field.links.url": "Address (URL)",
    "field.links.add": "Add link",
    "field.links.remove": "Remove link",
    "field.links.open": "Open in a new tab",
    "field.attachments": "Files",
    "field.attachments.add": "Add a file",
    "field.attachments.remove": "Remove file",
    "field.attachments.open": "Open file",
    "field.attachments.download": "Download file",
    "field.attachments.view": "View file",
    "field.linked": "Linked items",
    "field.linked.add": "Link an item",
    "field.linked.remove": "Remove the link",
    "field.backlinks": "Points at this item",
    "field.pinned": "Pinned",
    "field.pin": "Pin",
    "field.unpin": "Unpin",
    "field.created": "Created",
    "field.updated": "Changed",

    // ── markdown preview ────────────────────────────────────────────────────
    "editor.write": "Write",
    "editor.preview": "Preview",
    "editor.empty": "Nothing written yet.",

    // ── add view ────────────────────────────────────────────────────────────
    "add.chooseType": "What do you want to save?",
    "add.chooseType.hint": "The type sets the icon and where the item shows up in filters and insights.",

    // ── detail view ─────────────────────────────────────────────────────────
    "detail.notFound": "This item no longer exists.",
    "detail.noBody": "No content.",
    "detail.noTags": "No tags.",
    "detail.noLinked": "No linked items.",
    "detail.noLinks": "No links.",
    "detail.noAttachments": "No files.",
    "detail.newRecord": "New item",
    "detail.unsaved": "Unsaved changes",

    // ── reminders ───────────────────────────────────────────────────────────
    "reminder.overdue": "{days} days overdue",
    "reminder.overdue.one": "1 day overdue",
    "reminder.today": "Today",
    "reminder.days": "In {days} days",
    "reminder.days.one": "In 1 day",

    // ── record picker ───────────────────────────────────────────────────────
    "picker.title": "Choose an item",
    "picker.search": "Search for an item…",
    "picker.empty": "No items found.",

    // ── file viewer ─────────────────────────────────────────────────────────
    "viewer.download": "Download",
    "viewer.cannotPreview":
      "This file type cannot be shown here. Download it to open it.",
    "viewer.pdfHint": "Nothing shown? Download the file to open it.",

    // ── settings view ───────────────────────────────────────────────────────
    "settings.appearance": "Appearance",
    "settings.theme": "Theme",
    "settings.theme.dark": "Dark",
    "settings.theme.light": "Light",
    "settings.theme.midnight": "Midnight",
    "settings.theme.paper": "Paper",
    "settings.density": "Density",
    "settings.density.comfortable": "Comfortable",
    "settings.density.compact": "Compact",
    "settings.language": "Language",
    "settings.language.nl": "Dutch",
    "settings.language.en": "English",
    "settings.locked": "Read-only",
    "settings.locked.hint":
      "Lock the app so codes and contract numbers cannot be changed by accident.",
    "settings.data": "Data",
    "settings.storage": "Storage",
    "settings.export": "Export",
    "settings.report": "Insights",
    "settings.trash": "Recently deleted",
    "settings.synclog": "Sync log",
    "settings.print": "Print",
    "settings.about": "About",
    "settings.help": "Help",

    // ── storage (§8.13) ─────────────────────────────────────────────────────
    "storage.used": "{used} of {quota} in use",
    "storage.unavailable": "This browser does not report storage figures.",
    "storage.persistent": "Protected storage",
    "storage.persistent.on": "Active",
    "storage.persistent.off": "Not active",
    "storage.persistent.hint":
      "With protected storage the browser will not clear your data by itself when it needs room.",
    "storage.records": "{count} items",
    "storage.files": "{count} files",
    "storage.refresh": "Refresh",

    // ── export (§8.6) ───────────────────────────────────────────────────────
    "export.json": "Export JSON",
    "export.csv": "Export CSV",
    "export.json.hint":
      "A complete copy, including deleted items. This is the real backup file.",
    "export.csv.hint":
      "A flat table for Excel, semicolon separated. Not a backup: files and deleted items are missing.",
    "export.done": "{name} downloaded",
    "export.empty": "There is nothing to export yet.",

    // ── print (§8.7) ────────────────────────────────────────────────────────
    "print.overview": "Print overview",
    "print.record": "Print this item",
    "print.includeBody": "Include full content",
    "print.hint":
      "Opens your browser's print dialog. Choose \u201cSave as PDF\u201d there to make it a file.",
    "print.generated": "Generated",
    "print.count": "{count} items",
    "print.summary": "Summary",
    "print.noRecords": "No items to print.",
    "print.col.title": "Title",
    "print.col.type": "Type",
    "print.col.tags": "Tags",
    "print.col.reminder": "Reminder",
    "print.col.updated": "Changed",
    "print.overdue": "{days} days overdue",
    "print.overdue.one": "1 day overdue",

    // ── insights (§8.8) ─────────────────────────────────────────────────────
    "report.total": "Items",
    "report.pinned": "Pinned",
    "report.due": "Needs attention",
    "report.overdue": "Overdue",
    "report.dueToday": "Today",
    "report.dueWeek": "Next 7 days",
    "report.tagsCount": "Tags",
    "report.links": "Links",
    "report.attachments": "Files",
    "report.byType": "By type",
    "report.perWeek": "New items per week",
    "report.weeksHint": "Last 12 weeks",
    "report.tagCloud": "Tags",
    "report.empty": "Nothing saved yet, so nothing to show.",
    "report.week": "Week of {date}: {count}",

    // ── CSV column headers ──────────────────────────────────────────────────
    "csv.type": "Type",
    "csv.title": "Title",
    "csv.tags": "Tags",
    "csv.reminderAt": "Reminder",
    "csv.kind": "Row kind",
    "csv.occurredAt": "Occurred on",
    "csv.eventType": "Event type",
    "csv.amount": "Amount",
    "csv.reminderType": "Reminder type",
    "csv.pinned": "Pinned",
    "csv.comment": "Note",
    "csv.links": "Links",
    "csv.attachments": "Files",
    "csv.body": "Content",
    "csv.createdAt": "Created",
    "csv.updatedAt": "Changed",
    "csv.id": "Id",

    // ── sync (§7, §8.1–8.4) ─────────────────────────────────────────────────
    "install.title": "Install",
    "install.hint":
      "Put Home Management on your home screen: it then opens like an ordinary app, without an address bar, and works without a connection.",
    "install.hint.ios":
      "Tap Share at the bottom and choose \u201cAdd to Home Screen\u201d. Home Management then opens like an ordinary app, connection or not.",
    "install.action": "Install",
    "install.dismiss": "Don't show again",
    "install.done": "Home Management is installed",

    "settings.sync": "Sync",
    "sync.intro":
      "Sync your items through your own Google Drive. The app is only ever given access to the folder it creates itself — the rest of your Drive stays invisible to it.",
    "sync.status": "Status",
    "sync.status.off": "Not set up",
    "sync.status.signedOut": "Signed out",
    "sync.status.ready": "Signed in",
    "sync.status.syncing": "Working…",
    "sync.never": "Never synced",
    "sync.lastAt": "Last synced: {when}",
    "sync.clientId": "OAuth client ID",
    "sync.clientId.placeholder": "123456789-abc.apps.googleusercontent.com",
    "sync.clientId.hint":
      "Create one in the Google Cloud Console. It is not a secret and is safe to keep here. See the guide in BLUEPRINT.md.",
    "sync.clientId.origin": "Authorized JavaScript origin (no path): {origin}",
    "sync.clientId.redirect": "Authorized redirect URI (with the trailing slash): {uri}",
    "sync.clientId.save": "Save",
    "sync.clientId.saved": "Client ID saved",
    "sync.auto": "Sync automatically when the app opens",
    "sync.now": "Sync now",
    "sync.backup": "Back up",
    "sync.restore": "Restore…",
    "sync.signOut": "Sign out",
    "sync.signedOut": "Signed out",
    "sync.notConfigured": "Enter an OAuth client ID first.",
    "sync.offline": "No connection — sync skipped.",
    "sync.done": "Synced: {detail}",
    "sync.failed": "Sync failed: {detail}",
    "sync.backupDone": "Backup written: {name}",
    "sync.import": "Import from a file",
    "sync.import.hint":
      "Read a JSON export back in. “Merge” keeps both sides; “Replace” throws away everything here.",
    "sync.import.choose": "Choose a file…",
    "sync.import.done": "{count} items imported",
    "sync.import.failed": "This file could not be read.",

    // ── restore dialog (§8.3) ───────────────────────────────────────────────
    "restore.title": "Restore a backup",
    "restore.empty": "There are no backups in Drive yet.",
    "restore.merge": "Merge",
    "restore.replace": "Replace",
    "restore.merge.hint": "Merges the backup with what is here now. Deleted items stay deleted.",
    "restore.replace.hint":
      "Replaces everything on this device with the backup, and writes it straight back to Drive.",
    "restore.replace.confirm":
      "Everything on this device will be replaced by this backup, and the backup will be written to Drive immediately. Continue?",
    "restore.done": "Restored ({count} items)",
    "restore.failed": "Restore failed.",

    // ── trash (§8.5) ────────────────────────────────────────────────────────
    "trash.hint":
      "Deleted items are kept here so the deletion also reaches your other devices.",
    "trash.empty.title": "Nothing deleted",
    "trash.empty.body": "Whatever you delete ends up here.",
    "trash.deletedAt": "Deleted on {when}",
    "trash.restore": "Restore",
    "trash.restored": "“{title}” restored",
    "trash.purge": "Delete forever",
    "trash.purge.ok": "Delete forever",
    "trash.purge.confirm":
      "“{title}” will be deleted forever. Its content and files really are gone after this — it cannot be undone.",
    "trash.purged": "Deleted forever",

    // ── sync log (§8.4) ─────────────────────────────────────────────────────
    "synclog.hint":
      "This app's black box. Skipped syncs are in here too — that is normal: a sign-in lapses after about an hour.",
    "synclog.empty.title": "Nothing synced yet",
    "synclog.empty.body": "As soon as you sync or back up, it shows up here.",
    "synclog.clear": "Clear the log",
    "synclog.clear.confirm": "Clear the whole log?",
    "synclog.cleared": "Log cleared",
    "synclog.kind.sync": "Sync",
    "synclog.kind.autosync": "Automatic",
    "synclog.kind.backup": "Backup",
    "synclog.kind.restore": "Restore",
    "synclog.outcome.success": "Succeeded",
    "synclog.outcome.error": "Failed",
    "synclog.outcome.skipped": "Skipped",

    // ── read-only lock ──────────────────────────────────────────────────────
    "lock.locked": "Locked",
    "lock.unlocked": "Editing",
    "lock.toLock": "Click to lock",
    "lock.toUnlock": "Click to edit",
    "lock.blocked": "The app is read-only. Unlock to make changes.",

    // ── generic actions ─────────────────────────────────────────────────────
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.delete": "Delete",
    "action.undo": "Undo",
    "action.ok": "OK",
    "action.confirm": "Confirm",
    "action.retry": "Retry",
    "action.more": "More actions",
    "action.done": "Done",
    "action.print": "Print",

    // ── status ──────────────────────────────────────────────────────────────
    "status.offline": "No connection",
    "status.loading": "Loading…",
    "status.soon": "Coming in a later phase",
    "update.available": "A new version is available",
    "update.reload": "Reload",

    // ── toasts ──────────────────────────────────────────────────────────────
    "toast.saved": "Saved",
    "toast.created": "Item added",
    "toast.deleted": "“{title}” deleted",
    "toast.pinned": "Pinned",
    "toast.unpinned": "Unpinned",
    "toast.linkAdded": "Link added",
    "toast.linkRemoved": "Link removed",
    "toast.attachmentAdded": "File added",
    "toast.attachmentRemoved": "File removed",
    "toast.discarded": "Changes discarded",

    // ── confirmations ───────────────────────────────────────────────────────
    "confirm.discard": "You have changes that are not saved yet. Discard them?",
    "confirm.discard.ok": "Discard",

    // ── errors ──────────────────────────────────────────────────────────────
    "error.storage":
      "This browser's storage is unavailable. Changes will not be saved.",
    "error.titleRequired": "Give the item a title first.",
    "error.linkIncomplete": "Fill in both a description and an address.",
    "error.linkInvalid": "I don't understand this address. Start with https://",
    "error.fileTooBig": "This file is larger than {limit} and will not be saved.",
    "error.fileFailed": "The file could not be read.",
    "error.fileMissing": "File missing",
    "error.saveFailed": "Saving failed.",

    // ── about ───────────────────────────────────────────────────────────────
    "about.version": "Version",
    "about.privacy":
      "All your data stays on this device. No analytics are collected and there is no server.",
  },
};

/**
 * Translate a key, interpolating {placeholders} from `vars`.
 * An unknown key returns the key itself — loud enough to spot in review,
 * quiet enough not to break the UI.
 */
export function t(key, vars) {
  const table = dict[state.lang] || dict.nl;
  let out = table[key];
  if (out === undefined) out = dict.nl[key];
  if (out === undefined) return key;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
  );
}

/**
 * Pick the singular or plural form of a key. Both languages here have exactly
 * two forms, so a `.one` sibling key is enough — no Intl.PluralRules needed.
 */
export function tCount(key, count) {
  return Math.abs(count) === 1 ? t(`${key}.one`) : t(key, { days: Math.abs(count) });
}

/** Localised label for a record type. */
export function typeLabel(type) {
  return t(`type.${type}`);
}

/** Localised label for an event type (§5). */
export function eventTypeLabel(eventType) {
  return t(`eventType.${eventType}`);
}

/** Localised label for the record/event axis. */
export function kindLabel(kind) {
  return t(`kind.${kind}`);
}

/**
 * Walk `root` and fill in every translatable attribute. Safe to call on every
 * language switch; it is idempotent.
 */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.title = t("app.name");
}

/** Exposed for tests.html — asserts the two dictionaries stay in step. */
export function _dictKeys() {
  return { nl: Object.keys(dict.nl), en: Object.keys(dict.en) };
}
