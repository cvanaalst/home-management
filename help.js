/**
 * help.js — long-form help text as Markdown, per language (BLUEPRINT §8.14).
 *
 * Must explain in plain user language: where the data lives, that it never
 * leaves the device, that deletes win in a merge, and every quirk the user will
 * actually hit. If a behaviour is surprising, it belongs here.
 *
 * ── Formatting rule (§13.12) ───────────────────────────────────────────────
 * The renderer is line-based: a single newline inside a paragraph becomes a
 * <br>. Every paragraph and every bullet must stay on ONE source line, however
 * long, or the formatting shatters. That is why the lines below are not wrapped.
 */

const NL = `
# Huisbeheer

Alles over je huis op één plek: notities, documenten, contacten, garanties, verzekeringen, onderhoud en accounts. De app werkt volledig zonder internet.

## Waar staan mijn gegevens?

Alles staat **op dit apparaat**, in de opslag van deze browser. Er is geen server, er worden geen statistieken verzameld en er gaat niets naar het internet. Dat betekent ook: wie deze browser kan openen, kan je gegevens lezen. Zet er dus niets in wat je niet op je telefoon zou willen hebben als je die verliest.

Omdat de gegevens in de browser staan, verdwijnen ze als je de browsergegevens van deze site wist. Maak dus regelmatig een export. De app vraagt bij het opstarten aan de browser om de opslag te beschermen tegen automatisch opruimen; onder **Instellingen ▸ Opslag** zie je of dat gelukt is.

## Soorten

Elk item heeft precies één soort: notitie, document, contact, garantie, verzekering, onderhoud of account. De soort bepaalt het icoon, de kleur, het filter bovenaan het overzicht en waar het item meetelt in de inzichten. Je kiest de soort bij het aanmaken en kunt hem later altijd wijzigen.

## Alleen-lezen

De app start **vergrendeld**. In die stand kun je alles lezen en bestanden openen, maar niets wijzigen. Zo verander je nooit per ongeluk een code of een contractnummer terwijl je iets opzoekt. Klik rechtsboven op *Vergrendeld* om te bewerken, en klik opnieuw om te vergrendelen. De app onthoudt je keuze.

## Opslaan: wat gaat meteen, wat pas op Opslaan?

Dit is het enige stukje van de app dat je echt moet weten:

- **Meteen bewaard**, ook als je daarna teruggaat zonder op Opslaan te drukken: vastzetten, links toevoegen of verwijderen, bestanden toevoegen of verwijderen, en items koppelen.
- **Pas bij Opslaan bewaard**: titel, soort, inhoud, notitie, labels, herinneringsdatum en soort herinnering.

Dus: voeg je een link toe, wijzig je daarna de titel en ga je weg zonder op te slaan, dan blijft de link staan en verdwijnt de titelwijziging. Dat is bewust zo. Bij niet-opgeslagen tekst vraagt de app altijd eerst of je die wilt weggooien.

Een **nieuw item** is de uitzondering: zolang je het nog nooit hebt opgeslagen bestaat het alleen in het geheugen, dus daar worden ook een link of een bestand pas vastgelegd zodra je op Opslaan drukt.

## Herinneringen

Een item kan één herinneringsdatum hebben, en daarbij één **soort herinnering** — bijvoorbeeld *jaarlijkse controle* of *garantie verloopt*. Je typt die soort zelf, of kiest een waarde die je eerder gebruikt hebt. Eén soort per item.

Herinneringen zijn losse datums; ze herhalen zichzelf niet. Als een datum voorbij is, zet je zelf de volgende. In het overzicht zie je meteen wat te laat is, wat vandaag moet en wat eraan komt.

Belangrijk: er is geen server, dus er kan **niets gebeuren terwijl de app dicht is**. Je krijgt geen e-mail en geen melding om 3 uur 's nachts. Je ziet een herinnering wanneer je de app opent.

## Zoeken en filteren

Zoeken kijkt in de titel, de inhoud, de notitie, de labels, de omschrijving én het adres van links, en de namen van bijlagen. Hoofdletters en accenten maken niet uit: *cafe* vindt *Café*. Typ je meerdere woorden, dan moeten ze **allemaal** voorkomen — al mogen ze in verschillende velden staan.

Onder de knop *Filters* vind je sorteren, een datumbereik en de labels. Kies je meerdere labels, dan toont de app alleen items die **alle** gekozen labels hebben.

## Verwijderen en ongedaan maken

Verwijder je een item, dan verdwijnt het meteen uit het overzicht en verschijnt onderaan een balkje met **Ongedaan maken**. Zolang dat balkje er staat, is er nog niets echt gebeurd: klik je op Ongedaan maken, dan komt het item terug alsof er niets gebeurd is. Pas wanneer het balkje vanzelf verdwijnt, wordt het item echt verwijderd.

Verwijderde items worden nooit hard weggegooid; ze blijven bewaard onder **Onlangs verwijderd**. Dat is nodig om te kunnen synchroniseren: een echt gewiste regel zou bij de volgende synchronisatie gewoon terugkomen van je andere apparaat.

## Verwijderen wint altijd

Als je later synchroniseren aanzet, geldt deze regel: **een verwijdering wint altijd van een wijziging**. Heb je een item op je telefoon verwijderd en tegelijk op je laptop aangepast, dan is het item na de synchronisatie weg — ook al is de wijziging nieuwer. Dat is een bewuste keuze: zo kan iets wat je hebt weggegooid nooit vanzelf terugkomen.

## Gebaren

In het overzicht: **veeg naar links** om te verwijderen, **veeg naar rechts** om vast te zetten of los te maken, en **houd een rij ingedrukt** (of klik met de rechtermuisknop) voor een menu. Trek het overzicht naar beneden om te verversen. Deze gebaren werken alleen wanneer de app ontgrendeld is.

## Bestanden en links

Je kunt bij elk item zoveel links en bestanden zetten als je wilt. Een link opent gewoon in je browser. Een bestand opent **in de app zelf**: afbeeldingen en tekst worden getoond, PDF's worden ingesloten. Naast elk bestand staat een downloadknop; die werkt altijd, ook als het voorvertonen niet lukt.

Bij het opslaan van een link haalt de app er automatisch de reclame- en trackingcodes uit, zoals \`utm_source\`. De rest van het adres blijft ongemoeid.

Grote foto's worden verkleind zodat je opslag niet volloopt. Bestanden groter dan 25 MB worden geweigerd.

## Exporteren

Onder **Instellingen ▸ Gegevens** staan twee exports:

- **JSON** is een volledige kopie, inclusief verwijderde items. Dit is het echte back-upbestand: hier kun je later alles mee terugzetten. Bewaar het ergens veilig.
- **CSV** is een platte tabel om in Excel te openen. Handig om iets op te zoeken, maar **niet** geschikt als back-up: opmaak, bestanden en verwijderde items zitten er niet in.

Het CSV-bestand gebruikt een puntkomma als scheidingsteken, want dat is wat Excel in het Nederlands verwacht.

## Afdrukken

Je kunt één item afdrukken met de knop bij dat item, of een volledig overzicht via **Instellingen ▸ Afdrukken**. Het overzicht groepeert alles per soort, met eerst een samenvattende tabel. Met de schakelaar *Volledige inhoud* bepaal je of de tekst van elk item mee wordt afgedrukt of alleen de kopgegevens. Kies in het afdrukvenster van je browser "Opslaan als pdf" als je er een bestand van wilt maken.

## Talen en thema's

De app spreekt Nederlands en Engels; wisselen gaat direct, zonder herladen. Er zijn vier thema's — donker, licht, middernacht en papier — en twee dichtheden. Compact toont alleen titels, ruim toont ook een stukje inhoud, labels en datums.

## Wat kan deze app niet?

Eerlijk is eerlijk:

- **Geen gedeelde database.** Deze app is voor jou alleen. Twee mensen zien elkaars wijzigingen niet live.
- **Niets gebeurt vanzelf.** Geen e-mails, geen meldingen, geen taken 's nachts. Er is geen server die dat kan doen.
- **Geen linkcontrole.** De oude versie kon controleren of links nog werkten. Dat kon alleen omdat de server dat deed; een browser mag dat om veiligheidsredenen niet, dus die knop is er niet meer.
`;

