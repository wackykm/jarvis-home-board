# Jarvis Home Board

Full-screen home dashboard for the kitchen Fire tablet: clock, weather (New Market, VA), to-dos, calendar, bills, next trip, and an idea of the day from the Jarvis Notion.

- `index.html` is the board. It holds no personal data or secrets.
- `apps-script/` is the Google Apps Script data feed. It reads Notion (with an integration token kept in Script Properties) and Google Calendar, and returns JSON.
- The tablet is connected once with a setup link: `https://wackykm.github.io/jarvis-home-board/#api=<web app URL>&key=<BOARD_KEY>`. The tablet remembers both.
- Weather comes from Open-Meteo (free, no key).
