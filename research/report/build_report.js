const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak, TableOfContents, LevelFormat, PositionalTab,
  PositionalTabAlignment, PositionalTabLeader
} = require("docx");
const fs = require("fs");

const ACCENT = "1F4E79";   // deep blue
const ACCENT2 = "2E74B5";
const LIGHT = "DCE6F1";
const GREY = "595959";

// ---------- helpers ----------
function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 30 })] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, bold: true, color: ACCENT2, size: 25 })] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 130, line: 276 }, alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, size: 22, ...opts })] });
}
function runs(children) {
  return new Paragraph({ spacing: { after: 130, line: 276 }, alignment: AlignmentType.JUSTIFIED, children });
}
function bullet(text, level = 0) {
  return new Paragraph({ numbering: { reference: "bl", level }, spacing: { after: 70, line: 268 },
    children: Array.isArray(text) ? text : [new TextRun({ text, size: 22 })] });
}
function b(text){ return new TextRun({ text, bold: true, size: 22 }); }
function t(text){ return new TextRun({ text, size: 22 }); }

// table cell
function cell(content, { header = false, w, shade } = {}) {
  const children = Array.isArray(content) ? content : [new Paragraph({
    spacing: { after: 0, line: 260 },
    children: [new TextRun({ text: content, bold: header, size: 20, color: header ? "FFFFFF" : "000000" })]
  })];
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: header ? ACCENT : (shade || "FFFFFF") },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children
  });
}
function table(headers, rows, widths) {
  const headerRow = new TableRow({ tableHeader: true,
    children: headers.map((hd, i) => cell(hd, { header: true, w: widths[i] })) });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((c, i) => cell(c, { w: widths[i], shade: ri % 2 ? LIGHT : "FFFFFF" }))
  }));
  return new Table({
    columnWidths: widths,
    width: { size: widths.reduce((a,b)=>a+b,0), type: WidthType.DXA },
    borders: {
      top:{style:BorderStyle.SINGLE,size:2,color:"BFBFBF"}, bottom:{style:BorderStyle.SINGLE,size:2,color:"BFBFBF"},
      left:{style:BorderStyle.SINGLE,size:2,color:"BFBFBF"}, right:{style:BorderStyle.SINGLE,size:2,color:"BFBFBF"},
      insideHorizontal:{style:BorderStyle.SINGLE,size:2,color:"BFBFBF"}, insideVertical:{style:BorderStyle.SINGLE,size:2,color:"BFBFBF"}
    },
    rows: [headerRow, ...bodyRows]
  });
}
function spacer(){ return new Paragraph({ spacing:{after:80}, children:[new TextRun({text:"",size:10})] }); }

const children = [];

// ---------- COVER ----------
children.push(new Paragraph({ spacing:{ before: 2600, after: 0 }, alignment: AlignmentType.CENTER,
  children:[new TextRun({ text:"Feasibility Study", bold:true, size:56, color:ACCENT })]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing:{after:60},
  children:[new TextRun({ text:"“Yelp for IELTS Test Centres”", size:34, color:ACCENT2 })]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing:{after:400},
  children:[new TextRun({ text:"A test-centre discovery & comparison app — Canada-first MVP", italics:true, size:24, color:GREY })]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing:{before:1400, after:20},
  children:[new TextRun({ text:"Prepared for: Zheng", size:22, color:GREY })]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing:{after:20},
  children:[new TextRun({ text:"Scope: Side project / portfolio  ·  Market: Canada", size:22, color:GREY })]}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER,
  children:[new TextRun({ text:"July 2026", size:22, color:GREY })]}));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ---------- TOC ----------
children.push(h1("Contents"));
children.push(new TableOfContents("Contents", { hyperlink:true, headingStyleRange:"1-2" }));
children.push(new Paragraph({ children:[new PageBreak()] }));

