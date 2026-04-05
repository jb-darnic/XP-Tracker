/// <reference path="/runeappslib.js">
/// <reference path="/alt1lib.js">
/// <reference path="/imagelibs/xpcounter.js">

"use strict";

//==== state =====
var hist = {};
var reader = new XpcounterReader.XpcounterReader();
var measuretime = 0;
var graphtime = 0;
var currenttime = 0;
var trackedxp = 0;
var measurestart = Date.now();
var lastdraw = 0;
var lastchange = 0;

var lastgraphstart = 0;
var lastgraphend = 0;
var lastgraphskill="";

//===== interface state ====
var showbreakdown = false;
var xpdropdownopen = false;
var volumetest = false;
var menubox = null;
var findfails = 0;

//===== tooltip =====
var tooltiptimeout = null;
var tooltiptime = 0;
var tooltipout = false;
var timedragging = false;
var lastwindoww = 0;
var lastwindowh = 0;

//settings
var mode = localStorage.xpmeter_mode == "start" ? "start" : "fixed";// fixed || start
var fixedtime = +localStorage.xpmeter_sampletime || 1000 * 60 * 10;//10min
var repeatalarm = (localStorage.xpmeter_repeatalarm ? localStorage.xpmeter_repeatalarm == "true" : false);
var alertvolume = (localStorage.xpmeter_volume ? +localStorage.xpmeter_volume : 0.5);
var skillid = "";

//==== constants ====
var deletetime = 1000 * 60 * 60 * 4;//remember xp rates for 2hrs
var cnv = null;
var ctx = null;
var intervalsnaps = [1, 2, 5, 10, 20, 30, 45, 60, 120];

function maybeel(id) {
	return document.getElementById(id);
}

function settext(id, text) {
	var el = maybeel(id);
	if (el) { el.textContent = text; }
}

function prettySkillName(skill) {
	if (!skill) { return "RuneMetrics Live"; }
	if (skill == "com") { return "Combat"; }
	var index = skillnames.indexOf(skill);
	if (index != -1 && typeof fullskillnames != "undefined" && fullskillnames[index]) {
		return fullskillnames[index];
	}
	return skill.toUpperCase();
}

function describeMode() {
	if (mode == "fixed") { return "Fixed " + Math.round(fixedtime / 60000) + "m"; }
	return "Since start";
}

function describeAlert() {
	if (tooltiptime == 0) { return "Never"; }
	if (tooltipout) { return "Check RS"; }
	return tooltiptime / 1000 + "s idle";
}

function setPanelState(state, label) {
	var el = maybeel("statuspill");
	if (el) {
		el.className = "panelpill " + state;
		el.textContent = label;
	}
	if (document.body) { document.body.setAttribute("data-state", state); }
}

function syncStatusState() {
	if (reader.searching) { setPanelState("searching", "Scanning"); return; }
	if (!reader.pos) { setPanelState("warning", "Needs scan"); return; }
	if (tooltipout) { setPanelState("alert", "Idle alert"); return; }
	if (reader.rounded) { setPanelState("warning", "Rounded values"); return; }
	setPanelState("ready", "Live");
}

function syncPanelChrome() {
	settext("selectedskill", prettySkillName(skillid || (reader.skills && reader.skills[0])));
	settext("modepill", describeMode());
	settext("alertstatus", describeAlert());
	toggleclass("breakbutton", "active", showbreakdown);
	toggleclass("breakdowncancel", "hidden", !trackedxp);
}

function syncPanelFocus(text) {
	settext("trackedxp", text || "No focus");
	toggleclass("trackedxp", "hidden", !text);
	toggleclass("breakdowncancel", "hidden", !trackedxp);
}

