# Edzéskövető

Egyszerű, offline is működő edzésnapló (PWA) Vue 3-mal és Tailwind CSS-sel. Minden adat a böngésző saját tárhelyén (localStorage) van.

## Funkciók
- Edzések rögzítése dátummal, címkékkel, gyakorlatokkal, sorozatokkal (drop szett / kombó részletekkel)
- **Legutóbbi eredmény** minden gyakorlatnál, egy kattintással átvehető
- **Egyéni csúcsok (PR)** jelölése, élőben szerkesztés közben is
- **Haladás grafikon** gyakorlatonként: becsült 1RM (Epley), max súly, volumen
- **Pihenő stopper** hanggal és rezgéssel, automatikus indítással
- **Edzéssablonok** és „megismétlés ma” gomb
- **Keresés és szűrés** gyakorlatra, címkére
- **Saját címkék** (hozzáadás, törlés, sorrend)
- **Világos / sötét / rendszer szerinti téma**
- Mentés (export) és visszatöltés (import) JSON-ba, mentés-emlékeztetővel

## Fájlok
| Fájl | Szerep |
|---|---|
| `index.html` | felület (Vue sablon) |
| `app.js` | logika |
| `tailwind.css` | stílus forrása (Tailwind v4) |
| `styles.css` | lefordított stílus – ezt tölti be az oldal |
| `sw.js` | service worker (offline működés) |
| `manifest.json`, `icon.svg`, `icons/` | PWA telepítéshez |

## Stílus újrafordítása
Ha az `index.html`-ben vagy az `app.js`-ben új Tailwind osztályt használsz, fordítsd újra a CSS-t (Node.js kell hozzá):

```bash
npx @tailwindcss/cli -i tailwind.css -o styles.css --minify
```

## Frissítés után
Ha módosítasz valamit, léptesd a `CACHE_NAME` verzióját a `sw.js` elején (pl. `v3` → `v4`), hogy a telepített app biztosan az új fájlokat töltse be.