// ---------- 1. EXEC SUMMARY ----------
children.push(h1("1. Executive Summary"));
children.push(p("This study assesses the feasibility of building a “Yelp for IELTS” — a directory app that lets test-takers in Canada compare IELTS test centres by price, operator, rating, and appearance before booking. The concept is evaluated as a solo side project / portfolio build rather than a funded startup, so the emphasis is on build effort, data availability, and legal safety rather than valuation."));
children.push(runs([b("Verdict: Feasible as a portfolio project, with one hard constraint that must shape the design. "),
  t("The app is small enough to build solo in roughly 6–10 focused weekends. The dominant risk is not engineering — it is "),
  b("data rights"), t(". Ratings and reviews are the app’s core value, but the cleanest source (Google) legally forbids storing/caching that data, and the market itself is smaller and more consolidated than a country like India.")]));
children.push(h2("Key findings at a glance"));
children.push(table(
  ["Dimension","Finding","Signal"],
  [
    ["Market size","Canada is a mid-size IELTS market; IELTS competes directly with CELPIP and PTE Core for immigration. Fewer test-takers per city than India/China.","Amber"],
    ["Centre & price data","Operator, city and fee data is public on IDP and British Council sites; fees ~CAD $335–361. Easy to compile.","Green"],
    ["Ratings / reviews","The differentiator — but Google’s Places API forbids storing reviews; you must fetch live & attribute. Reddit data is sparse per centre.","Red"],
    ["Images","Google/Street View imagery is licence-restricted; safest is your own or user-submitted photos.","Amber"],
    ["Build effort","Standard map + list + detail CRUD app. No novel engineering. ~6–10 weekends solo.","Green"],
    ["Legal","Scraping review sites breaches ToS; API terms restrict caching. Solvable with the right architecture.","Amber"],
  ],
  [2600, 4900, 1500]
));
children.push(spacer());
children.push(runs([b("Recommendation: "), t("Build it, but design around the data-rights constraint from day one. Treat first-party ratings (your own scoring model + user reviews you own) as the product, and treat Google/third-party ratings as live-fetched, attributed context — never as stored data. Start with one metro (Toronto or Vancouver) to keep the dataset hand-curatable.")]));

// ---------- 2. PRODUCT CONCEPT ----------
children.push(h1("2. Product Concept"));
children.push(p("The app answers a real, narrow question that every test-taker asks: “Which centre should I book, and what will it be like?” Today that answer is scattered across the two operators’ booking sites, Google Maps reviews, and Reddit threads. The app consolidates it into one comparable view."));
children.push(h2("Core user stories (MVP)"));
children.push(bullet("As a test-taker, I can search centres near a city or postal code and see them on a map and as a list."));
children.push(bullet("For each centre I can see: operator (IDP or British Council), test format (paper / computer-delivered), price, an overall rating, and a representative photo."));
children.push(bullet("I can open a centre to read reviews and see what past candidates said about noise, staff, equipment, and check-in."));
children.push(bullet("I can filter/sort by price, rating, format, and distance."));
children.push(h2("What makes it more than a map"));
children.push(runs([t("Google Maps already shows centres and star ratings. The wedge is "),
  b("IELTS-specific structure"), t(": normalising price across operators, tagging paper vs computer-delivered, surfacing the attributes candidates actually care about (test-day noise, room comfort, ID-check speed), and — later — a composite score you own and control rather than a generic business rating.")]));

// ---------- 3. MARKET ----------
children.push(h1("3. Market Analysis — Canada"));
children.push(h2("3.1 Operators, format and price"));
children.push(runs([t("In Canada, IELTS is administered by "),
  b("two operators, IDP and the British Council"),
  t(", offered in both paper-based and computer-delivered formats. The fee is broadly the same for Academic and General Training and sits around "),
  b("CAD $335–361 before tax"),
  t(", varying slightly by city and rising ~5–10% recently in major cities due to operating costs. Fees, formats and city locations are all published openly on the operators’ sites, which makes the non-review data straightforward to compile.")]));
children.push(h2("3.2 The competitive reality: IELTS is one of three"));
children.push(runs([t("For Canadian immigration, IRCC accepts "),
  b("IELTS General Training, CELPIP-General, and PTE Core"),
  t(" and treats them identically — all convert to CLB levels with no preference. CELPIP (run by Paragon Testing) is Canadian-built and popular with PR applicants; PTE Core is growing fast on price and speed. This matters for the app in two ways:")]));