function start() {
	a1lib.identifyUrl("./appconfig.json");
	cnv = elid("cnv");
	ctx = cnv.getContext("2d");
	syncPanelChrome();
	syncStatusState();
	drawGraphEmpty("Scanning for the RuneMetrics panel...");
	lastwindoww = window.innerWidth;
	lastwindowh = window.innerHeight;
	window.addEventListener("resize", resize);
	setInterval(function () {
		if (window.innerWidth != lastwindoww || window.innerHeight != lastwindowh) {
			lastwindoww = window.innerWidth;
			lastwindowh = window.innerHeight;
			resize();
		}
	}, 300);
	resize();

	startFindCounter();
	setInterval(tick, 1000);
	tick();
}

function startFindCounter() {
	if (!reader.searching) { reader.pos = null;}
	reader.findAsync(function () {
		reader.read();
		var found = false;
		for (var a in reader.skills) { if (reader.values[a] > 0) { found = true; } }
		if (!found) { reader.pos = null; }

		if (!reader.pos) { findfails++; if (findfails >= 2) { findcounterError(); } }
		else { findfails = 0; }

		if (reader.pos) { reader.showPosition(); }
		if (reader.rounded) { xpcounterRoundError();}
		tick();
	});
	tick();
}

function tick() {
	if (!reader.pos) {
		syncPanelChrome();
		settext("selectedskill", reader.searching ? "Scanning RuneMetrics" : "RuneMetrics Live");
		settext("gainvalue", "0 xp");
		syncPanelFocus(trackedxp ? "Watching " + trackedxp.toFixed(1) + " xp" : "");
		syncStatusState();
		if (reader.searching) {
			settext("xpoutput", "Scanning RuneMetrics");
			drawGraphEmpty("Scanning for the RuneMetrics panel...");
		}
		else {
			settext("xpoutput", "Open RuneMetrics");
			drawGraphEmpty("Open the in-game RuneMetrics panel to begin.");
		}
		setskillicon(-1);
		return;
	}

	currenttime = Date.now();
	fixintervals();
	reader.read();
	if (!skillid && reader.skills[0]) { skillid = reader.skills[0];}
	for (var a in hist) { hist[a].visible = false; }
	for (var a = 0; a < reader.skills.length; a++) {
		if (!reader.skills[a]) { continue; }
		if (reader.values[a] == -1) { continue; }
		skillread(reader.skills[a], reader.values[a], currenttime);
		if (hist[reader.skills[a]]) { hist[reader.skills[a]].visible = true; }
	}

	drawmeter();
	drawgraph();
	fixtooltip();
}

function skillread(skill, xp, time) {
	if (!hist[skill]) {
		hist[skill] = { id: skill, offcount: 0, data: [], visible: true };
	}
	var obj = hist[skill];
	var last = obj.data[obj.data.length - 1];
	if (!last) { last = { xp: 0, time: 0 }; }

	var dxp = xp - last.xp;
	if (dxp == 0) { return; }

	var expected = dxp > 0 && dxp < 200000;//expected change is positive and below 100k
	if (last.xp == 0 || obj.offcount > 10 || expected) {

		//make previous records relative to new counter value (after counter reset or glitch)
		if (!expected && dxp != 0) {
			qw(skill + " reset, d=" + dxp);
			for (var b = 0; b < obj.data.length; b++) { obj.data[b].xp += dxp; }
		}

		obj.data.push({ xp: xp, time: time });
		obj.offcount = 0;
	}
	else {
		obj.offcount++;
	}

	if (skill == skillid && dxp != 0) { lastchange = currenttime; }
}

