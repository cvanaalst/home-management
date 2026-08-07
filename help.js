/**
 * help.js — long-form help text as Markdown, per language (BLUEPRINT §8.14).
 *
 * Must explain in plain user language: where the data lives, what leaves the
 * device and what does not, that deletes win in a merge, and every quirk the
 * user will actually hit. If a behaviour is surprising, it belongs here.
 *
 * ── Formatting rule (§13.12) ───────────────────────────────────────────────
 * The renderer is line-based: a single newline inside a paragraph becomes a
 * <br>. Every paragraph and every bullet must stay on ONE source line, however
 * long, or the formatting shatters. That is why the lines below are not wrapped.
 *
 * ── Keep this current ──────────────────────────────────────────────────────
 * This file went eight phases without an update and ended up describing type
 * names that no longer existed and reminders that "never repeat" months after
 * recurrence shipped. Help that is wrong is worse than help that is missing:
 * the user trusts it. Update it in the same commit as the behaviour.
 */

const NL = `
# Huisbeheer

Alles over je huis op één plek: documenten, configuraties, accounts, nutsvoorzieningen, apparaten en afspraken — plus een tijdlijn van wat er in huis gebeurd is. De app werkt volledig zonder internet.

## Waar staan mijn gegevens?

Alles staat **op dit apparaat**, in de opslag van deze browser. Er is geen server en er worden geen statistieken verzameld. Dat betekent ook: wie deze browser kan openen, kan je gegevens lezen. Je schijfversleuteling en toegangscode beschermen dat; de app doet dat lokaal niet nog eens over.

Zet je synchronisatie aan, dan gaat er een kopie naar **jouw** Google Drive — zie *Synchroniseren*. Die kopie kun je versleutelen, zie *Versleuteling*.

Omdat de gegevens in de browser staan, verdwijnen ze als je de browsergegevens van deze site wist. Maak dus regelmatig een export. De app vraagt bij het opstarten aan de browser om de opslag te beschermen tegen automatisch opruimen; onder **Instellingen ▸ Opslag** zie je of dat gelukt is.

## Soorten

Elk item heeft precies één soort: **Document**, **Configuratie**, **Account**, **Nutsvoorzieningen**, **Apparaten**, **Kalender** of **Diversen**. De soort bepaalt het icoon, de kleur, het filter bovenaan het overzicht, welke gegevensvelden de app voorstelt, en waar het item meetelt in de inzichten. Je kiest de soort bij het aanmaken en kunt hem later altijd wijzigen.

## Gegevens per item

Onder **Gegevens** zet je losse velden met een naam en een waarde: klantnummer, serienummer, polisnummer, installateur. De app stelt namen voor die bij de soort passen — bij een Account bijvoorbeeld *Leverancier* en *Klantnummer*, bij Apparaten *Serienummer* en *Garantie tot* — maar je mag elke naam gebruiken die je zelf wilt.

Waarden staan in een lettertype waarin een 0 en een O van elkaar verschillen, want dat zijn nummers die je karakter voor karakter naleest. Naast elke waarde staat een **kopieerknop**; de knop zelf bevestigt kort dat het gelukt is. Deze velden worden ook doorzocht, dus je kunt een item terugvinden door zijn polisnummer in te typen.

## Alleen-lezen

De app start **vergrendeld**. In die stand kun je alles lezen, bestanden openen en waarden kopiëren, maar niets wijzigen. Zo verander je nooit per ongeluk een code of een contractnummer terwijl je iets opzoekt. Klik rechtsboven op *Vergrendeld* om te bewerken, en klik opnieuw om te vergrendelen. De app onthoudt je keuze.

## Opslaan: wat gaat meteen, wat pas op Opslaan?

Dit is het enige stukje van de app dat je echt moet weten:

- **Meteen bewaard**, ook als je daarna teruggaat zonder op Opslaan te drukken: vastzetten, links toevoegen of verwijderen, bestanden toevoegen of verwijderen, en items koppelen.
- **Pas bij Opslaan bewaard**: titel, soort, inhoud, notitie, labels, gegevensvelden, herinneringsdatum, herhaling en de velden van een gebeurtenis.

Dus: voeg je een link toe, wijzig je daarna de titel en ga je weg zonder op te slaan, dan blijft de link staan en verdwijnt de titelwijziging. Dat is bewust zo. Bij niet-opgeslagen tekst vraagt de app altijd eerst of je die wilt weggooien.

Zodra er iets te bewaren valt verschijnt **Opslaan bovenaan in de balk**, zodat je er niet eerst helemaal naar beneden hoeft te scrollen. Op een toetsenbord werkt ⌘S (of Ctrl+S), ook terwijl je nog in een tekstveld staat.

Een **nieuw item** is de uitzondering: zolang je het nog nooit hebt opgeslagen bestaat het alleen in het geheugen, dus daar worden ook een link of een bestand pas vastgelegd zodra je op Opslaan drukt.

## Panelen in- en uitklappen

Een item heeft veel panelen. Alles wat je niet constant nodig hebt — bestanden, links, gekoppelde items, geschiedenis en eerdere versies — begint **dichtgeklapt**, met in de kop meteen het antwoord op "zit hier iets in?": *Bestanden (2)*, *Geschiedenis (3 · € 263,50)*. Je hoeft een paneel dus nooit te openen om te ontdekken dat het leeg is.

De app onthoudt wat jij openzet, en doet dat bij elk item — niet per item apart.

## Herinneringen en herhaling

Een item kan één herinneringsdatum hebben, met daarbij een **soort herinnering** die je zelf typt (*jaarlijks onderhoud*, *garantie verloopt*) of kiest uit wat je eerder gebruikte.

Een herinnering kan zichzelf **herhalen**: dagelijks, wekelijks, maandelijks, per kwartaal of jaarlijks, met een eigen interval — bijvoorbeeld elke 2 jaar. Onder de datum zie je meteen wanneer de volgende keer valt.

Druk je op **Uitgevoerd**, dan gebeuren er twee dingen: de datum schuift op naar de volgende keer, én de app legt automatisch een **gebeurtenis** vast in de tijdlijn. Zo bouwt je onderhoudshistorie zichzelf op uit werk dat je toch al deed. Heeft de herinnering geen herhaling, dan wordt hij afgerond en verdwijnt de datum.

De datum schuift altijd op vanaf de **geplande** datum als je vroeg bent, en vanaf vandaag als je te laat bent — je verliest dus nooit je ritme door iets een week eerder te doen.

## Naar je agenda

Een herinnering in de app kan je alleen bereiken zolang de app open is. Wil je er écht aan herinnerd worden, zet hem dan in je agenda: naast de herinnering staat een **agenda-knop** die één afspraak downloadt, en onder **Instellingen ▸ Exporteren** zit *Herinneringen (.ics)* voor allemaal tegelijk.

De herhaling gaat mee. Je agenda neemt het daarna over en blijft je waarschuwen, ook als je deze app maanden niet opent. Importeer je later opnieuw, dan worden bestaande afspraken bijgewerkt in plaats van verdubbeld.

## Meldingen

Zet je meldingen aan onder **Instellingen ▸ Herinneringen melden**, dan toont de app bij het openen één melding met wat er openstaat — hoogstens één keer per dag.

Wees eerlijk over wat dit is: er is geen server, dus er kan **niets gebeuren terwijl de app dicht is**. Deze melding is een geheugensteun bij het openen, geen wekker. Voor dingen die je echt niet mag missen: gebruik de agenda-export hierboven.

## Tijdlijn: wat er gebeurd is

Naast *wat je hebt* houdt de app bij *wat ermee gebeurd is*: onderhoud, een storing, een betaling, een wijziging of een aankoop. Zo'n **gebeurtenis** hangt aan het item waar het over gaat, en krijgt daarvan ook de kleur en het icoon.

Je legt er een vast met **Gebeurtenis vastleggen** op het item zelf — datum, soort en eventueel een bedrag. Op de pagina van dat item zie je onder **Geschiedenis** alles wat er ooit gebeurd is, met het totaal aan bedragen: drie storingen en € 263,50 zegt meer over een ketel dan welke notitie ook.

Het tabblad **Tijdlijn** toont alles bij elkaar, gegroepeerd per maand, met zoeken, filters op soort en periode, en een totaal. Met de printknop druk je precies af wat er op je scherm staat — handig als iemand om een onderhoudshistorie vraagt.

## Zoeken en filteren

Zoeken kijkt in de titel, de inhoud, de notitie, de labels, je gegevensvelden, de omschrijving én het adres van links, en de namen van bijlagen. Hoofdletters en accenten maken niet uit: *cafe* vindt *Café*. Typ je meerdere woorden, dan moeten ze **allemaal** voorkomen — al mogen ze in verschillende velden staan.

Onder de knop *Filters* vind je sorteren, een datumbereik en de labels. Kies je meerdere labels, dan toont de app alleen items die **alle** gekozen labels hebben.

Gebruik je een combinatie vaker, klik dan op **Weergave bewaren**. Die verschijnt daarna als knopje boven het overzicht en is met één klik terug — filteren wordt zo navigeren. Je kunt er acht bewaren.

## Meerdere items tegelijk

Klik op het vinkje bovenaan om **meerdere te selecteren**. In die stand opent een tik een item niet maar vinkt hem aan. Daarna kun je in één keer een label toevoegen, de soort wijzigen, alleen die items exporteren of ze verwijderen.

De selectie vervalt zodra je het overzicht verlaat — zo verwijder je nooit iets waarvan je vergeten was dat het nog aangevinkt stond.

## Sneltoetsen

Op een computer met toetsenbord:

- **/** — naar het zoekveld
- **n** — nieuw item
- **⌘K** of **Ctrl+K** — spring naar een item op naam
- **⌘S** of **Ctrl+S** — opslaan

## Verwijderen en ongedaan maken

Verwijder je een item, dan verdwijnt het meteen uit het overzicht en verschijnt onderaan een balkje met **Ongedaan maken**. Zolang dat balkje er staat, is er nog niets echt gebeurd: klik je op Ongedaan maken, dan komt het item terug alsof er niets gebeurd is. Pas wanneer het balkje vanzelf verdwijnt, wordt het item echt verwijderd.

Verwijderde items worden nooit hard weggegooid; ze blijven bewaard onder **Onlangs verwijderd**. Dat is nodig om te kunnen synchroniseren: een echt gewiste regel zou bij de volgende synchronisatie gewoon terugkomen van je andere apparaat.

## Verwijderen wint altijd

Bij synchroniseren geldt deze regel: **een verwijdering wint altijd van een wijziging**. Heb je een item op je telefoon verwijderd en tegelijk op je laptop aangepast, dan is het item na de synchronisatie weg — ook al is de wijziging nieuwer. Dat is een bewuste keuze: zo kan iets wat je hebt weggegooid nooit vanzelf terugkomen.

## Eerdere versies

Van elk item bewaart de app de **laatste vijf keer dat je het opsloeg**. Onder *Eerdere versies* zie je wanneer, en wat er ten opzichte van nu anders is. Met *Terugzetten* haal je zo'n versie terug — de huidige tekst wordt daarbij zelf ook weer als versie bewaard, dus terugzetten is ook weer ongedaan te maken.

Deze versies staan **alleen op dit apparaat** en gaan niet mee met de synchronisatie. Ze bewaren ook wat een synchronisatie zou overschrijven: pas je hetzelfde item op twee apparaten aan, dan wint de nieuwste, en is dit de enige plek waar de andere versie nog te vinden is. Verwijder je een item definitief, dan gaan de versies mee.

## Gebaren

In het overzicht: **veeg naar links** om te verwijderen, **veeg naar rechts** om vast te zetten of los te maken, en **houd een rij ingedrukt** (of klik met de rechtermuisknop) voor een menu. Trek het overzicht naar beneden om te verversen. Deze gebaren werken alleen wanneer de app ontgrendeld is.

## Bestanden en links

Je kunt bij elk item zoveel links en bestanden zetten als je wilt. Een link opent gewoon in je browser. Een bestand opent **in de app zelf**: afbeeldingen en tekst worden getoond, PDF's worden ingesloten. Naast elk bestand staat een downloadknop; die werkt altijd, ook als het voorvertonen niet lukt.

Bij het opslaan van een link haalt de app er automatisch de reclame- en trackingcodes uit, zoals \`utm_source\`. De rest van het adres blijft ongemoeid.

Grote foto's worden verkleind zodat je opslag niet volloopt. Bestanden groter dan 25 MB worden geweigerd.

**Plakken maakt een item.** Staat er een bestand, een foto, een adres of tekst op je klembord, plak het dan op het overzicht: de app maakt er een nieuw item van, met het bestand er al aan of de tekst er al in.

## Synchroniseren met Google Drive

Onder **Instellingen ▸ Synchronisatie** koppel je je Google-account. De app maakt een map *Huisbeheer* in **jouw** Drive en gebruikt alleen die map — hij kan de rest van je Drive niet zien.

Synchroniseren gaat in twee richtingen: wijzigingen van hier gaan omhoog, die van je andere apparaten komen binnen. Bijlagen gaan mee. Je kunt ook los een **back-up** maken; de app bewaart de tien nieuwste en ruimt oudere zelf op. Onder *Terugzetten* kies je er een, en of je wilt samenvoegen of vervangen.

Een Google-aanmelding is ongeveer een uur geldig en wordt niet stilletjes vernieuwd. De app zal dus vaak melden dat automatisch synchroniseren is **overgeslagen** — dat is normaal, geen fout. Onder **Instellingen ▸ Synclogboek** zie je precies wat er gebeurd is en waarom.

## Versleuteling

Onder **Instellingen ▸ Versleuteling** kies je een wachtwoordzin. Daarna staan je gegevens, je back-ups én je bijlagen **versleuteld** op Drive: zonder die zin is er niets van te lezen.

Op dit apparaat blijft alles gewoon leesbaar — dat is al beschermd door je schijfversleuteling en toegangscode. Wat versleuteld wordt, is de kopie die buiten je huis staat.

Op elk ander apparaat vul je één keer dezelfde zin in om weer te kunnen synchroniseren. Er is **geen herstel**: raak je de zin kwijt, dan zijn de gegevens op Drive definitief onleesbaar, ook je back-ups. Druk het herstelblad af en schrijf de zin er met de hand op — de app kent hem niet en kan hem dus ook niet voor je opschrijven.

Bijlagen die al vóór het aanzetten op Drive stonden blijven leesbaar staan tot ze een keer opnieuw geüpload worden.

## Exporteren

Onder **Instellingen ▸ Gegevens** staan drie exports:

- **JSON** is een volledige kopie, inclusief verwijderde items. Dit is het echte back-upbestand: hier kun je later alles mee terugzetten. Bewaar het ergens veilig.
- **CSV** is een platte tabel om in Excel te openen. Handig om iets op te zoeken, maar **niet** geschikt als back-up: opmaak, bestanden en verwijderde items zitten er niet in.
- **Herinneringen (.ics)** zet je herinneringen in je agenda, inclusief herhaling.

Het CSV-bestand gebruikt een puntkomma als scheidingsteken, want dat is wat Excel in het Nederlands verwacht. Bedragen staan er als kaal getal in, zodat je ermee kunt rekenen.

## Afdrukken

Je kunt één item afdrukken met de knop bij dat item, een volledig overzicht via **Instellingen ▸ Afdrukken**, of het logboek via de printknop op de **Tijdlijn**. Het overzicht groepeert alles per soort met eerst een samenvattende tabel; het logboek gaat per maand, met tussentotalen. Met de schakelaar *Volledige inhoud* bepaal je of de tekst van elk item mee wordt afgedrukt. Kies in het afdrukvenster van je browser "Opslaan als pdf" als je er een bestand van wilt maken.

## Inzichten

Onder **Instellingen ▸ Inzichten** staat wat de app van je gegevens kan afleiden: wat er de komende 90 dagen speelt (te laat eerst), wat je huis dit jaar gekost heeft en waaraan, wat de meeste storingen geeft, en hoeveel items je per soort hebt. Elke regel is aanklikbaar en brengt je naar het item of de gefilterde lijst.

## Talen, thema's en dichtheid

De app spreekt Nederlands en Engels; wisselen gaat direct, zonder herladen. Er zijn vier thema's — donker, licht, middernacht en papier — en twee dichtheden. **Compact** laat de tweede regel weg en maakt de rijen smaller, zodat er veel meer op één scherm past; dat werkt zowel in het overzicht als op de tijdlijn.

## Installeren

Voeg de app toe aan je beginscherm en hij opent zonder browserbalk, met een eigen icoon, en werkt offline. Op een iPhone doe je dat in Safari via *Deel ▸ Zet op beginscherm*; op Android en desktop biedt de app het zelf aan onder Instellingen. Meldingen werken op een iPhone alleen wanneer de app zo geïnstalleerd is.

## Wat kan deze app niet?

Eerlijk is eerlijk:

- **Geen gedeelde database.** Deze app is voor jou alleen. Twee mensen zien elkaars wijzigingen niet live.
- **Niets gebeurt vanzelf terwijl de app dicht is.** Geen e-mails, geen wekker. Zet belangrijke datums in je agenda met de .ics-export.
- **Geen linkcontrole.** De oude versie kon controleren of links nog werkten. Dat kon alleen omdat de server dat deed; een browser mag dat om veiligheidsredenen niet, dus die knop is er niet meer.
- **Geen samenvoegen van conflicten per veld.** Wijzig je hetzelfde item tegelijk op twee apparaten, dan wint de nieuwste in zijn geheel. De verliezende versie staat nog wel onder *Eerdere versies* op het apparaat dat hem had.
`;