children.push(bullet("Addressable users who take IELTS specifically are a subset of all English-test-takers — many Canada-bound applicants pick CELPIP or PTE instead."));
children.push(bullet("There is a natural product expansion: a “compare test centres” app is more defensible if it eventually covers CELPIP and PTE centres too, not just IELTS."));
children.push(h2("3.3 Who the user is"));
children.push(table(
  ["Segment","Why they take IELTS","Value of the app"],
  [
    ["Study applicants","Universities/colleges often require IELTS Academic","High — first-timers, anxious, price-sensitive"],
    ["Immigration (PR/express entry)","IELTS GT is one accepted option","Medium — many defect to CELPIP/PTE"],
    ["Professional licensing","Nursing, engineering bodies","Medium — specific score needs"],
  ],
  [2500, 3300, 3200]
));
children.push(spacer());
children.push(runs([b("Read on market: Amber. "),
  t("Real demand exists and the pain (opaque, scattered info) is genuine, but Canada is a mid-size, consolidated market. This is a strength for a portfolio build — a hand-curatable dataset — and a limit for a venture-scale business. It fits the stated goal well.")]));

// ---------- 4. DATA FEASIBILITY ----------
children.push(h1("4. Data Feasibility — The Crux"));
children.push(p("The app has four data layers. Three are easy; the fourth — ratings and reviews — is the entire value proposition and also the hardest to source legally. This section is the most important in the study."));
children.push(table(
  ["Data layer","Best source","Difficulty","Notes"],
  [
    ["Centre list, operator, format, city","IDP + British Council sites (public)","Easy","Compile once, refresh occasionally. Small, stable set."],
    ["Price","Operator sites","Easy","Public; changes rarely. Store your own copy."],
    ["Location / map pin","Geocode addresses; store place_id","Easy","place_id is the one Google field you may store indefinitely."],
    ["Ratings & reviews","Google Places / Reddit / first-party","Hard","See constraint below — storage is restricted."],
    ["Images","Own photos / user uploads","Medium","Google/Street View imagery is licence-restricted."],
  ],
  [2500, 2200, 1300, 3000]
));
children.push(spacer());
children.push(h2("4.1 The ratings constraint (read this twice)"));
children.push(runs([b("Google’s Places API is the highest-quality rating source, but its terms forbid pre-fetching, caching, or storing Places content — including reviews and ratings — with one exception: place_id, which you may store indefinitely. "),
  t("Whenever you show a Google review you must display it live and attribute it (author name/photo and a link back to Google Maps). The reviews/ratings tier (“Enterprise + Atmosphere”) also costs about USD $40 per 1,000 requests, with only ~1,000 free Enterprise events/month.")]));
children.push(p("The practical implication: you cannot build a database of scraped Google star ratings and serve them as your own. You can, however, store each centre’s place_id and call Google live on the centre-detail page to render current ratings with attribution. That keeps you compliant but means Google data is context, not owned inventory."));
children.push(h2("4.2 Source-by-source assessment"));
children.push(table(
  ["Source","Can you store it?","Coverage per centre","Verdict"],
  [
    ["Google Places API","No (place_id only); live + attributed","High — most centres rated","Use live on detail pages"],
    ["Reddit","Practically, sparse & unstructured","Low — anecdotal, few per centre","Mine for qualitative colour"],
    ["Operator sites","Yes (facts, not reviews)","Facts only, no ratings","Backbone of the dataset"],
    ["First-party reviews","Yes — you own them","Zero at launch; grows","The long-term moat"],
  ],
  [2400, 2600, 2500, 1500]
));
children.push(spacer());
children.push(runs([b("Read on data: Red at launch, greenable by design. "),
  t("The naive version (a stored table of scraped star ratings) is non-compliant and fragile. The compliant version treats Google as a live, attributed widget and invests early in first-party reviews you actually own. A seed “score” can be computed transparently from public facts (format availability, price, capacity, operator) so centres aren’t blank before users arrive.")]));