function drawmeter() {
	var histobj = hist[skillid];
	syncPanelChrome();
	if (!histobj) {
		settext("xpoutput", "0 xp/hr");
		settext("gainvalue", "0 xp");
		settext("timer", displaytime(measuretime));
		syncPanelFocus(trackedxp ? "Watching " + trackedxp.toFixed(1) + " xp" : "");
		syncStatusState();
		setskillicon(skillid);
		return;
	}

	var rate = calcmeter(histobj.data, trackedxp != 0 || showbreakdown, currenttime);
	var clusters = rate.clusters;
	var xprate = rate.xprate;
	var totalmass = 0;
	for (var a = 0; a < clusters.length; a++) { totalmass += clusters[a].mass; }

	var str = "";
	for (var a = 0; a < clusters.length; a++) {
		var width = (totalmass ? Math.max(8, Math.round(clusters[a].mass / totalmass * 100)) : 0);
		str += "<div class='breakdownrow'>";
		str += "<div class='breakdownbar' style='width:" + width + "%'></div>";
		str += "<div class='breakdownmain'>";
		str += "<div class='breakdownxp'>" + clusters[a].xp.toFixed(1) + " xp</div>";
		str += "<div class='breakdownmass'>" + spacednr(Math.round(clusters[a].mass)) + " xp total</div>";
		str += "</div>";
		str += "<div class='breakdownamount'>" + clusters[a].n + "x</div>";
		str += "<div class='breakdownview' onclick='trackxp(" + clusters[a].xp + ");' title='Focus this xp drop'></div>";
		str += "</div>";
	}
	if (!str) { str = "<div class='breakdownempty'>No clear XP drops yet in this window.</div>"; }
	elid("breakdowninner").innerHTML = str;

	var focustext = "";
	if (trackedxp) {
		focustext = "Watching " + trackedxp.toFixed(1) + " xp";
		for (var a = 0; a < clusters.length; a++) {
			if (Math.abs(clusters[a].xp - trackedxp) < trackedxp / 50 + 1) {
				focustext = clusters[a].n + "x " + trackedxp.toFixed(1) + " xp";
				break;
			}
		}
	}
	syncPanelFocus(focustext);

	settext("gainvalue", spacednr(Math.round(rate.xpgain)) + " xp");
	settext("timer", displaytime(measuretime));
	syncStatusState();
	if (!timedragging) {
		settext("xpoutput", spacednr(xprate) + " xp/hr");
		setskillicon(skillid);
	}

	if (xpdropdownopen) { drawxpselect(); }
	if (menubox) { menubox.drawskills(); }
	lastdraw = currenttime;
}

function drawxpselect() {
	var str = "";
	for (var a in hist) {
		var obj = hist[a];
		if (!obj.visible) { continue; }
		if (obj.id == skillid) { continue; }

		str += "<div class='xpdropdownopt' onclick='setcounter(\"" + obj.id + "\");'>";
		str += "<div class='xpdropdownleft'>";
		str += "<div class='xpdropdownimg' style='background-position:0px " + (-20 * iconoffset(obj.id)) + "px;'></div>";
		str += "<span class='xpdropdownname'>" + prettySkillName(obj.id) + "</span>";
		str += "</div>";
		str += "<span class='xpdropdownrate'>" + spacednr(calcmeter(obj.data, false, currenttime).xprate) + " xp/hr</span>";
		str += "</div>";
	}
	elid("xpdropdown").innerHTML = str;
}

function calcmeter(hist, doclusters, time) {
	var xpgain = 0;
	var clusters = [];
	var measurestart = time - measuretime;
	var deletestart = time - deletetime;
	for (var a = 0; a < hist.length; a++) {
		var last = hist[a == 0 ? 0 : a - 1];
		var pnt = hist[a];
		if (pnt.time < deletestart) { hist.splice(a, 1); a--; continue; }
		if (pnt.time < measurestart) { continue; }

		var dxp = pnt.xp - last.xp;
		xpgain += dxp;

		//clustering xp drops
		if (doclusters && dxp >= 1) {
			var c = false;//found in existing cluster
			for (var b in clusters) {
				if (Math.abs(clusters[b].xp - dxp) < dxp / 50 + 1) {
					clusters[b].n++;
					clusters[b].mass += dxp;
					clusters[b].xp = (clusters[b].xp * (clusters[b].n - 1) + dxp) / clusters[b].n;
					c = true;
					break;
				}
			}
			if (!c) { clusters.push({ n: 1, xp: dxp, mass: dxp }); }
		}
	}
	if (doclusters) {
		clusters.sort(function (a, b) { return a.xp - b.xp; });
		//merge uncommon clusters into their components
		for (a = clusters.length - 1; a >= 0; a--) {//reverse itereration to prevent problem with deleting indexes, also makes it start at the largest xp to allow cascading
			combinecluster(clusters[a].xp, clusters[a], clusters, 0);
		}
		clusters.sort(function (a, b) { return b.n - a.n; });
	}
	var xprate = xpgain * 1000 * 60 * 60 / measuretime;
	return { xpgain: xpgain, xprate: xprate, clusters: clusters };
}

