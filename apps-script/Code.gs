/**
 * Jarvis Home Board data feed.
 *
 * Reads Kevin's Jarvis databases in Notion and his Google Calendar, and
 * returns them as JSON for the Home Board page on the Fire tablet.
 *
 * Script properties (Project Settings > Script properties):
 *   NOTION_TOKEN  the Notion integration secret (starts with "ntn_" or "secret_")
 *   BOARD_KEY     any long random word; the tablet page sends it with each request
 */

var DB = {
  todos: '6219dc4a43bd434ea03c044853e396de',
  bills: '1668ee6b8a9b43288bdfca01e7f2cb1b',
  trips: 'bc36d396cbcd46e2a76708410f943654',
  ideas: '9e1da08698234ec39656b87190b9a882'
};
var TZ = 'America/New_York';
var CACHE_SECONDS = 240;

function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var key = (e && e.parameter && e.parameter.key) || '';
  if (!props.getProperty('BOARD_KEY') || key !== props.getProperty('BOARD_KEY')) {
    return json_({ ok: false, error: 'bad_key' });
  }
  if (e.parameter && e.parameter.debug) return json_(notionDebug_());
  var cache = CacheService.getScriptCache();
  var cached = cache.get('board');
  if (cached && !(e.parameter && e.parameter.fresh)) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }
  var out = { ok: true, updated: new Date().toISOString(), errors: [] };
  out.todos = safe_(out, 'todos', getTodos_) || [];
  out.bills = safe_(out, 'bills', getBills_) || [];
  out.trip = safe_(out, 'trip', getTrip_);
  out.idea = safe_(out, 'idea', getIdea_);
  out.events = safe_(out, 'events', getEvents_) || [];
  var text = JSON.stringify(out);
  if (!out.errors.length) cache.put('board', text, CACHE_SECONDS);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to check everything works before deploying. */
function testFeed() {
  var key = PropertiesService.getScriptProperties().getProperty('BOARD_KEY');
  var res = doGet({ parameter: { key: key, fresh: '1' } });
  Logger.log(res.getContent());
}

// ---------- Notion ----------

function getTodos_() {
  // Notion only allows two levels of nested filters, so fetch every open task and narrow it here.
  var weekOut = isoDate_(7);
  var rows = queryNotion_(DB.todos, {
    filter: { property: 'Status', status: { does_not_equal: 'Done' } },
    sorts: [{ property: 'Due', direction: 'ascending' }],
    page_size: 100
  });
  return rows.map(function (p) {
    return {
      task: text_(p.properties.Task),
      due: dateStart_(p.properties.Due),
      priority: selectName_(p.properties.Priority),
      area: selectName_(p.properties.Area)
    };
  }).filter(function (t) {
    return t.due ? t.due.slice(0, 10) <= weekOut : t.priority === 'High';
  }).slice(0, 25);
}

function getBills_() {
  var rows = queryNotion_(DB.bills, {
    filter: {
      and: [
        { property: 'Status', status: { equals: 'Upcoming' } },
        { property: 'Next Due', date: { on_or_before: isoDate_(7) } }
      ]
    },
    sorts: [{ property: 'Next Due', direction: 'ascending' }],
    page_size: 10
  });
  return rows.map(function (p) {
    var ap = p.properties.Autopay;
    return {
      bill: text_(p.properties.Bill),
      due: dateStart_(p.properties['Next Due']),
      autopay: !!(ap && ap.checkbox)
    };
  });
}

function getTrip_() {
  var rows = queryNotion_(DB.trips, {
    filter: {
      and: [
        { property: 'Status', status: { does_not_equal: 'Done' } },
        { property: 'Dates', date: { on_or_after: isoDate_(0) } }
      ]
    },
    sorts: [{ property: 'Dates', direction: 'ascending' }],
    page_size: 1
  });
  if (!rows.length) return null;
  var p = rows[0];
  return {
    trip: text_(p.properties.Trip),
    destination: text_(p.properties.Destination),
    start: dateStart_(p.properties.Dates)
  };
}

function getIdea_() {
  var rows = queryNotion_(DB.ideas, {
    filter: { property: 'Status', status: { does_not_equal: 'Done' } },
    sorts: [{ property: 'Idea', direction: 'ascending' }],
    page_size: 100
  });
  if (!rows.length) return null;
  var day = Number(Utilities.formatDate(new Date(), TZ, 'D'));
  var p = rows[(day * 7) % rows.length];
  return {
    idea: text_(p.properties.Idea),
    type: selectName_(p.properties.Type),
    effort: selectName_(p.properties.Effort)
  };
}

function queryNotion_(dbId, body) {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN is not set');
  var res = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var data = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('Notion ' + code + ': ' + (data.message || 'error'));
  return data.results || [];
}

function text_(prop) {
  if (!prop) return '';
  var parts = prop.title || prop.rich_text || [];
  return parts.map(function (t) { return t.plain_text; }).join('').trim();
}
function selectName_(prop) { return prop && prop.select ? prop.select.name : ''; }
function dateStart_(prop) { return prop && prop.date ? prop.date.start : null; }

// ---------- Calendar ----------

function getEvents_() {
  var now = new Date();
  var end = new Date(now.getTime() + 7 * 86400000);
  var events = CalendarApp.getDefaultCalendar().getEvents(now, end);
  return events.slice(0, 10).map(function (ev) {
    var allDay = ev.isAllDayEvent();
    return {
      title: ev.getTitle() || '(No title)',
      start: allDay ? Utilities.formatDate(ev.getAllDayStartDate(), TZ, 'yyyy-MM-dd') : ev.getStartTime().toISOString(),
      allDay: allDay
    };
  });
}

// ---------- helpers ----------

function isoDate_(daysFromToday) {
  return Utilities.formatDate(new Date(Date.now() + daysFromToday * 86400000), TZ, 'yyyy-MM-dd');
}
function safe_(out, name, fn) {
  try { return fn(); } catch (err) { out.errors.push(name + ': ' + err.message); return null; }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Shows which Notion workspace the key belongs to and what it can see. */
function notionDebug_() {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  var h = { Authorization: 'Bearer ' + token, 'Notion-Version': '2022-06-28' };
  var me = JSON.parse(UrlFetchApp.fetch('https://api.notion.com/v1/users/me', { headers: h, muteHttpExceptions: true }).getContentText());
  var s = JSON.parse(UrlFetchApp.fetch('https://api.notion.com/v1/search', { method: 'post', contentType: 'application/json', headers: h, payload: JSON.stringify({ page_size: 50 }), muteHttpExceptions: true }).getContentText());
  var items = (s.results || []).map(function (r) {
    var t = r.object === 'database' ? (r.title || []) : ((r.properties && (r.properties.title || r.properties.Name || {}).title) || []);
    return r.object + ': ' + t.map(function (x) { return x.plain_text; }).join('') + ' (' + r.id + ')';
  });
  return { workspace: me.bot && me.bot.workspace_name, integration: me.name, canSee: items, error: s.message || null };
}