const EN = `
# Home Management

Everything about your home in one place: notes, documents, contacts, warranties, insurance, maintenance and accounts. The app works fully without an internet connection.

## Where is my data?

Everything lives **on this device**, in this browser's storage. There is no server, no analytics are collected and nothing is sent anywhere. That also means: anyone who can open this browser can read your data. So don't put anything in here you wouldn't want on your phone if you lost it.

Because the data lives in the browser, it disappears if you clear this site's browsing data. So take an export now and then. At startup the app asks the browser to protect its storage from automatic clean-up; **Settings ▸ Storage** tells you whether that was granted.

## Types

Every item has exactly one type: note, document, contact, warranty, insurance, maintenance or account. The type sets the icon, the colour, the filter at the top of the overview and where the item counts in the insights. You pick it when creating an item and can change it at any time.

## Read-only

The app starts **locked**. In that state you can read everything and open files, but change nothing. That way you never accidentally alter a code or a contract number while looking something up. Click *Locked* at the top right to edit, and click again to lock. Your choice is remembered.

## Saving: what is instant, what waits for Save?

This is the one part of the app worth knowing:

- **Saved immediately**, even if you back out without pressing Save: pinning, adding or removing links, adding or removing files, and linking items together.
- **Saved only on Save**: title, type, content, note, tags, reminder date and reminder type.

So: add a link, then change the title, then leave without saving — the link stays and the title change is discarded. That is deliberate. For unsaved text the app always asks first before throwing it away.

A **new item** is the exception: until you have saved it once it only exists in memory, so there a link or a file is committed on Save as well.

## Reminders

An item can carry one reminder date and, with it, one **reminder type** — for example *yearly service* or *warranty expires*. You type that type yourself, or pick one you've used before. One type per item.

Reminders are single dates; they do not repeat. When a date has passed you set the next one yourself. The overview shows at a glance what is overdue, due today and coming up.

Important: there is no server, so **nothing can happen while the app is closed**. No email, no notification at 3 a.m. You see a reminder when you open the app.

## Searching and filtering

Search looks at the title, the content, the note, the tags, both the description and the address of links, and attachment filenames. Case and accents don't matter: *cafe* finds *Café*. Type several words and they must **all** appear — though they may sit in different fields.

Behind the *Filters* button you'll find sorting, a date range and the tags. Select several tags and the app shows only items carrying **all** of them.

## Deleting and undo

Delete an item and it vanishes from the overview at once, with a small bar offering **Undo**. While that bar is showing, nothing has actually happened yet: click Undo and the item returns as if nothing occurred. Only when the bar disappears on its own is the item really deleted.

Deleted items are never truly discarded; they stay under **Recently deleted**. That is what makes syncing possible: a genuinely erased row would simply come back from your other device on the next sync.

## Deletes always win

If you later switch syncing on, this rule applies: **a deletion always beats an edit**. If you deleted an item on your phone and edited it on your laptop, after syncing the item is gone — even though the edit is newer. That is a deliberate choice: it means something you threw away can never come back by itself.

## Gestures

In the overview: **swipe left** to delete, **swipe right** to pin or unpin, and **press and hold** a row (or right-click) for a menu. Pull the overview down to refresh. These gestures only work while the app is unlocked.

## Files and links

You can attach as many links and files to an item as you like. A link opens in your browser as usual. A file opens **inside the app**: images and text are displayed, PDFs are embedded. Next to every file there is a download button; that always works, even when the preview does not.

When saving a link the app strips advertising and tracking codes out of it, such as \`utm_source\`. The rest of the address is left alone.

Large photos are scaled down so your storage doesn't fill up. Files larger than 25 MB are refused.

## Exporting

Under **Settings ▸ Data** there are two exports:

- **JSON** is a complete copy, including deleted items. This is the real backup file: it is what you can restore everything from later. Keep it somewhere safe.
- **CSV** is a flat table for opening in Excel. Handy for looking something up, but **not** a backup: formatting, files and deleted items are not in it.

The CSV file uses a semicolon as its separator, because that is what Excel expects in a Dutch locale.

## Printing

You can print a single item with the button on that item, or a full overview via **Settings ▸ Print**. The overview groups everything by type, with a summary table first. The *Full content* switch decides whether each item's text is printed or only its headline details. Choose "Save as PDF" in your browser's print dialog to turn it into a file.

## Languages and themes

The app speaks Dutch and English; switching is instant, with no reload. There are four themes — dark, light, midnight and paper — and two densities. Compact shows titles only; comfortable also shows a snippet, tags and dates.

## What can't this app do?

Being honest about it:

- **No shared database.** This app is for you alone. Two people do not see each other's changes live.
- **Nothing happens by itself.** No emails, no notifications, no overnight jobs. There is no server that could do it.
- **No link checking.** The old version could check whether links still worked. That was only possible because the server did it; a browser is not allowed to for security reasons, so that button is gone.
`;

/** The help document as Markdown, for the language given. */
export function helpText(lang) {
  return (lang === "en" ? EN : NL).trim();
}
