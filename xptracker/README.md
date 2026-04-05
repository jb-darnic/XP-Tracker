# XP Tracker

A lightweight Alt1 app for tracking RuneMetrics XP in real time.

This project reads the in-game RuneMetrics XP panel, estimates XP/hour, shows a live session graph, and highlights common XP drop sizes. It is designed to run as a hosted Alt1 web app and is a good fit for GitHub Pages deployment.

## What This Repo Contains

- `index` - the app shell and styling
- `newscripts.js` - UI logic, graph rendering, and Alt1 interaction
- `xpcounter.bundle.js` - bundled XP counter reader used by the app
- `nis/` - supporting Alt1 / RuneApps assets
- image assets used by the panel UI

## Using It In Alt1

Alt1 apps are regular web pages with an `appconfig.json` manifest.

To make this app installable:

1. Publish the repo with GitHub Pages.
2. Make sure an `appconfig.json` file is hosted at the site root next to the app page.
3. Open the Alt1 install URL in a browser:

```text
alt1://addapp/https://jb-darnic.github.io/XP-Tracker/appconfig.json
```

Once the app is added, open the RuneMetrics XP panel in-game and start the tracker from Alt1.

## GitHub Pages

If this repo is published as a project page, the expected public URL is:

```text
https://jb-darnic.github.io/XP-Tracker/
```

## Important Note

The app code already calls `./appconfig.json` at startup, so the hosted version should include that manifest at the public root. Without it, Alt1 can still open the page as a website, but the normal Alt1 app install flow will not work correctly.

## Credits

Built for Alt1 / RuneScape utility use, using the Alt1 browser app model and RuneApps-style libraries.
