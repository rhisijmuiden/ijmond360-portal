# IJmond 360 Portal

[English](README.md)

Eén startpagina voor alle medewerkers van IJmond 360: alle interne apps en links als duidelijke knoppen,
in tabs per werkplek (Televisie, Radio, ...), met inloggen via Microsoft 365 en bovenaan de nieuwste mail
en de agenda van vandaag.

- Single sign-on met Microsoft Entra ID voor elk account in de tenant van IJmond 360 (lokaal admin-account als reserve).
- Tabs, onderdelen en knoppen beheer je in de browser: naam, waar de app voor is, link, icoon of logo, kleur.
- Zichtbaarheid per tab of knop op Microsoft-groep, favorieten per medewerker, zoeken met `/`.
- Statuslampje per knop (elke minuut een HTTP-check), mededelingen met begin- en eindtijd.
- Mail en agenda uit Microsoft 365, *Nu op TV* uit TV Station Manager.
- Gedeeld platform: SMTP-mailserver, back-ups (FTP, FTPS, SCP, SMB, OneDrive; volledig + incrementeel, terugzetten),
  Info-venster met versie en updates vanuit de interface, productie- en testkanaal.
- Engels en Nederlands, huisstijl IJmond 360 (`branding/ijmond360`).

Installeren: zie [docs/install.md](docs/install.md). Ontwikkelen en releases: zie [README.md](README.md) en
[CONTRIBUTING.md](CONTRIBUTING.md).