function combinecluster(xp, cl, cls, layer) {
	if (xp < 5) { return false; }
	if (layer > 2) { return false; }

	for (var b = cls.indexOf(cl) ; b >= 0; b--) {
		if (cls[b].n / 7 < cl.n) { continue; }//only allow merging if the merger has more than 7x as much points
		var c = Math.round(xp / cls[b].xp);

		if (Math.abs(c * cls[b].xp - xp) < xp / 50 + 1) {
			cls[b].n += c * cl.n;
			cls[b].mass += c * xp;
			cls.splice(cls.indexOf(cl), 1);
			return true;
		}
	}
}

function fixintervals() {
	if (mode == "fixed") { measuretime = fixedtime; }
	if (mode == "start") { measuretime = currenttime - measurestart; }
	measuretime = Math.min(measuretime, deletetime);
	graphtime = 300;
	while (measuretime / 80 > graphtime) { graphtime *= 2; }
}

function setskillicon(skillid) {
	var newid = (typeof skillid == "string" ? iconoffset(skillid) : skillid);
	if (newid == -1) {
		elid("xpskillicon").style.display = "none";
	}
	else {
		elid("xpskillicon").style.backgroundPosition = "0px " + (-28 * newid) + "px";
		elid("xpskillicon").style.display = "";
	}
}

function displaytime(time) {
	var a, s, m, h;
	time = Math.floor(time / 1000);
	s = time % 60;
	m = Math.floor(time / 60 % 60);
	h = Math.floor(time / 60 / 60 % (60 * 60));

	if (h == 0) { return m + (s % 2 == 0 ? ":" : " ") + addzeros(s, 2); }
	return h + (s % 2 == 0 ? ":" : " ") + addzeros(m, 2) + (s % 2 == 0 ? ":" : " ") + addzeros(s, 2);
}

function iconoffset(skillid) {
	var index = skillnames.indexOf(skillid);
	if (skillid == "com") { index = 31; }
	return index;
}

function clickxp() {
	xpdropdownopen = !xpdropdownopen;

	if (!reader.pos) {
		startFindCounter();
		xpdropdownopen = false;
	}

	toggleclass("xpoutputinner", "active", xpdropdownopen);
	if (xpdropdownopen) { drawxpselect(); }
}

function togglebreak(show) {
	if (show == null) { show = !showbreakdown; }
	showbreakdown = show; 
	toggleclass("cnvcontainer", "showbd", showbreakdown);
	toggleclass("breakbutton", "active", showbreakdown);
	drawmeter();
	drawgraph(true);
	setTimeout(function () { drawgraph(true); }, 280);
}

function trackxp(xp) {
	trackedxp = xp;
	toggleclass("trackedxp", "hidden", !xp);
	togglebreak(false);
	drawmeter();
}

function setcounter(id) {
	skillid = id;
	xpdropdownopen = false;
	toggleclass("xpoutputinner", "active", false);
	drawmeter();
	drawgraph(true);
}

function resize() {
	lastwindoww = window.innerWidth;
	lastwindowh = window.innerHeight;
	var dropdown = maybeel("xpdropdown");
	if (dropdown) {
		var bounds = elid("xpoutputinner").getBoundingClientRect();
		dropdown.style.maxHeight = Math.max(140, window.innerHeight - bounds.bottom - 24) + "px";
	}
	drawgraph(true);
}

