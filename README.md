# 81247 Sardinen — Taktisches Outdoor-Versteckspiel

Eine produktionsreife, mobile-first Multiplayer-Web-App (100 % Deutsch, **Outdoor Tactical Dark**-Design) für ein reales Versteckspiel im Münchner Postleitzahlengebiet **81247** (Obermenzing / Schloss Blutenburg / Pipping / Würm-Grünzug).

Entwickelt für **0 EUR Laufzeitkosten** auf kostenlosen Free-Tier-Kontingenten ohne Kreditkartenpflicht (**Firebase Spark-Plan**, **OpenStreetMap & Overpass API** mit lokalem 81247-Fallback, statisches SPA-Hosting auf **Vercel Hobby**).

---

## 1. Spielkonzept, Phasen & Wertung

- **Die Sardinen (Verstecker-Team)**: Genau ein Team sucht in den ersten **10 Minuten (`HIDING`)** ein Versteck innerhalb des vom Spielleiter bestätigten 81247-Polygons, fixiert dort seinen geheimen **Anchor Point** und bleibt anschließend in einem **20-Meter-Versteckradius** (lokale Anti-Jitter-Überwachung).
- **Sucher-Teams (Team 1 bis Team 4)**: Jedes aktive Sucher-Team besitzt ein zugewiesenes **GPS-Beacon-Gerät** (sparsames Senden max. alle 6 s und nur bei `> 5 m` Bewegung).
- **Mehrstufiges Schrumpf-Radar (Inside-Out-Garantie)**:
  - `00:00 – 10:00`: Versteckphase (`HIDING`)
  - `10:00 – 25:00`: Offene Suche (`OPEN_SEARCH`)
  - `ab 25:00`: Radar Stufe 1 ($R_1 = 800\,\text{m}$)
  - `ab 30:00`: Radar Stufe 2 ($R_2 = 400\,\text{m}$)
  - `ab 35:00`: Radar Stufe 3 ($R_3 = 200\,\text{m}$)
  - `ab 40:00`: Radar Stufe 4 ($R_4 = 100\,\text{m}$)
  - `ab 45:00`: Endspiel ($R_5 = 25\,\text{m}$)
- **4-Kategorien-Hinweissystem gegen Zeitstrafe**:
  1. **Richtungs- & Kartenteiler (+2 Min.)**: Nord/Süd- oder Ost/West-Teilung, Thermometer (100 m Laufweg mit metrischer Mittelsenkrechte), $45^\circ$-Radarkegel.
  2. **81247-Umgebungs-Checks (+3 Min.)**: ÖPNV im Umkreis von 150 m, Park-/Grünflächen-Check (inkl. 20 m Randtoleranz).
  3. **Distanz-Scanner (+4 Min.)**: Radius-Radar (50–1000 m), Donut-Ring-Scanner (200m-Bänder mit echtem ausgestanztem Innenloch).
  4. **Manuelle Medienhinweise (+5 Min.)**: Foto vom Himmel/Blätterdach, Foto vom Boden (HTML5-Canvas-Kompression $\le 60\,\text{KB}$ ohne EXIF-GPS) oder 10s-Audio ($\le 25\,\text{KB}$). Antwortfrist: **120 s Netto-Spielzeit** (friert bei Pausen ein; bei Ablauf oder Ablehnung automatische `-5 Min.` Rückerstattung + kostenloser Donut-Ring).
- **Sardinen-Catch & Wertung**: Scannt ein Sucher-Team den QR-Code der Verstecker (oder gibt den 6-stelligen Ersatzcode ein), wechselt es sofort auf `JOINED_SARDINES` („Bei den Sardinen“), während alle übrigen Teams weitersuchen.
  - $\text{Gesamtzeit} = \text{Netto-Suchzeit (ab 10:00 ohne Pausen)} + \text{Gültige Hinweisstrafen}$. Niedrigste Gesamtzeit gewinnt!

---

## 2. Sofortstart im lokalen Demo-Modus (ohne Firebase)

```bash
npm install
npm run dev
```

Klicke auf dem Startbildschirm auf **„Lokalen Demo-Modus starten“** (oder lasse `.env` leer).
- Mehrere geöffnete Browser-Tabs synchronisieren sich in Echtzeit über `localStorage` + `BroadcastChannel('sardinen_81247_demo')`.
- Über **„Simulations-Steuerung“** oben kannst du per 1-Klick zwischen **Spielleiter (Host)**, **Verstecker (Sardinen)** und **Sucher Team 1–4** wechseln, GPS-Bewegungen in 81247 simulieren und per Zeitsprung (`+1 Min.`, `+5 Min.`, `Zu 10:00`, `Zu 25:00`) alle Phasen sofort durchspielen.
- **Indoor-Testmodus**: Der Spielleiter kann in der Lobby den Schalter **„Testmodus: Standort per Kartenklick setzen erlauben“** aktivieren, um vor dem Spieltag gemeinsam vom Sofa aus eine Generalprobe durchzuführen. Im echten Außeneinsatz in 81247 bleibt dieser Schalter ausgeschaltet.