// ---------- 5. TECHNICAL ----------
children.push(h1("5. Technical Feasibility & MVP Scope"));
children.push(p("Engineering is the low-risk part. This is a conventional map + directory + reviews CRUD app with no novel components. A solo developer can ship a credible MVP in roughly 6–10 weekends."));
children.push(h2("5.1 Suggested stack (portfolio-friendly)"));
children.push(table(
  ["Layer","Option","Why"],
  [
    ["Frontend","Next.js / React (web) or React Native","One codebase, strong portfolio signal, good maps support"],
    ["Maps","Google Maps JS or Mapbox","Mapbox is cheaper if you avoid Google’s review terms"],
    ["Backend / DB","Supabase or Firebase (Postgres)","Auth + DB + storage out of the box; fast for solo dev"],
    ["Ratings (Google)","Places API, called live","Compliant with no-cache rule; attribute on render"],
    ["Image storage","Supabase/Firebase Storage","Hosts your own & user-submitted photos"],
  ],
  [1900, 3100, 4000]
));
children.push(h2("5.2 Rough effort estimate"));
children.push(table(
  ["Milestone","What ships","Est. effort"],
  [
    ["M1 — Data & schema","Curate Toronto/Vancouver centres; schema; seed price/operator/format","1–2 weekends"],
    ["M2 — Core UI","Map + list + filters + centre detail page","2–3 weekends"],
    ["M3 — Ratings integration","Live Google ratings w/ attribution; seed composite score","1–2 weekends"],
    ["M4 — First-party reviews","Auth, submit review, moderation basics, photo upload","2–3 weekends"],
    ["M5 — Polish & deploy","Empty states, SEO, deploy, analytics","1 weekend"],
  ],
  [2300, 4700, 1900]
));
children.push(spacer());
children.push(runs([b("Read on tech: Green. "),
  t("Nothing here is hard or unproven. The scope is a clean, demonstrable full-stack project — exactly the kind that reads well in a portfolio.")]));

// ---------- 6. LEGAL ----------
children.push(h1("6. Legal & Compliance"));
children.push(bullet([b("No scraping of review platforms. "), t("Google, Reddit and similar prohibit scraping and re-hosting reviews. Use official APIs and honour their display/attribution rules.")]));
children.push(bullet([b("No caching of Google reviews/ratings. "), t("Store only place_id; fetch ratings live and show Google attribution + a link back to Maps.")]));
children.push(bullet([b("Images. "), t("Do not store Google/Street View photos. Use your own photos, operator press assets you have rights to, or user-submitted images with a clear upload licence.")]));
children.push(bullet([b("User-generated content. "), t("Add a lightweight ToS, a review policy, and takedown/moderation — defamatory reviews of a named business are a real (if low) risk.")]));
children.push(bullet([b("Trademarks. "), t("“IELTS”, “IDP” and “British Council” are trademarks. Use them descriptively (“find IELTS centres”), avoid implying endorsement, and pick a neutral product name.")]));
children.push(bullet([b("Privacy. "), t("If you collect accounts, a basic privacy policy and PIPEDA-aware handling of Canadian users’ data applies.")]));

// ---------- 7. MONETIZATION ----------
children.push(h1("7. Monetization (Light — Portfolio Context)"));
children.push(p("Monetization is secondary to the stated goal, but worth noting for completeness and for a stronger portfolio narrative:"));
children.push(bullet([b("Affiliate / referral: "), t("operators or prep providers may pay for booking referrals — the most natural fit.")]));
children.push(bullet([b("Lead-gen for prep: "), t("IELTS tutoring and prep courses are a large adjacent spend; contextual placement fits the audience.")]));
children.push(bullet([b("Freemium data: "), t("free directory, paid alerts (e.g. “notify me when a nearby date opens under $X”).")]));
children.push(p("None of these require scale to demonstrate as a concept; a single working affiliate link is enough to show the model in a portfolio piece."));