const EN = `
# Home Management

Everything about your home in one place: documents, configurations, accounts, utilities, devices and appointments — plus a timeline of what has actually happened. The app works fully without an internet connection.

## Where is my data?

Everything lives **on this device**, in this browser's storage. There is no server and no analytics are collected. That also means: anyone who can open this browser can read your data. Your disk encryption and passcode already protect that; the app does not encrypt locally on top of it.

If you turn on syncing, a copy goes to **your** Google Drive — see *Syncing*. That copy can be encrypted, see *Encryption*.

Because the data lives in the browser, it disappears if you clear this site's browsing data. So take an export now and then. At startup the app asks the browser to protect its storage from automatic clean-up; **Settings ▸ Storage** tells you whether that was granted.

## Types

Every item has exactly one type: **Document**, **Configuration**, **Account**, **Utilities**, **Devices**, **Calendar** or **Various**. The type sets the icon, the colour, the filter at the top of the overview, which detail fields the app suggests, and where the item counts in the insights. You pick it when creating an item and can change it at any time.

## Details per item

Under **Details** you add named fields with a value: customer number, serial number, policy number, installer. The app suggests names that fit the type — an Account offers *Provider* and *Customer number*, Devices offers *Serial number* and *Warranty until* — but any name you invent works just as well.

Values are shown in a typeface where 0 and O differ, because these are numbers you read one character at a time. Beside each value is a **copy button**; the button itself briefly confirms the copy. These fields are searched too, so you can find an item by typing its policy number.

## Read-only

The app starts **locked**. In that state you can read everything, open files and copy values, but change nothing. That way you never accidentally alter a code or a contract number while looking something up. Click *Locked* at the top right to edit, and click again to lock. Your choice is remembered.

## Saving: what is instant, what waits for Save?

This is the only part of the app you really have to know:

- **Saved instantly**, even if you then go back without pressing Save: pinning, adding or removing links, adding or removing files, and linking items.
- **Saved only on Save**: title, type, content, note, tags, detail fields, reminder date, repeat, and an event's own fields.

So: add a link, then change the title, then leave without saving — the link stays and the title change is discarded. That is deliberate. For unsaved text the app always asks first.

As soon as there is something to save, **Save appears in the top bar**, so you never have to scroll to the bottom to reach it. On a keyboard, ⌘S (or Ctrl+S) works too, including while you are still typing in a field.

A **new item** is the exception: until you have saved it once it exists only in memory, so a link or a file added to it is committed on the first Save as well.

## Collapsing panels

An item has a lot of panels. Anything you do not need constantly — files, links, linked items, history and earlier versions — starts **collapsed**, with the answer to "is there anything in here?" right in the header: *Files (2)*, *History (3 · €263.50)*. You never have to open a panel just to find out it is empty.

The app remembers which ones you open, and applies that to every item rather than per item.

## Reminders and repeats

An item can have one reminder date, with a **reminder type** you type yourself (*yearly service*, *warranty expires*) or pick from what you used before.

A reminder can **repeat**: daily, weekly, monthly, quarterly or yearly, with its own interval — every 2 years, for example. Below the date the app shows when the next one falls.

Press **Mark done** and two things happen: the date moves on to the next occurrence, and the app automatically records an **event** in the timeline. Your maintenance history builds itself out of work you were doing anyway. If the reminder does not repeat, it is finished and the date is cleared.

The date always advances from the **scheduled** date if you are early, and from today if you are late — so doing something a week early never costs you your rhythm.

## Into your calendar

A reminder in the app can only reach you while the app is open. If you genuinely want to be reminded, put it in your calendar: beside the reminder there is a **calendar button** that downloads that one appointment, and **Settings ▸ Export** has *Reminders (.ics)* for all of them at once.

The repeat comes along. Your calendar takes over from there and keeps warning you, even if you do not open this app for months. Import again later and existing appointments are updated rather than duplicated.

## Notifications

Turn notifications on under **Settings ▸ Reminder notifications** and the app will show one notification when you open it, listing what is due — at most once a day.

Be clear about what this is: there is no server, so **nothing can happen while the app is closed**. This is a reminder when you open the app, not an alarm clock. For things you really must not miss, use the calendar export above.

## Timeline: what has happened

Besides *what you own*, the app tracks *what happened to it*: maintenance, an incident, a payment, a change or a purchase. Such an **event** hangs off the item it is about, and takes that item's colour and icon.

You record one with **Log an event** on the item itself — date, type and optionally an amount. On that item's page, **History** shows everything that ever happened, with the total spent: three incidents and €263.50 says more about a boiler than any note could.

The **Timeline** tab shows all of them together, grouped by month, with search, filters by type and period, and a total. The print button prints exactly what is on your screen — useful when someone asks for a maintenance record.

## Searching and filtering

Search looks at the title, the content, the note, the tags, your detail fields, the label *and* the address of links, and attachment filenames. Case and accents don't matter: *cafe* finds *Café*. Type several words and **all** of them must appear — though they may be in different fields.

Under the *Filters* button you'll find sorting, a date range and the tags. Pick several tags and the app shows only items that have **all** of them.

If you use a combination often, click **Save this view**. It then appears as a chip above the overview and is one click away — filtering becomes navigation. You can keep eight.

## Several items at once

Click the tick at the top to **select several**. In that mode a tap ticks an item instead of opening it. You can then add a tag, change the type, export just those items, or delete them, in one go.

The selection is cleared when you leave the overview — so you never delete something you had forgotten was still ticked.

## Keyboard shortcuts

On a computer with a keyboard:

- **/** — jump to the search box
- **n** — new item
- **⌘K** or **Ctrl+K** — jump to any item by name
- **⌘S** or **Ctrl+S** — save

## Deleting and undo

Delete an item and it disappears from the overview at once, with an **Undo** bar at the bottom. While that bar is there nothing has actually happened yet: press Undo and the item comes back as if nothing did. Only when the bar disappears by itself is the item really deleted.

Deleted items are never hard-deleted; they are kept under **Recently deleted**. That is required for syncing: a truly erased row would simply come back from your other device on the next sync.

## Deletes always win

When syncing, this rule applies: **a deletion always beats a change**. If you deleted an item on your phone and changed it on your laptop at the same time, the item is gone after syncing — even though the change is newer. That is deliberate: something you threw away can never come back by itself.

## Earlier versions

For every item the app keeps the **last five times you saved it**. Under *Earlier versions* you see when, and what differs from the current state. *Restore* brings one back — and the current text is itself kept as a version in the process, so restoring can be undone too.

These versions live **on this device only** and are not synced. They also keep what a sync would overwrite: change the same item on two devices and the newest wins, and this is the only place the other version can still be found. Delete an item permanently and its versions go with it.

## Gestures

In the overview: **swipe left** to delete, **swipe right** to pin or unpin, and **long-press a row** (or right-click) for a menu. Pull the overview down to refresh. These gestures only work when the app is unlocked.

## Files and links

You can attach as many links and files to an item as you like. A link opens in your browser. A file opens **inside the app**: images and text are shown, PDFs are embedded. Beside every file is a download button; that always works, even when previewing does not.

When saving a link the app strips advertising and tracking codes such as \`utm_source\`. The rest of the address is left alone.

Large photos are downscaled so your storage doesn't fill up. Files larger than 25 MB are refused.

**Pasting creates an item.** If your clipboard holds a file, a photo, an address or some text, paste it onto the overview: the app makes a new item from it, with the file already attached or the text already in place.

## Syncing with Google Drive

Under **Settings ▸ Sync** you connect your Google account. The app creates a *Huisbeheer* folder in **your** Drive and uses only that folder — it cannot see the rest of your Drive.

Syncing goes both ways: changes from here go up, changes from your other devices come in. Attachments come along. You can also take a separate **backup**; the app keeps the ten newest and clears out older ones itself. Under *Restore* you pick one, and whether to merge or replace.

A Google sign-in lasts about an hour and is not silently refreshed. So the app will often report that automatic syncing was **skipped** — that is normal, not a fault. **Settings ▸ Sync log** shows exactly what happened and why.

## Encryption

Under **Settings ▸ Encryption** you choose a passphrase. After that your data, your backups *and* your attachments are stored **encrypted** on Drive: without that phrase none of it can be read.

On this device everything stays readable — that is already protected by your disk encryption and passcode. What gets encrypted is the copy that lives outside your home.

On any other device you enter the same phrase once to sync again. There is **no recovery**: lose the phrase and the data on Drive is permanently unreadable, including your backups. Print the recovery sheet and write the phrase on it by hand — the app does not know it and therefore cannot write it down for you.

Attachments that were already on Drive before you turned this on stay readable there until they are uploaded again.

## Exporting

Under **Settings ▸ Data** there are three exports:

- **JSON** is a complete copy, including deleted items. This is the real backup file: you can restore everything from it. Keep it somewhere safe.
- **CSV** is a flat table to open in Excel. Handy for looking something up, but **not** suitable as a backup: formatting, files and deleted items are not in it.
- **Reminders (.ics)** puts your reminders in your calendar, repeats included.

The CSV uses a semicolon separator, because that is what Excel expects in Dutch locales. Amounts are plain numbers so you can calculate with them.

## Printing

You can print one item with the button on that item, a full overview via **Settings ▸ Print**, or the log via the print button on the **Timeline**. The overview groups everything by type with a summary table first; the log runs by month, with subtotals. The *Full content* switch decides whether each item's text is printed. Choose "Save as PDF" in your browser's print dialog to make a file of it.

## Insights

**Settings ▸ Insights** shows what the app can work out from your data: what is coming in the next 90 days (overdue first), what your home has cost this year and on what, what breaks most often, and how many items you have per type. Every row is clickable and takes you to the item or the filtered list.

## Languages, themes and density

The app speaks Dutch and English; switching is instant, with no reload. There are four themes — dark, light, midnight and paper — and two densities. **Compact** drops the second line and tightens the rows so far more fits on one screen; it applies to the overview and the timeline alike.

## Installing

Add the app to your home screen and it opens without a browser bar, with its own icon, and works offline. On an iPhone use Safari's *Share ▸ Add to Home Screen*; on Android and desktop the app offers it under Settings. On an iPhone, notifications only work when the app is installed this way.

## What can't this app do?

Honestly:

- **No shared database.** This app is for you alone. Two people don't see each other's changes live.
- **Nothing happens by itself while the app is closed.** No emails, no alarm. Put important dates in your calendar with the .ics export.
- **No link checking.** The old version could check whether links still worked. That was only possible because the server did it; a browser is not allowed to for security reasons, so that button is gone.
- **No per-field conflict merging.** Change the same item on two devices at once and the newest wins as a whole. The losing version is still under *Earlier versions* on the device that had it.
`;

/** The help document as Markdown, for the language given. */
export function helpText(lang) {
  return (lang === "en" ? EN : NL).trim();
}
