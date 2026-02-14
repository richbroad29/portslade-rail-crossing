async function main() {

var TOKEN = '314e8e0f-87f4-4b59-a04e-8abd3187d5a9';
var WURL = 'https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb12.asmx';
var Q = String.fromCharCode(34);
var CLOSE_BEFORE = 1.5;
var OPEN_AFTER = 0.5;
var GAP = 2;

function soap(t) {
var m = t === 'a' ? 'GetArrBoardWithDetailsRequest' : 'GetDepBoardWithDetailsRequest';
var x = '<?xml version=' + Q + '1.0' + Q + '?>';
x += '<soap:Envelope xmlns:soap=' + Q + 'http://www.w3.org/2003/05/soap-envelope' + Q;
x += ' xmlns:typ=' + Q + 'http://thalesgroup.com/RTTI/2013-11-28/Token/types' + Q;
x += ' xmlns:ldb=' + Q + 'http://thalesgroup.com/RTTI/2021-11-01/ldb/' + Q + '>';
x += '<soap:Header><typ:AccessToken><typ:TokenValue>' + TOKEN + '</typ:TokenValue></typ:AccessToken></soap:Header>';
x += '<soap:Body><ldb:' + m + '><ldb:numRows>15</ldb:numRows>';
x += '<ldb:crs>PLD</ldb:crs><ldb:timeWindow>120</ldb:timeWindow>';
x += '</ldb:' + m + '></soap:Body></soap:Envelope>';
return x;
}

function pTime(s) {
if (!s || s.indexOf(':') < 0) return null;
var n = new Date();
var p = s.split(':');
var d = new Date(n.getFullYear(), n.getMonth(), n.getDate(), parseInt(p[0]), parseInt(p[1]), 0);
if (d.getTime() < n.getTime() - 21600000) d.setDate(d.getDate() + 1);
return d;
}

function fmt(d) {
if (!d) return '–:–';
return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
}

function cd(ms) {
if (ms <= 0) return 'NOW';
var s = Math.floor(ms / 1000);
var m = Math.floor(s / 60);
if (m > 60) return Math.floor(m/60) + 'h ' + (m%60) + 'm';
if (m > 0) return m + 'm ' + (s%60) + 's';
return s + 's';
}

function getVal(str, tag) {
var i = str.indexOf(':' + tag + '>');
if (i < 0) i = str.indexOf('<' + tag + '>');
if (i < 0) return null;
var start = i + tag.length + 2;
var end = str.indexOf('<', start);
if (end < 0) return null;
return str.substring(start, end);
}

function isEastOrigin(str) {
if (!str) return false;
var lower = str.toLowerCase();
if (lower.indexOf('brighton') >= 0) return true;
if (lower.indexOf('hove') >= 0) return true;
if (lower.indexOf('london') >= 0) return true;
if (lower.indexOf('gatwick') >= 0) return true;
if (lower.indexOf('croydon') >= 0) return true;
if (lower.indexOf('haywards') >= 0) return true;
return false;
}

function parseXml(xml, type) {
var trains = [];
var parts = xml.split('service>');
for (var i = 0; i < parts.length; i++) {
var sv = parts[i];
if (sv.indexOf(':sta>') < 0 && sv.indexOf(':std>') < 0) continue;
if (sv.toLowerCase().indexOf('iscancelled>true') >= 0) continue;
var sta = getVal(sv, 'sta');
var eta = getVal(sv, 'eta');
var std = getVal(sv, 'std');
var etd = getVal(sv, 'etd');
var sch = sta || std;
var et = eta || etd;
var bt = sch;
if (et && et !== 'On time' && et !== 'Delayed' && et.indexOf(':') >= 0) bt = et;
var tm = pTime(bt);
if (!tm) continue;
var origBlock = sv.indexOf(':origin>');
var destBlock = sv.indexOf(':destination>');
var fr = '?';
var to = '?';
if (origBlock >= 0) {
var origChunk = sv.substring(origBlock, origBlock + 200);
fr = getVal(origChunk, 'locationName') || '?';
}
if (destBlock >= 0) {
var destChunk = sv.substring(destBlock, destBlock + 200);
to = getVal(destChunk, 'locationName') || '?';
}
var dir = 'east';
if (type === 'a') {
if (isEastOrigin(fr)) dir = 'west';
} else {
if (isEastOrigin(to)) dir = 'east';
else dir = 'west';
}
var dl = 0;
if (et && et.indexOf(':') >= 0 && sch) {
var e2 = pTime(et);
var s2 = pTime(sch);
if (e2 && s2) dl = Math.round((e2 - s2) / 60000);
}
trains.push({fr:fr, to:to, tm:tm, dir:dir, dl:dl, tp:type, k:(sch||'')+dir});
}
return trains;
}

async function getTrains() {
var all = [];
var types = ['a', 'd'];
for (var i = 0; i < 2; i++) {
try {
var r = new Request(WURL);
r.method = 'POST';
r.headers = {'Content-Type':'application/soap+xml;charset=utf-8'};
r.body = soap(types[i]);
var xml = await r.loadString();
var parsed = parseXml(xml, types[i]);
for (var p = 0; p < parsed.length; p++) {
all.push(parsed[p]);
}
} catch(e) { console.log(e); }
}
var map = {};
for (var j = 0; j < all.length; j++) {
var t = all[j];
if (!map[t.k] || (t.tp === 'a' && map[t.k].tp !== 'a')) map[t.k] = t;
}
var res = Object.values(map);
res.sort(function(a,b){return a.tm - b.tm;});
return res;
}

function closures(trains) {
if (!trains.length) return [];
var per = [];
var cs = null;
var ce = null;
for (var i = 0; i < trains.length; i++) {
var cl = new Date(trains[i].tm.getTime() - CLOSE_BEFORE * 60000);
var op = new Date(trains[i].tm.getTime() + OPEN_AFTER * 60000);
if (cs === null) { cs = cl; ce = op; }
else if (cl.getTime() - ce.getTime() <= GAP * 60000) { ce = new Date(Math.max(ce.getTime(), op.getTime())); }
else { per.push({s:cs, e:ce}); cs = cl; ce = op; }
}
if (cs) per.push({s:cs, e:ce});
return per;
}

var trains = [];
var live = false;
try {
trains = await getTrains();
live = trains.length > 0;
} catch(e) {}

var now = new Date();
var per = closures(trains);
var st = 'OPEN';
var msg = 'No closures expected';
var nc = null;
var no = null;
var cur = null;
var up = null;

for (var i = 0; i < per.length; i++) {
if (now >= per[i].s && now <= per[i].e) { cur = per[i]; break; }
if (per[i].s > now && !up) up = per[i];
}

if (cur) {
st = 'CLOSED';
no = cur.e;
msg = 'Opens ~' + cd(no - now);
} else if (up) {
var ms = up.s - now;
nc = up.s;
no = up.e;
if (ms <= 180000) { st = 'SOON'; msg = 'Closing ~' + cd(ms); }
else { msg = 'Next close ' + cd(ms); }
}

var nxt = trains.filter(function(t){return t.tm > now;}).slice(0,3);
var w = new ListWidget();
w.setPadding(12, 14, 12, 14);

var bg = '#052E16';
if (st === 'CLOSED') bg = '#7F1D1D';
if (st === 'SOON') bg = '#78350F';
var g = new LinearGradient();
g.colors = [new Color(bg), new Color('#0F172A')];
g.locations = [0, 0.5];
w.backgroundGradient = g;

var h = w.addStack();
h.layoutHorizontally();
h.centerAlignContent();
var ht = h.addText('Portslade');
ht.font = Font.semiboldSystemFont(11);
ht.textColor = new Color('#94A3B8');
h.addSpacer();
var lb = h.addText(live ? 'LIVE' : 'OFFLINE');
lb.font = Font.mediumSystemFont(9);
lb.textColor = new Color(live ? '#6EE7B7' : '#FCA5A5');

w.addSpacer(6);

var sl = 'CLEAR';
if (st === 'CLOSED') sl = 'BARRIERS DOWN';
if (st === 'SOON') sl = 'CLOSING SOON';
var mtt = w.addText(sl);
mtt.font = Font.boldSystemFont(18);
mtt.textColor = Color.white();
mtt.minimumScaleFactor = 0.7;

w.addSpacer(2);
var mg = w.addText(msg);
mg.font = Font.mediumSystemFont(13);
mg.textColor = new Color('#E2E8F0');

if (nc || no) {
w.addSpacer(6);
var ts = w.addStack();
ts.layoutHorizontally();
if (nc) {
var cst = ts.addStack();
cst.layoutVertically();
var c1 = cst.addText('CLOSES');
c1.font = Font.mediumSystemFont(8);
c1.textColor = new Color('#94A3B8');
var c2 = cst.addText(fmt(nc));
c2.font = Font.semiboldSystemFont(12);
c2.textColor = new Color('#FCD34D');
}
ts.addSpacer();
if (no) {
var ost = ts.addStack();
ost.layoutVertically();
var o1 = ost.addText('OPENS');
o1.font = Font.mediumSystemFont(8);
o1.textColor = new Color('#94A3B8');
var o2 = ost.addText(fmt(no));
o2.font = Font.semiboldSystemFont(12);
o2.textColor = new Color('#6EE7B7');
}
ts.addSpacer();
var us = ts.addStack();
us.layoutVertically();
var u1 = us.addText('UPDATED');
u1.font = Font.mediumSystemFont(8);
u1.textColor = new Color('#94A3B8');
var u2 = us.addText(fmt(now));
u2.font = Font.semiboldSystemFont(12);
u2.textColor = new Color('#94A3B8');
}

if (config.widgetFamily !== 'small' && nxt.length > 0) {
w.addSpacer(8);
var dv = w.addStack();
dv.size = new Size(0, 1);
dv.backgroundColor = new Color('#334155');
w.addSpacer(6);
for (var k = 0; k < nxt.length; k++) {
var tr = nxt[k];
var rw = w.addStack();
rw.layoutHorizontally();
rw.centerAlignContent();
rw.spacing = 6;
var ar = (tr.dir === 'east') ? '>' : '<';
var dc = (tr.dir === 'east') ? '#38BDF8' : '#FB923C';
var dt = rw.addText(ar);
dt.font = Font.boldSystemFont(12);
dt.textColor = new Color(dc);
var rt = rw.addText(tr.fr + ' > ' + tr.to);
rt.font = Font.mediumSystemFont(10);
rt.textColor = new Color('#CBD5E1');
rt.lineLimit = 1;
rw.addSpacer();
var tt = rw.addText(fmt(tr.tm));
tt.font = Font.semiboldSystemFont(11);
tt.textColor = Color.white();
if (tr.dl > 0) {
var dy = rw.addText('+' + tr.dl);
dy.font = Font.boldSystemFont(9);
dy.textColor = new Color('#FCD34D');
}
w.addSpacer(2);
}
}

w.addSpacer();
w.refreshAfterDate = new Date(now.getTime() + 300000);

if (config.runsInWidget) {
Script.setWidget(w);
} else {
await w.presentMedium();
}
Script.complete();

}
await main();