function drawGraphEmpty(message) {
	if (!ctx || !cnv) { return; }
	var w = cnv.offsetWidth;
	var h = cnv.offsetHeight;
	if (w < 20 || h < 20) { return; }
	cnv.style.visibility = "visible";
	cnv.width = w;
	cnv.height = h;

	var bg = ctx.createLinearGradient(0, 0, 0, h);
	bg.addColorStop(0, "rgba(27,38,52,0.96)");
	bg.addColorStop(1, "rgba(9,14,20,0.98)");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);

	ctx.strokeStyle = "rgba(255,255,255,0.05)";
	ctx.lineWidth = 1;
	ctx.setLineDash([5, 8]);
	for (var a = 1; a < 4; a++) {
		var y = 12 + (h - 24) * a / 4;
		ctx.beginPath();
		ctx.moveTo(12, y);
		ctx.lineTo(w - 12, y);
		ctx.stroke();
	}
	ctx.setLineDash([]);

	ctx.fillStyle = "rgba(153,163,173,0.82)";
	ctx.font = '12px "Segoe UI Variable Text", "Trebuchet MS", sans-serif';
	ctx.textAlign = "center";
	ctx.fillText(message, w / 2, h / 2);
}

function drawgraph(isResizing) {
	if (!ctx) { return; }
	var w = cnv.offsetWidth;
	var h = cnv.offsetHeight;
	if (h < 20 || w < 20) { cnv.style.visibility = "hidden"; return; }
	else { cnv.style.visibility = "visible"; }
	if (!hist[skillid]) { drawGraphEmpty(skillid ? "Waiting for new XP changes..." : "Earn some XP to populate the graph."); return; }

	var startx = floorx(currenttime - measuretime, graphtime);
	var endx = floorx(currenttime - graphtime, graphtime);
	if (!isResizing && startx == lastgraphstart && endx == lastgraphend && skillid == lastgraphskill) { return;}
	cnv.width = w;
	cnv.height = h;

	var data = calcGraph(hist[skillid], startx, endx, graphtime);
	var graph = data.graph;
	if (!graph.length) { drawGraphEmpty("Waiting for new XP changes..."); return; }

	var min = 0;//bind to 0 for now
	var max = Math.max(data.max, 1);
	var top = 20;
	var right = 14;
	var bottom = 24;
	var left = 14;
	var plotw = Math.max(1, w - left - right);
	var ploth = Math.max(1, h - top - bottom);
	var baseline = top + ploth;

	var bg = ctx.createLinearGradient(0, 0, 0, h);
	bg.addColorStop(0, "rgba(30,43,58,0.94)");
	bg.addColorStop(1, "rgba(9,14,20,0.98)");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);

	ctx.strokeStyle = "rgba(255,255,255,0.06)";
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 7]);
	for (var g = 0; g < 4; g++) {
		var gy = top + ploth * g / 3;
		ctx.beginPath();
		ctx.moveTo(left, gy);
		ctx.lineTo(w - right, gy);
		ctx.stroke();
	}
	ctx.setLineDash([]);

	ctx.fillStyle = "rgba(153,163,173,0.84)";
	ctx.font = '11px "Segoe UI Variable Text", "Trebuchet MS", sans-serif';
	ctx.textAlign = "left";
	ctx.fillText(prettySkillName(skillid), left, 14);
	ctx.textAlign = "right";
	ctx.fillText("Peak " + spacednr(Math.round(max)) + " xp", w - right, 14);

	var getx = function (point) {
		return left + (point.t - startx) / Math.max(endx - startx, 1) * plotw;
	};
	var gety = function (point) {
		return top + (1 - (point.v - min) / Math.max(max - min, 1)) * ploth;
	};

	ctx.beginPath();
	ctx.moveTo(getx(graph[0]), baseline);
	for (var a in graph) {
		ctx.lineTo(getx(graph[a]), gety(graph[a]));
	}
	ctx.lineTo(getx(graph[graph.length - 1]), baseline);
	ctx.closePath();
	var fill = ctx.createLinearGradient(0, top, 0, baseline);
	fill.addColorStop(0, "rgba(230,195,106,0.28)");
	fill.addColorStop(1, "rgba(230,195,106,0.02)");
	ctx.fillStyle = fill;
	ctx.fill();

	ctx.strokeStyle = "rgba(230,195,106,0.14)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(left, baseline);
	ctx.lineTo(w - right, baseline);
	ctx.stroke();

	ctx.strokeStyle = "#e6c36a";
	ctx.lineWidth = 2.5;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.shadowColor = "rgba(230,195,106,0.25)";
	ctx.shadowBlur = 12;
	ctx.beginPath();
	for (var a in graph) {
		var px = getx(graph[a]);
		var py = gety(graph[a]);
		if (+a == 0) { ctx.moveTo(px, py); }
		else { ctx.lineTo(px, py); }
	}
	ctx.stroke();
	ctx.shadowBlur = 0;

	var lastpoint = graph[graph.length - 1];
	ctx.fillStyle = "#f3d88a";
	ctx.beginPath();
	ctx.arc(getx(lastpoint), gety(lastpoint), 3.2, 0, Math.PI * 2);
	ctx.fill();

	lastgraphstart = startx;
	lastgraphend = endx;
	lastgraphskill=skillid;
}