---

## 3. Firebase-Spark-Setup (Kostenloser Online-Multiplayer ohne Passwörter)

### Schritt 1: Kostenloses Firebase-Projekt erstellen
1. Öffne die [Firebase Console](https://console.firebase.google.com/) und wähle dein Projekt (kostenloser **Spark-Plan**, kein Zahlungsmittel nötig).
2. Aktiviere unter **Build → Authentication → Sign-in method** einfach den Anbieter **„Anonym“ (Anonymous)** und klicke auf **Speichern**.
   - **Vorteil:** Du musst **keine** einzelnen Benutzerkonten oder Passwörter in Firebase anlegen! Es gibt kein Dropdown-Menü – jeder Spieler gibt auf dem Startbildschirm einfach seinen Vornamen ein und ist sofort eingeloggt.
3. Erstelle unter **Build → Realtime Database** eine Datenbank (Standort z. B. `europe-west1`). *Kein Firestore, kein Cloud Storage, keine Cloud Functions anlegen!*

### Schritt 2: Umgebungsvariablen eintragen
Kopiere `.env.example` nach `.env.local` und trage die Web-App-Werte aus den Firebase-Projekteinstellungen ein:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=https://dein-projekt-default-rtdb.europe-west1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

### Schritt 3: Gehärtete Sicherheitsregeln (`database.rules.json`) einspielen
Kopiere den kompletten Inhalt von `database.rules.json` in der Firebase Console unter **Realtime Database → Regeln (Rules)** und klicke auf **Veröffentlichen**.

### Schritt 4: Direkt-Login per Namenseingabe (geschlossene 11er-Gruppe + Admin-Button)
Es sind exakt diese **11 Namen** zugelassen (auch durch `database.rules.json` abgesichert – keine anderen Namen können sich anmelden):
- **Alle 11 Spieler** (`Lasse`, `Linus`, `Thomas`, `Robert`, `Nick`, `Eric`, `Jonah`, `Lorenzo`, `Louis`, `Max`, `Roman`) geben auf dem Startbildschirm einfach ihren Vornamen ein und sind sofort in der Lobby.
- **Admin-Freischaltung für `Lasse` & `Linus`:** Nur wenn man als `Lasse` oder `Linus` eingeloggt ist, erscheint in der Lobby (und oben in der Statusleiste) der Button **„Admin-Code eingeben“**. Nach Eingabe des 4-stelligen Codes werden die Admin-/Spielleiter-Rechte (`isHost: true`) freigeschaltet (per SHA-256-Hash in `database.rules.json` erzwungen).

---

## 4. Statisches Deployment auf Vercel Hobby

1. Repository mit [Vercel](https://vercel.com/) verbinden (Hobby-Plan, kostenlos).
2. Framework-Preset: **Vite** (`Build Command: npm run build`, `Output Directory: dist`).
3. Die fünf `VITE_FIREBASE_*`-Variablen unter **Settings → Environment Variables** hinterlegen.
4. `vercel.json` liefert SPA-Rewrites und Sicherheits-Header rein statisch ohne Serverless-/Edge-Functions aus.

---

## 5. Architektur-Transparenz & Free-Tier-Schutz

- **Client-Controller-Lease statt Cloud Functions**: Da bewusst auf kostenpflichtige Cloud Functions (Blaze-Plan) verzichtet wird, erwirbt ein angemeldetes Host- oder Hider-Gerät per atomarer RTDB-Transaktion den Lease unter `/games/81247/state/controller` (5s-Heartbeat, 15s-TTL) und wertet geheime Koordinaten aus `/state/hiderPrivate` aus.
- **Echte Pfad-Isolation**: In `database.rules.json` haben aktive Sucher-Teams keinerlei Leserecht auf `/state/hiderPrivate`, fremde `/teams/{other}/location`, fremde `/clues` oder fremde `/requests`. Dies schützt im Freundeskreis zuverlässig gegen Leaks im Browser-Netzwerkverkehr für Sucher, ersetzt jedoch konzeptionell keinen dedizierten Backend-Server gegen vorsätzlich manipulierte Hider-Clients.
- **Kontingentschonung**: GPS-Updates sind auf `6 s` und `> 5 m` gedrosselt (5 Nachkommastellen), Overpass-Abfragen werden 24 h gecacht (mit sofortigem Offline-Fallback auf echte 81247-POIs in `src/config/fallbackOsm81247.ts`), und Base64-Medien sind durch `.validate`-Regeln (`<= 95000` Zeichen) sowie Einmal-Bereinigung nach Ansicht strikt begrenzt.

---

## 6. Qualitätssicherung & Befehle

```bash
npx tsc --noEmit     # Strikte TypeScript-Prüfung
npx vitest run       # Unit-, Property- & 500-Trial Monte-Carlo-Invariantentests
npm run build        # Produktions-Build nach dist/
```