// ---------- 8. RISKS ----------
children.push(h1("8. Risks & Mitigations"));
children.push(table(
  ["Risk","Likelihood","Impact","Mitigation"],
  [
    ["Review data can’t be stored / cheaply sourced","High","High","Live-fetch + attribute; build first-party reviews; transparent seed score"],
    ["Cold-start: no reviews at launch","High","Medium","Seed composite score from public facts; start with one metro"],
    ["IELTS losing share to CELPIP/PTE","Medium","Medium","Architect to add other test centres later"],
    ["Thin market per city","Medium","Medium","Curate depth over breadth; focus Toronto/Vancouver first"],
    ["Google API cost creep","Low","Low","Cache place_id, lazy-load ratings, or switch to Mapbox for maps"],
    ["UGC moderation / defamation","Low","Medium","Review policy + moderation + takedown flow"],
  ],
  [3000, 1300, 1200, 3500]
));

// ---------- 9. VERDICT ----------
children.push(h1("9. Go / No-Go Verdict"));
children.push(runs([b("Go — as a focused, single-metro portfolio build. "),
  t("The concept solves a real problem, the engineering is well within solo reach, and the market’s modest size is actually an advantage for a curatable dataset. The one decision that determines success or failure is how you treat ratings data.")]));
children.push(h2("Recommended path"));
children.push(bullet("Pick one metro (Toronto or Vancouver) and hand-curate every IELTS centre: operator, format, price, address, place_id, and your own photo."));
children.push(bullet("Ship the map + list + detail + filter experience with a transparent, fact-based composite score so no centre is blank."));
children.push(bullet("Render Google ratings live and attributed on detail pages — never stored."));
children.push(bullet("Add first-party reviews with accounts + moderation; these become the data you actually own."));
children.push(bullet("Only after that works, consider widening to more cities and to CELPIP/PTE centres."));
children.push(spacer());
children.push(runs([b("One-line summary: "),
  t("Build it, start in one city, own your ratings, and rent Google’s.")]));

// ---------- SOURCES ----------
children.push(new Paragraph({ children:[new PageBreak()] }));
children.push(h1("Sources"));
const srcs = [
  ["Cost of IELTS in Canada (IDP)", "https://ielts.idp.com/canada/about/cost-of-ielts-in-canada"],
  ["IELTS test dates, fees and locations (British Council Canada)", "https://www.britishcouncil.ca/exam/ielts/dates-fees-locations"],
  ["IELTS vs CELPIP vs PTE for Canadian immigration", "https://ircc.com/news/ielts-vs-celpip-vs-pte-canadian-immigration"],
  ["Google Places API pricing 2026 (SafeGraph)", "https://www.safegraph.com/guides/google-places-api-pricing/"],
  ["Policies and attributions for Places API (Google)", "https://developers.google.com/maps/documentation/places/web-service/policies"],
  ["Google Maps Platform Service Specific Terms", "https://cloud.google.com/maps-platform/terms/maps-service-terms"],
];
srcs.forEach(s => children.push(new Paragraph({ spacing:{after:90},
  children:[ new TextRun({ text:s[0]+" — ", size:20 }), new TextRun({ text:s[1], size:20, color:ACCENT2, underline:{} }) ]})));

// ---------- DOC ----------
const doc = new Document({
  creator: "Feasibility Study",
  numbering: { config: [{ reference:"bl", levels:[
    { level:0, format:LevelFormat.BULLET, text:"•", alignment:AlignmentType.LEFT,
      style:{ run:{ color:ACCENT2 }, paragraph:{ indent:{ left:460, hanging:260 } } } },
    { level:1, format:LevelFormat.BULLET, text:"◦", alignment:AlignmentType.LEFT,
      style:{ paragraph:{ indent:{ left:920, hanging:260 } } } },
  ]}]},
  styles: { default: { document: { run: { font:"Calibri" } } } },
  sections: [{
    properties: { page: { size:{ width:12240, height:15840 }, margin:{ top:1200, bottom:1200, left:1200, right:1200 } } },
    children
  }]
});
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("IELTS_Centre_App_Feasibility.docx", buf);
  console.log("written", buf.length);
});