function calcGraph(counter, startx, endx, graphstep) {
	var min = Infinity;
	var max = -Infinity;

	var graph = [];
	var last = -1;
	var lastindex = 0;
	for (var a = 0; a < counter.data.length; a++) {
		var pnt = counter.data[a];
		if (pnt.time > startx && last != -1) { break; }
		last = pnt.xp;
		lastindex = a;
	}
	for (var bound = startx; bound <= endx; bound += graphstep) {
		var b = last;
		for (var a = lastindex; a < counter.data.length; a++) {
			var pnt = counter.data[a];
			if (pnt.time <= bound) { continue; }
			if (pnt.time > bound + graphstep) { break; }
			b = pnt.xp;
			lastindex = 0;
		}
		b -= last;
		last = last + b;
		if (b > max) { max = b; }
		if (b < min) { min = b; }
		graph.push({ t: bound, v: b });
	}
	return { graph: graph, min: min, max: max, step: graphstep };
}

function setMode(newmode){
	mode = newmode;
	localStorage.xpmeter_mode = newmode;
	fixintervals();
	drawmeter();
	drawgraph();
}

function clicktimer() {
	setMode(mode == "fixed" ? "start" : "fixed");
}
function doubleclicktimer() {
	measurestart = currenttime - 1;
	mode = "start";
	localStorage.xpmeter_mode = mode;
	fixintervals();
	drawmeter();
	drawgraph();
}

function showHelp() {
	var box = promptbox2({ title: "XP Tracker help", width: Math.min(380, Math.max(300, window.innerWidth - 24)), style: "fakepopup" }, [
		{ t: "text", text: "1. Open the RuneMetrics XP panel in RuneScape so Alt1 can read the skill rows and XP values." },
		{ t: "text", text: "2. If scanning fails, click Menu and use 'Search interface' while the panel is visible on screen." },
		{ t: "text", text: "3. The timer toggles between a fixed sample window and a session-since-start view." },
		{ t: "text", text: "4. Drag the AFK threshold slider to control when the idle warning tooltip and sound trigger." },
		{ t: "text", text: "5. Open Breakdown to inspect common XP drops and click one to focus that value." },
		{ t: "button", text: "Close", onclick: function () { box.frame.close(); } }
	]);
}

function showMenu() {
	if (menubox) { menubox.frame.close(); menubox = null; return;}

	var skillopts = eldiv({style:"min-height:70px; overflow:hidden;"});
	var pausedraw = false;
	skillopts.onmousedown = function () { pausedraw = true; }
	skillopts.onmouseup = function () { pausedraw = false; }
	var drawskills = function () {
		if (pausedraw) { return;}
		elclear(skillopts);
		for (var a in hist) {
			if (!hist[a].visible) { continue; }
			var last = hist[a].data[hist[a].data.length - 1];
			var inputel = eldiv(":input/radio", { name: "skill" });
			inputel.onchange = function (skill) { setcounter(skill); }.b(a);
			inputel.checked = a == skillid;
			skillopts.appendChild(eldiv("pb2-radio:label",[
				inputel,
				eldiv("skillimg:span", { style: "background-position:0px " + iconoffset(a) * -18 + "px;" }),
				spacednr(last.xp)+" xp"
			]));
		}
	}
	drawskills();

	var resetstarttime = function () {
		measurestart = currenttime - 1;
		fixintervals();
		drawmeter();
		drawgraph();
	}

	var inputfixedtime = function (v) {
		fixedtime = v * 1000 * 60;
		fixintervals();
		drawmeter();
		drawgraph();
		localStorage.xpmeter_sampletime = fixedtime;
	}
	
	var drawalert = function () {
		box.alertenabled.setValue(tooltiptime != 0);
		box.alertsub.setLocked(tooltiptime == 0);
		if(tooltiptime!=0){box.alerttime.setValue(tooltiptime);}
	}

	var alerttimeout = null;
	var changealert = function () {
		if (!box.alertenabled.getValue()) { tooltiptime = 0; }
		else { tooltiptime = box.alerttime.getValue(); }
		timedraginner(tooltiptime);
		fixtooltip();

		timedragging = true;
		if (alerttimeout) { clearTimeout(alerttimeout); }
		alerttimeout = setTimeout(function () { timedragging = false; drawalert(); }, 2000);
	}

	var inputvolume = function (v) {
		setalarmrepeat(true, null);
		elid('alerter').play();
		setvolume(v / 100);
	}

	var buttons = [
		//==== tracking mode =====
		{ t: "header", text: "Tracking mode" },
		{ t: "radio/time", v: "fixed", text: "Fixed sample duration" },
		{ t: "subregion/1:fixedmode", locked: mode != "fixed" },
		{ t: "slider:duration", oninput: inputfixedtime, snaps: intervalsnaps, v: fixedtime / 1000 / 60, text: "Duration: %s min" },
		{ t: "radio/time", v: "start", text: "Fixed starting point" },
		{ t: "subregion/1:startmode", locked: mode != "start" },
		{ t: "button", text: "Reset start point", onclick: resetstarttime },

		//==== input mode ====
		{ t: "header", text: "Input mode" },
		{ t: "button", text: "Search interface", onclick: startFindCounter },
		{ t: "custom", dom: skillopts },

		//==== xp alert ====
		{ t: "header", text: "Afk alert" },
		{ t: "text", text: "This option will warn you when you havn't gained xp in a set amount of time. Consider using the Afk Warden app for more advanced afk warnings." },
		{ t: "bool:alertenabled", text: "Enable xp alert", onchange: changealert },
		{ t: "subregion/3:alertsub" },
		{ t: "slider:alerttime", min: 1200, max: 18000, step: 600, v: tooltiptime || 1200, oninput: changealert, text: v=>"Alert after " + v / 1000 + " sec" },
		{ t: "slider:alertvolume", min: 0, max: 100, v: alertvolume * 100, oninput: inputvolume, onchange: function () { setalarmrepeat(false, null); }, text: "Volume: %s%" },
		{ t: "bool:alertrepeat", v: repeatalarm, onchange: function (v) { setalarmrepeat(null, box.alertrepeat.getValue()); }, text: "Repeat alarm" }
	];

	var box = promptbox2({
		title:"Settings",
		style: "fakepopup",
		width:Math.min(340, Math.max(300, window.innerWidth - 24)),
		onclose: function () { menubox = null; }
	}, buttons);
	box.time.setValue(mode);
	box.time.onchange = function (v) {
		box.fixedmode.setLocked(v != "fixed");
		box.startmode.setLocked(v != "start");
		setMode(v);
	}

	drawalert();

	box.drawskills = drawskills;
	box.drawalerts = drawalert;
	menubox = box;
}

function setvolume(vol) {
	alertvolume = vol;
	var amplitude = vol * vol;// (vol == 0 ? 0 : Math.pow(10, vol) / 10);
	elid("alerter").volume = amplitude;
	localStorage.xpmeter_volume = vol;
}

function setalarmrepeat(test, repeat) {
	if (typeof test == "boolean") { volumetest = test; }
	if (typeof repeat == "boolean") { repeatalarm = repeat; localStorage.xpmeter_repeatalarm = "" + repeat; }
	elid("alerter").loop = test || repeat;
}

function fixtooltip() {
	var next = lastchange + tooltiptime;
	if (tooltiptimeout) { clearTimeout(tooltiptimeout); }

	if (tooltiptime == 0) {
		if (tooltipout) {
			alt1.clearTooltip();
			if (!volumetest) { elid("alerter").pause(); elid("alerter").currentTime = 0; }
			tooltipout = false;
		}
	}
	else if (next <= Date.now()) {
		if (!tooltipout) {
			alt1.setTooltip("Check your RS!");
			if (!volumetest) { elid("alerter").play(); }
			tooltipout = true;
		}
	}
	else {
		if (tooltipout) {
			alt1.clearTooltip();
			if (!volumetest) { elid("alerter").pause(); elid("alerter").currentTime = 0; }
			tooltipout = false;
		}
		tooltiptimeout = setTimeout(fixtooltip, next - Date.now() + 50);
	}
	syncPanelChrome();
	syncStatusState();
}

function timedragstart(e) {
	newdraghandler2(e, timedrag, timedragend);
	timedragging = true;
}

function timedrag(loc) {
	var bounds = elid("timerslidercontainer").getBoundingClientRect();
	var part = (loc.x - bounds.left) / (bounds.right - bounds.left);
	if (part > 1) { part = 1; }
	if (part < 0) { part = 0; }
	var time = 1200 + floorx(part * (18600-1200), 600);
	timedraginner(time);
}

function timedraginner(time) {
	if (time == 0) { time = 18600; }
	elid("timerslider").style.left = ((time - 1200) / (18600 - 1200) * 100) + "%";

	if (time == 18600) { time = 0; }

	tooltiptime = time;
	fixtooltip();
	if (menubox) { menubox.drawalerts(); }
}

function timedragend() {
	timedragging = false;
	drawmeter();
}

function findcounterError() {
	var box = promptbox2({ title: "Xpmeter error", width: Math.min(340, Math.max(300, window.innerWidth - 24)), style: "fakepopup" }, [
		{ t: "text", text: "Alt1 could not find the runemetrics interface on your screen. Make sure you have the xp counter interface open in-game, it should look similair to this image" },
		{ t: "h/11" },
		{ t: "button", text: "Help", onclick: function () { box.frame.close(); showHelp(); } },
		{ t: "button", text: "Try again", onclick: function () { startFindCounter(); box.frame.close(); } }
	]);
	//TODO merge the afkwarden page with this one?
}

function xpcounterRoundError() {
	if (localStorage.xpmeter_roundwarning=="true") { return;}
	var box = promptbox2({ title: "Xpmeter info", width: Math.min(340, Math.max(300, window.innerWidth - 24)), style: "fakepopup" }, [
		{ t: "text", text: "Your RuneMetrics interface is set to round xp to K or M. This settings makes xp tracking inaccurate. You can turn this settings off in the RuneMetrics settings under the 'Metrics' tab, there is a toggle to 'show precise values'." },
		{ t: "h/11" },
		{ t: "button", text: "Close", onclick: function () { box.frame.close(); } },
		{ t: "button", text: "Don't show again", onclick: function () { box.frame.close(); localStorage.xpmeter_roundwarning = "true"; } },
	]);

}
