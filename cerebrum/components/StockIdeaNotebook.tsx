"use client";

import React, { useState, useEffect, useMemo, useRef, useContext, createContext } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import {
  sbGet, sbSet,
  fetchIndices, fetchQuotes, fetchSparklines, fetchNews, fetchIpos, triggerSync, fetchOneStockNow, searchNseEquities,
} from "@/lib/data";
import { callVerdict as llmVerdict, callNewsSummary as llmNewsSummary } from "@/lib/llm";
import { loginWithPassword, verifyMasterPassword, changeNotebookPassword } from "@/lib/auth";

// ─── CONSTANTS ────────────────────────────────────────────────────────────

const TABS = ['Short','Swing','Long','PEAD','ETF','MF','IPO','USA'];
const TAB_FULL = {
  'Short':'Short-Term','Swing':'Swing','Long':'Long-Term','PEAD':'PEAD',
  'ETF':'ETF','MF':'Mutual Funds','IPO':'IPO Watch','USA':'US Market'
};
// Tabs whose stocks should NOT be price/news-synced from indianapi.in
// (mutual funds aren't on the stock API; IPOs come from the dedicated
// /ipo endpoint and have their own table).
const SKIP_QUOTE_SYNC_TABS = new Set(['MF', 'IPO']);
const WATCH_TAGS = [
  {id:'ema10',label:'Near 10 EMA',col:'#6366f1',bg:'rgba(99,102,241,0.10)',icon:'📉'},
  {id:'ema20',label:'Near 20 EMA',col:'#8b5cf6',bg:'rgba(139,92,246,0.10)',icon:'📊'},
  {id:'news', label:'Any News',   col:'#0ea5e9',bg:'rgba(14,165,233,0.10)',icon:'📰'},
  {id:'qtr',  label:'Results Due',col:'#f59e0b',bg:'rgba(245,158,11,0.10)',icon:'📋'},
];
const STATUSES = ['New Idea','Researching','Watch Closely','Accumulation Zone','Waiting For Breakout','Results Awaited','High Conviction','Bought','Rejected','Dropped'];
const SM = {
  'New Idea':             {c:'#6366f1',bg:'rgba(99,102,241,0.10)'},
  'Researching':          {c:'#3b82f6',bg:'rgba(59,130,246,0.10)'},
  'Watch Closely':        {c:'#f59e0b',bg:'rgba(245,158,11,0.10)'},
  'Accumulation Zone':    {c:'#10b981',bg:'rgba(16,185,129,0.10)'},
  'Waiting For Breakout': {c:'#8b5cf6',bg:'rgba(139,92,246,0.10)'},
  'Results Awaited':      {c:'#0ea5e9',bg:'rgba(14,165,233,0.10)'},
  'High Conviction':      {c:'#22c55e',bg:'rgba(34,197,94,0.10)'},
  'Bought':               {c:'#84cc16',bg:'rgba(132,204,22,0.10)'},
  'Rejected':             {c:'#ef4444',bg:'rgba(239,68,68,0.10)'},
  'Dropped':              {c:'#94a3b8',bg:'rgba(148,163,184,0.10)'},
};
const SECTORS = [
  'Aerospace & Defence',
  'Agrochemicals & Fertilisers',
  'Auto Sector',
  'Auto Ancillary',
  'Chemicals',
  'Construction',
  'Consumer Discretionary',
  'Consumer Durables',
  'Consumer Services',
  'Dredging',
  'Electric Equipment',
  'Electronics',
  'Energy',
  'Finance',
  'FMCG',
  'Ghar Gharana',
  'Healthcare',
  'Industrial Manufacturing',
  'Infrastructure',
  'IT',
  'Leisure Services',
  'Metal, Mineral & Mining',
  'Oil & Gas',
  'Paper, Forest & Jute',
  'Pharma',
  'Power',
  'Printing & Publication',
  'Railways',
  'Real Estate',
  'Retailing',
  'Telecom',
  'Textile',
  'Transport Infrastructure',
  'Transport Services',
  'Utility',
  'Aviation',
];
const CAPS = ['Large Cap','Mid Cap','Small Cap','Micro Cap'];

const SECTOR_SUBSECTORS = {
  'Aerospace & Defence': [
    'Aircraft & MRO',
    'Weapons, Ammunition & Missiles',
    'Defence Electronics',
    'Naval & Shipbuilding',
    'Land Systems & Defence Vehicles',
    'Defence Engineering & R&D',
    'Components & Ancillaries',
    'Space Tech',
    'Surveillance & Drones',
  ],
  'Agrochemicals & Fertilisers': [
    'Fertilisers',
    'Agrochemicals & Pesticides',
  ],
  'Auto Sector': [
    '2W / 3W',
    'Passenger Car & Utility Vehicle',
    'Agricultural, Commercial & Construction Vehicle',
    'Auto Ancillary / Auto Component',
    'Auto Dealer',
  ],
  'Auto Ancillary': [
    'Auto Ancillary / Auto Component',
    'Tyre & Rubber',
    'Auto Dealer',
  ],
  'Chemicals': [
    'Explosives',
    'Adhesives',
    'Dyes & Pigments',
    'Acids & Intermediates',
    'Specialty Chemicals',
    'Petrochemicals',
  ],
  'Commercial Services & Supplies': [
    'Consulting',
    'Data Processing',
    'Distributors',
    'Co-working Space',
    'Other Services',
  ],
  'Construction': [
    'Construction Companies',
    'Cement Products',
    'Other Construction Materials',
  ],
  'Consumer Discretionary': [
    'Apparel & Textiles',
    'Footwear & Leather Products',
    'Jewellery, Gems & Watch',
    'Paint',
    'Realty',
    'Media',
    'Entertainment',
    'Publication & Printing',
  ],
  'Consumer Durables': [
    'Electrical Consumer Durables & Wires',
    'Consumer Electronics (TV)',
    'Household Appliances & White Goods',
    'Furniture & Home Furnishing',
    'Plywood, Board & Laminates',
    'Houseware',
    'Plastic Products - Consumer',
    'Ceramic',
    'Granite & Marble',
    'Leisure Products',
    'Sanitary Ware',
    'Diversified Consumer Products',
    'Glass - Consumer',
    'Cycles',
    'Toys',
  ],
  'Consumer Services': [
    'Education',
    'E-Learning',
    'Food Storage Facilities',
    'Retailing',
    'Leisure Services',
    'Other Consumer Services',
  ],
  'Retailing': [
    'Retailing',
    'E-Commerce',
    'Specialty Retail',
  ],
  'Leisure Services': [
    'Hotels & Hospitality',
    'Travel & Tourism',
    'Entertainment Parks',
    'Other Leisure',
  ],
  'Dredging': [
    'Dredging Services',
  ],
  'Diversified': [
    'Diversified Companies',
  ],
  'Electric Equipment': [
    'Transformers',
    'Wires & Cables',
    'Switchgear & Other Equipment',
  ],
  'Electronics': [
    'EMS',
    'Consumer Electronics',
    'Industrial Electronics',
    'Semiconductor',
    'PCB & Components',
  ],
  'Energy': [
    'Gas',
    'Oil',
    'Power',
    'Consumable Fuels',
    'Petroleum Products',
  ],
  'Finance': [
    'Bank - Private Sector',
    'Bank - Public Sector',
    'Capital Market - Broking',
    'Capital Market - AMC',
    'Capital Market - Clearing House & Depository',
    'NBFC - Micro Finance',
    'NBFC - Housing Finance',
    'Fintech',
    'Insurance - Life',
    'Insurance - Distributors',
  ],
  'FMCG': [
    'Agricultural Food & Other Products',
    'Food Products - Dairy & Meat',
    'Breweries & Distillery',
    'Other Beverages - Tea & Coffee',
    'Personal Products',
    'Household Products & Stationery',
    'Cigarettes & Tobacco Products',
    'Diversified FMCG',
  ],
  'Ghar Gharana': [
    'Ghar Gharana Companies',
  ],
  'Healthcare': [
    'Pharma',
    'Biotech',
    'Hospital',
    'Healthcare Services Provider',
    'Healthcare Research & Tech',
    'Healthcare Equipment & Supplies',
  ],
  'Pharma': [
    'Specialty API',
    'Generic Formulations',
    'CDMO',
    'OTC Products',
    'Biotech',
  ],
  'Industrial Manufacturing': [
    'Industry Products',
    'Industrial Machinery',
    'Shipbuilding',
    'Railway Wagon',
  ],
  'IT': [
    'IT Services',
    'IT Hardware',
    'IT Software',
  ],
  'Infrastructure': [
    'Roads & Highways',
    'Water Treatment',
    'Urban Infra',
    'Marine & Port Infra',
    'Airport Infra',
  ],
  'Metal, Mineral & Mining': [
    'Ferrous Metal - Iron, Manganese, Steel',
    'Non-Ferrous Metal - Zinc, Copper, Aluminium',
    'Diversified Metal',
    'Metal Mining',
    'Metal Trade',
    'Metal Recycling',
    'Mineral & Mining',
    'Mineral Trading',
  ],
  'Oil & Gas': [
    'Upstream E&P',
    'Midstream Pipeline',
    'Downstream Refining',
    'Gas Distribution',
    'Petroleum Products',
  ],
  'Paper, Forest & Jute': [
    'Paper Products',
    'Jute & Jute Products',
    'Forest Products',
  ],
  'Printing & Publication': [
    'Printing & Publication',
  ],
  'Power': [
    'Power Generation',
    'Power Transmission',
    'Power Distribution',
    'Renewable Energy',
    'T&D Equipment',
  ],
  'Railways': [
    'Signalling & Safety',
    'Rolling Stock',
    'Rail EPC',
    'Rail Consulting',
    'Rail Equipment',
  ],
  'Real Estate': [
    'Residential Real Estate',
    'Commercial Real Estate',
    'REITs',
    'Mixed Use Development',
  ],
  'Telecom': [
    'Telecom Services',
    'Telecom Equipment',
  ],
  'Textile': [
    'Apparel & Garments',
    'Technical Textiles',
    'Yarn & Fibre',
    'Home Textiles',
  ],
  'Transport Infrastructure': [
    'Road, Toll & Annuity',
    'Port & Port Services',
    'Airport Infrastructure',
    'Warehousing & Logistics Parks',
  ],
  'Transport Services': [
    'Logistics Services Provider',
    'Shipping',
    'Road Transport',
    'Railway',
    'Airline',
    'Transport Related Services',
  ],
  'Utility': [
    'Waste Management',
    'Water Supply & Management',
    'Multi Utilities',
    'Other Utilities',
  ],
  'Aviation': [
    'Airlines',
    'Aircraft MRO',
    'Airport Services',
    'Ground Handling',
  ],
};

// ─── INITIAL DATA ─────────────────────────────────────────────────────────

const IS = {
  s1:  {id:'s1',  name:'Dee Development',   sector:'Infrastructure',    subSector:'Roads & Highways', cap:'Small Cap', src:['Short'],         st:'Researching',          notes:[{id:'n1',date:'12 Jan 2024',txt:'Strong order book visibility. Management guidance positive on margins. Watching Q4 closely.',pin:true}],  sc:{bq:7,mq:6,gv:8,val:6,ts:7}, arc:false, vd:null, news:null},
  s2:  {id:'s2',  name:'Techno Electric',   sector:'Power',             subSector:'T&D Equipment',    cap:'Mid Cap',   src:['Short'],         st:'Watch Closely',        notes:[{id:'n2',date:'15 Jan 2024',txt:'Clean balance sheet. Power T&D play. Watching for breakout above resistance zone.',pin:false}], sc:{bq:7,mq:8,gv:7,val:7,ts:8}, arc:false, vd:null, news:null},
  s3:  {id:'s3',  name:'Wabag',             sector:'Infrastructure',    subSector:'Water Treatment',  cap:'Small Cap', src:['Short'],         st:'New Idea',             notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s4:  {id:'s4',  name:'Amber',             sector:'Consumer Durables', subSector:'AC & Components',  cap:'Mid Cap',   src:['PEAD'],          st:'High Conviction',      notes:[{id:'n3',date:'20 Jan 2024',txt:'AC component market leader. EMS opportunity building rapidly. Strong summer demand cycle ahead.',pin:true}], sc:{bq:8,mq:8,gv:9,val:6,ts:7}, arc:false, vd:null, news:null},
  s5:  {id:'s5',  name:'Capri Global',      sector:'Finance',           subSector:'NBFC',             cap:'Small Cap', src:['PEAD'],          st:'Researching',          notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s6:  {id:'s6',  name:'BEML',              sector:'Aerospace & Defence',subSector:'Defence PSU',     cap:'Mid Cap',   src:['PEAD'],          st:'Watch Closely',        notes:[{id:'n4',date:'25 Jan 2024',txt:'Defence + Railways dual play. Government capex supercycle beneficiary. Strong order book.',pin:false}], sc:{bq:7,mq:6,gv:8,val:5,ts:6}, arc:false, vd:null, news:null},
  s7:  {id:'s7',  name:'Kernex',            sector:'Railways',          subSector:'Signalling',       cap:'Small Cap', src:['PEAD'],          st:'Waiting For Breakout', notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s8:  {id:'s8',  name:'ITD Cementation',   sector:'Construction',      subSector:'Marine & Infra',   cap:'Small Cap', src:['Swing'],         st:'New Idea',             notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s9:  {id:'s9',  name:'Genus Power',       sector:'Electric Equipment',subSector:'Smart Metering',   cap:'Small Cap', src:['Swing','Long'],  st:'Researching',          notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s10: {id:'s10', name:'Ami Organics',      sector:'Chemicals',         subSector:'Specialty API',    cap:'Small Cap', src:['Long'],          st:'Watch Closely',        notes:[{id:'n5',date:'05 Feb 2024',txt:'Specialty API manufacturer. Excellent EBITDA margins. Export growth story remains intact.',pin:true}], sc:{bq:8,mq:7,gv:7,val:6,ts:5}, arc:false, vd:null, news:null},
  s11: {id:'s11', name:'JG Chemicals',      sector:'Chemicals',         subSector:'Zinc Chemicals',   cap:'Small Cap', src:['Long'],          st:'Researching',          notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s12: {id:'s12', name:'Jost',              sector:'Auto Ancillary',    subSector:'Trailer Parts',    cap:'Small Cap', src:['Long'],          st:'New Idea',             notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s13: {id:'s13', name:'Pricol',            sector:'Auto Ancillary',    subSector:'Instrumentation',  cap:'Small Cap', src:['Long'],          st:'Researching',          notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s14: {id:'s14', name:'RITES',             sector:'Transport Services', subSector:'Rail Consulting',  cap:'Mid Cap',   src:['Long'],          st:'Watch Closely',        notes:[], sc:{bq:0,mq:0,gv:0,val:0,ts:0}, arc:false, vd:null, news:null},
  s15: {id:'s15', name:'Kaynes Technology', sector:'Electronics',       subSector:'EMS',              cap:'Mid Cap',   src:['PEAD'],          st:'High Conviction',      notes:[{id:'n6',date:'18 Feb 2024',txt:'EMS company with tier-1 clients. Exceptional management execution. Order book growing strongly.',pin:true}], sc:{bq:9,mq:9,gv:9,val:5,ts:8}, arc:false, vd:null, news:null},
};
const IW = {
  Short:['s1','s2','s3'], Swing:['s8','s9'],
  Long:['s9','s10','s11','s12','s13','s14'],
  PEAD:['s15','s4','s5','s6','s7'],
  USA:[],
};
const UNIVERSE = [
  {n:'Dee Development',s:'Infrastructure'},{n:'Techno Electric',s:'Power'},{n:'Wabag',s:'Infrastructure'},
  {n:'Amber',s:'Electronics'},{n:'Capri Global',s:'Finance'},{n:'BEML',s:'Railways'},
  {n:'Kernex',s:'Railways'},{n:'ITD Cementation',s:'Infrastructure'},{n:'Genus Power',s:'Power'},
  {n:'Ami Organics',s:'Chemicals'},{n:'JG Chemicals',s:'Chemicals'},{n:'Jost',s:'Auto Ancillary'},
  {n:'Pricol',s:'Auto Ancillary'},{n:'RITES',s:'Railways'},{n:'Kaynes Technology',s:'Electronics'},
  {n:'Dixon Technologies',s:'Electronics'},{n:'Suzlon Energy',s:'Power'},{n:'IREDA',s:'Finance'},
  {n:'RVNL',s:'Railways'},{n:'Titagarh Rail',s:'Railways'},{n:'Anupam Rasayan',s:'Chemicals'},
  {n:'Clean Science',s:'Chemicals'},{n:'Navin Fluorine',s:'Chemicals'},{n:'Sona Comstar',s:'Auto Ancillary'},
  {n:'Minda Industries',s:'Auto Ancillary'},{n:'KPIT Technologies',s:'IT'},{n:'Persistent Systems',s:'IT'},
  {n:'Coforge',s:'IT'},{n:'Tata Elxsi',s:'IT'},{n:'Apar Industries',s:'Power'},
  {n:'KEI Industries',s:'Power'},{n:'Polycab',s:'Electronics'},{n:'ABB India',s:'Electronics'},
  {n:'Siemens India',s:'Electronics'},{n:'J Kumar Infra',s:'Infrastructure'},{n:'NCC',s:'Infrastructure'},
  {n:'KNR Constructions',s:'Infrastructure'},{n:'NMDC',s:'Metal & Mining'},{n:'Divis Lab',s:'Pharma'},
  {n:'Caplin Point',s:'Pharma'},{n:'HAL',s:'Defence'},{n:'BEL',s:'Defence'},
  {n:'Mazagon Dock',s:'Defence'},{n:'Data Patterns',s:'Defence'},{n:'Brigade Enterprises',s:'Real Estate'},
  {n:'NTPC',s:'Power'},{n:'Power Grid',s:'Power'},{n:'Bajaj Finance',s:'Finance'},
  {n:'Cholamandalam',s:'Finance'},{n:'Schaeffler India',s:'Auto Ancillary'},{n:'Paras Defence',s:'Defence'},
  {n:'Route Mobile',s:'IT'},{n:'Happiest Minds',s:'IT'},{n:'Zomato',s:'IT'},
];
const INIT_WATCH = [
  {id:'w1',name:'Kaynes Technology',sector:'Electronics',tags:['ema20','news'],note:'Testing 20 EMA. Order announcement expected.'},
  {id:'w2',name:'Ami Organics',sector:'Chemicals',tags:['qtr'],note:'Q4 results due this week. Watch margin commentary.'},
  {id:'w3',name:'BEML',sector:'Railways',tags:['ema10'],note:'Bounced off 10 EMA. Watch for continuation.'},
  {id:'w4',name:'Techno Electric',sector:'Power',tags:['ema20','qtr'],note:'Pullback to 20 EMA + results next month.'},
];
const INIT_IPO = [
  {id:'ipo1', name:'Avience Biomedicals',  issuePrice:208, listingDate:'2026-06-25', gmp:null, signal:'Watch',     notes:'SME IPO. 352x subscribed. Listing Jun 25. Biomedicals play.', addedDate:'23 Jun 2026'},
  {id:'ipo2', name:'Clay Craft India',     issuePrice:203, listingDate:'2026-06-24', gmp:null, signal:'Watch',     notes:'SME IPO. 95x subscribed. Ceramics & Tableware. Listing Jun 24.', addedDate:'23 Jun 2026'},
  {id:'ipo3', name:'Turtlemint Fintech',   issuePrice:152, listingDate:'2026-06-27', gmp:null, signal:'Watch',     notes:'Fintech insurance platform. Currently open (0.54x). Closes today Jun 23.', addedDate:'23 Jun 2026'},
  {id:'ipo4', name:'CSM Technologies',     issuePrice:113, listingDate:'2026-07-04', gmp:null, signal:'Watch',     notes:'IT services. Opens Jun 24. Price band ₹107-113. Pre-apply open.', addedDate:'23 Jun 2026'},
];

const MOCK_VD = {
  verdict:'Research Further',confidence:64,
  bullish:['Government capex in core sectors remains robust — key sectoral tailwind','Business quality appears sound based on historical capital allocation patterns','Order book visibility provides meaningful near-term revenue predictability','PE re-rating potential given broad infrastructure/capex supercycle narrative'],
  bearish:['Current valuations elevated relative to 3-year historical average multiples','Working capital intensity high — cash conversion cycle remains stretched','Client concentration risk in top accounts above comfortable threshold'],
  risks:['Government budget reallocation could impact order flows materially','Raw material cost spikes may compress margins in near-to-medium term','Execution delays on large/complex project portfolios'],
  triggers:['Quarterly order inflow beat would be strong positive catalyst','EBITDA margin expansion for 2 consecutive quarters — watch closely','Technical breakout above 52-week high on strong volume'],
  questions:['What is the L1 pipeline and typical order-to-revenue conversion timeline?','How is management navigating working capital in the current cycle?','Any capacity expansion or new business segment planned in FY26?'],
};

// ─── UTILITIES ────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).substr(2,9);
const fp = (n) => n != null ? `₹${n.toLocaleString('en-IN',{maximumFractionDigits:2})}` : '—';
const fvol = (n) => { if (!n) return '—'; if (n>=1e7) return `${(n/1e7).toFixed(1)}Cr`; if (n>=1e5) return `${(n/1e5).toFixed(1)}L`; return n.toLocaleString('en-IN',{maximumFractionDigits:0}); };
const tdStr = () => new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});

function mkRng(seed) { let s=Math.abs(seed%2147483647)||1; return()=>{s=s*16807%2147483647;return(s-1)/2147483646;}; }
function strHash(str) { let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h)+str.charCodeAt(i); return Math.abs(h); }
function genChart(name) {
  const rng=mkRng(strHash(name)); const data=[]; let p=30+rng()*120;
  for(let i=0;i<30;i++){p=Math.max(p*(0.97+rng()*0.065),5);data.push({v:+p.toFixed(2)});}
  return data;
}
// ─── DEMO QUOTE FALLBACK ──────────────────────────────────────────────────
// Static placeholder prices used only when a stock has no live row in
// market_quotes yet (e.g. just added, before the next sync runs).
const DEMO_QUOTE_FALLBACK = {
  'Amber':            {px:7839,   chg:-0.85, dayH:7960,  dayL:7825,  live:true},
  'Techno Electric':  {px:1092,   chg:-0.19, dayH:1108,  dayL:1087.5,live:true},
  'Wabag':            {px:2065.1, chg:0.16,  dayH:2086,  dayL:2036.1,live:true},
  'Capri Global':     {px:217.8,  chg:0.79,  dayH:219.64,dayL:215.52,live:true},
  'BEML':             {px:1765,   chg:0.12,  dayH:1788,  dayL:1763.2,live:true},
  'Kernex':           {px:1959,   chg:-0.52, dayH:1974,  dayL:1922.2,live:true},
  'Genus Power':      {px:332.55, chg:2.92,  dayH:336.5, dayL:323.1, live:true},
  'JG Chemicals':     {px:436.8,  chg:-1.31, dayH:443.6, dayL:435,   live:true},
  'Jost':             {px:243.05, chg:4.25,  dayH:247.7, dayL:236.95,live:true},
  'Pricol':           {px:583.45, chg:1.66,  dayH:585.6, dayL:572.8, live:true},
  'RITES':            {px:210.98, chg:-1.28, dayH:213.95,dayL:210.44,live:true},
  'Kaynes Technology':{px:3239.8, chg:-1.33, dayH:3287.1,dayL:3234.7,live:true},
  'Dee Development':  {px:660,    chg:-2.53, dayH:690,   dayL:647,   live:true},
};

// ── Live quote context: per-stock price from market_quotes (indianapi.in
// via netlify/functions/market-sync-background). Falls back to
// DEMO_QUOTE_FALLBACK when a stock has no live row yet (e.g. just added,
// before the next sync runs). ──
const QuoteContext = createContext<Record<string, any>>({});

function useMarketData(stockName) {
  const quotes = useContext(QuoteContext);
  const live = quotes?.[stockName];
  if (live) {
    return {
      data: {
        px: live.price, chg: live.day_pct,
        dayH: live.day_high, dayL: live.day_low,
        h52: live.year_high, l52: live.year_low,
        s10: live.sma10, s20: live.sma20,
        e10: live.sma10, e20: live.sma20,
        live: true,
      },
      loading: false,
    };
  }
  const data = DEMO_QUOTE_FALLBACK[stockName] || null;
  return { data, loading: false };
}

// ─── LIVE DATA: indices + verdict (Netlify DB + NVIDIA NIM via /api/llm) ───

async function fetchMarketPrices() {
  // Reads from market_indices table (populated by netlify/functions/market-sync-background).
  const rows = await fetchIndices();
  const prices: Record<string, { price: number; change: number }> = {};
  let latest: string | null = null;
  Object.entries(rows).forEach(([key, r]) => {
    prices[key] = { price: Number(r.price), change: Number(r.change_pct) };
    if (!latest || r.updated_at > latest) latest = r.updated_at;
  });
  return { fetchedAt: latest || new Date().toISOString(), prices };
}

async function callVerdict(stock: any) {
  // Verdict generation now runs server-side via /api/llm → NVIDIA NIM.
  return await llmVerdict({ name: stock.name, sector: stock.sector, subSector: stock.subSector });
}

// ─── ATOMS ────────────────────────────────────────────────────────────────

function Badge({st, sm}) {
  const m = SM[st]||SM['New Idea'];
  return <span style={{color:m.c,background:m.bg,border:`1px solid ${m.c}40`}} className={`inline-block rounded-full font-semibold whitespace-nowrap ${sm?'text-[9px] px-1.5 py-[2px]':'text-[11px] px-2 py-[3px]'}`}>{st}</span>;
}

function Ring({score, sz=40}) {
  const r=(sz-7)/2, circ=2*Math.PI*r;
  const col=score>=70?'#22c55e':score>=50?'#f59e0b':score>=25?'#3b82f6':'#cbd5e1';
  return (
    <div style={{width:sz,height:sz}} className="relative flex items-center justify-center flex-shrink-0">
      <svg width={sz} height={sz} className="absolute inset-0 -rotate-90">
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={3.5}/>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={col} strokeWidth={3.5}
          strokeDasharray={circ} strokeDashoffset={circ*(1-score/100)} strokeLinecap="round"
          style={{transition:'stroke-dashoffset 0.6s ease'}}/>
      </svg>
      <span style={{color:col,fontSize:sz<35?'9px':'11px'}} className="font-bold">{score}</span>
    </div>
  );
}

function MiniChart({name, pos, closes}: {name: string; pos: boolean; closes?: number[]}) {
  const gid = useRef(uid()).current;
  // Prefer real closes from stock_sparklines when available, fall back to deterministic synth.
  const data = useMemo(() => {
    if (closes && closes.length >= 2) return closes.map((v) => ({ v }));
    return genChart(name);
  }, [name, closes]);
  const col = pos?'#22c55e':'#ef4444';
  return (
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={data} margin={{top:2,right:0,bottom:0,left:0}}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={col} stopOpacity={0.22}/>
            <stop offset="95%" stopColor={col} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={col} strokeWidth={1.8} fill={`url(#${gid})`} dot={false} isAnimationActive={false}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Tiny inline sparkline used in compact rows (dashboard banners).
function Sparkline({closes, positive}: {closes?: number[]; positive: boolean}) {
  if (!closes || closes.length < 2) return <div className="w-[60px] h-[20px]"/>;
  const col = positive ? '#22c55e' : '#ef4444';
  const data = closes.map((v) => ({ v }));
  return (
    <div style={{width: 60, height: 20}}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{top:1,right:0,bottom:1,left:0}}>
          <Area type="monotone" dataKey="v" stroke={col} strokeWidth={1.4} fill={col} fillOpacity={0.18} dot={false} isAnimationActive={false}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sparkline context: load once per dashboard mount, pass via React context ──
const SparkContext = createContext<Record<string, number[]>>({});
function useSparkClose(name: string, sym?: string): number[] | undefined {
  const all = useContext(SparkContext);
  if (!all) return undefined;
  return (sym && all[sym]) || all[(`NSE:${(name||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,20)}`)] || all[name];
}

// ─── STOCK CARD ────────────────────────────────────────────────────────────

function PriceSkeleton() {
  return <div className="h-3 w-16 bg-slate-200 rounded animate-pulse"/>;
}

function StockCard({stock, onSelect, selected}: any) {
  const { data: px, loading } = useMarketData(stock.name);
  const pos = px ? px.chg >= 0 : true;
  const closes = useSparkClose(stock.name, stock.sym);
  const tot = Math.round((stock.sc.bq+stock.sc.mq+stock.sc.gv+stock.sc.val+stock.sc.ts)/5*10);
  const hasScore = stock.sc.bq > 0;
  const isHC = stock.st === 'High Conviction';
  return (
    <div onClick={()=>onSelect(stock.id)}
      className={`rounded-2xl cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 overflow-hidden select-none bg-white dark:bg-slate-800 border-2 ${selected?'border-blue-500 dark:border-blue-400 shadow-[0_4px_20px_rgba(59,130,246,0.18)]':isHC?'border-emerald-500 dark:border-emerald-400 shadow-[0_4px_20px_rgba(34,197,94,0.12)]':'border-slate-200 dark:border-slate-700 shadow-[0_1px_6px_rgba(0,0,0,0.06)] dark:shadow-none'}`}>
      <div className="px-3.5 pt-3 pb-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[13px] text-slate-800 dark:text-slate-100 leading-tight truncate">{stock.name}</div>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              <span className="text-[9px] text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded uppercase tracking-wide font-medium">{stock.sector}</span>
              {stock.subSector && <span className="text-[9px] text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/15 border border-violet-100 dark:border-violet-400/20 px-1.5 py-[2px] rounded font-medium">{stock.subSector}</span>}
              <span className="text-[9px] text-slate-400 dark:text-slate-500">{stock.cap}</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0 min-w-[70px]">
            {loading ? (
              <div className="space-y-1.5 items-end flex flex-col"><PriceSkeleton/><PriceSkeleton/></div>
            ) : px ? (
              <>
                <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 font-mono">{fp(px.px)}</div>
                <div className={`text-[11px] font-bold font-mono ${pos?'text-emerald-500':'text-red-500'}`}>{pos?'+':''}{px.chg.toFixed(2)}%</div>
              </>
            ) : (
              <>
                <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">No data</div>
                <div className="text-[9px] text-slate-300 dark:text-slate-600">NSE</div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="px-2 pb-0.5 relative bg-slate-50/60 dark:bg-slate-900/40">
        {!loading && px && (
          <div className={`absolute top-1 right-3 text-[10px] sm:text-[8px] font-bold tracking-wider ${pos?'text-emerald-500':'text-red-500'}`}>{pos?'▲':'▼'} Day</div>
        )}
        <MiniChart name={stock.name} pos={pos} closes={closes}/>
      </div>
      <div className="grid grid-cols-3 bg-slate-50/80 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-700">
        {[
          ['Vol',   loading ? null : px ? fvol(px.vol)  : '—'],
          ['52W H', loading ? null : px ? fp(px.h52)    : '—'],
          ['52W L', loading ? null : px ? fp(px.l52)    : '—'],
        ].map(([k,v],i)=>(
          <div key={k} className={`px-3 py-2 ${i<2?'border-r border-slate-100 dark:border-slate-700':''}`}>
            <div className="text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-medium">{k}</div>
            {v === null
              ? <div className="h-2.5 w-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mt-1"/>
              : <div className="text-[12px] sm:text-[10px] text-slate-700 dark:text-slate-200 font-mono font-semibold mt-0.5 truncate">{v}</div>
            }
          </div>
        ))}
      </div>
      <div className="px-3 py-2 flex items-center justify-between gap-1 border-t border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <Badge st={stock.st} sm/>
          {hasScore && <Ring score={tot} sz={26}/>}
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {stock.src.map(s=><span key={s} title={TAB_FULL[s]||s} className="text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded font-mono cursor-default">{s}</span>)}
          {stock.notes.length>0 && <span className="text-[11px] sm:text-[9px] text-slate-400 dark:text-slate-500 ml-0.5">✎{stock.notes.length}</span>}
          {px?.live && <span className="text-[10px] sm:text-[7px] text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/20 px-1.5 py-[1px] rounded-full font-bold ml-0.5">🟢 Live</span>}
        </div>
      </div>
    </div>
  );
}

// ─── SECTOR GROUP ─────────────────────────────────────────────────────────

const SECTOR_COLORS = {
  'Infrastructure':'#3b82f6','Power':'#f59e0b','Railways':'#10b981',
  'Chemicals':'#8b5cf6','Auto Ancillary':'#ef4444','Auto Sector':'#f97316',
  'Finance':'#0ea5e9','Electronics':'#6366f1','IT':'#ec4899',
  'Pharma':'#14b8a6','FMCG':'#84cc16','Real Estate':'#a78bfa',
  'Aerospace & Defence':'#dc2626','Agrochemicals & Fertilisers':'#65a30d',
  'Construction':'#d97706','Consumer Discretionary':'#7c3aed',
  'Consumer Durables':'#db2777','Consumer Services':'#0891b2',
  'Dredging':'#0369a1','Electric Equipment':'#ca8a04',
  'Energy':'#ea580c','Ghar Gharana':'#be185d',
  'Healthcare':'#059669','Industrial Manufacturing':'#7e22ce',
  'Leisure Services':'#c026d3','Metal, Mineral & Mining':'#78716c',
  'Oil & Gas':'#b45309','Paper, Forest & Jute':'#4d7c0f',
  'Printing & Publication':'#1d4ed8','Retailing':'#9333ea',
  'Telecom':'#0e7490','Textile':'#b91c1c',
  'Transport Infrastructure':'#15803d','Transport Services':'#1e40af',
  'Utility':'#6b21a8','Aviation':'#0284c7',
};

function SectorGroup({sector, stocks, onSelect, selId, collapsed, onToggle}) {
  const col = SECTOR_COLORS[sector] || '#94a3b8';
  return (
    <div className="mb-5">
      <button onClick={onToggle} className="flex items-center gap-2 w-full text-left mb-3 group">
        <span className="text-slate-300 dark:text-slate-600 text-[9px] group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors select-none">{collapsed?'▶':'▼'}</span>
        <div style={{background:col}} className="w-2.5 h-2.5 rounded-full flex-shrink-0"/>
        <span style={{color:col}} className="text-[11px] font-bold uppercase tracking-widest group-hover:opacity-75 transition-opacity">{sector}</span>
        <span className="text-[9px] text-white font-bold px-2 py-[2px] rounded-full" style={{background:col}}>{stocks.length}</span>
        <div className="flex-1 h-px" style={{background:`linear-gradient(to right,${col}30,transparent)`}}/>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {stocks.map(s=><StockCard key={s.id} stock={s} onSelect={onSelect} selected={selId===s.id}/>)}
        </div>
      )}
    </div>
  );
}

// ─── NOTES PANEL ──────────────────────────────────────────────────────────

function NotesPanel({stock, upd}) {
  const [txt, setTxt] = useState('');
  const [editId, setEditId] = useState(null);
  const [editTxt, setEditTxt] = useState('');
  const [q, setQ] = useState('');
  const sorted = useMemo(()=>{
    const ns=[...stock.notes].sort((a,b)=>(b.pin?1:0)-(a.pin?1:0));
    if (!q) return ns;
    return ns.filter(n=>n.txt.toLowerCase().includes(q.toLowerCase()));
  },[stock.notes,q]);
  const addNote = () => { if (!txt.trim()) return; upd({notes:[{id:uid(),date:tdStr(),txt:txt.trim(),pin:false},...stock.notes]}); setTxt(''); };
  return (
    <div className="flex flex-col h-full gap-3">
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search notes…"
        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20"/>
      <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        <textarea value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey) addNote();}}
          placeholder="Add research note… (Ctrl+Enter to save)" rows={3}
          className="w-full bg-transparent px-3 pt-3 pb-1 text-[13px] text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-none"/>
        <div className="flex justify-between items-center px-3 pb-2.5 bg-slate-50/60 dark:bg-slate-900/40">
          <span className="text-[9px] text-slate-400 dark:text-slate-500">{tdStr()}</span>
          <button onClick={addNote} disabled={!txt.trim()} className="text-[11px] bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white px-3 py-1 rounded-lg transition-colors font-medium">Add Note</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
        {sorted.length===0 && <div className="text-center text-slate-400 dark:text-slate-500 text-xs py-8">No notes yet</div>}
        {sorted.map(n=>(
          <div key={n.id} className={`rounded-2xl p-3 shadow-sm border ${n.pin?'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-400/30':'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">{n.pin&&<span className="text-amber-500 text-[10px]">📌</span>}<span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{n.date}</span></div>
              <div className="flex items-center gap-2 text-[10px]">
                <button onClick={()=>upd({notes:stock.notes.map(x=>x.id===n.id?{...x,pin:!x.pin}:x)})} className="text-slate-400 dark:text-slate-500 hover:text-amber-500 transition-colors">{n.pin?'Unpin':'Pin'}</button>
                <button onClick={()=>{setEditId(n.id);setEditTxt(n.txt);}} className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Edit</button>
                <button onClick={()=>upd({notes:stock.notes.filter(x=>x.id!==n.id)})} className="text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors">Del</button>
              </div>
            </div>
            {editId===n.id ? (
              <div className="space-y-2">
                <textarea value={editTxt} onChange={e=>setEditTxt(e.target.value)} rows={3} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1.5 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none resize-none"/>
                <div className="flex gap-2">
                  <button onClick={()=>{upd({notes:stock.notes.map(x=>x.id===n.id?{...x,txt:editTxt}:x)});setEditId(null);}} className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg transition-colors">Save</button>
                  <button onClick={()=>setEditId(null)} className="text-[11px] border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 px-3 py-1 rounded-lg transition-colors">Cancel</button>
                </div>
              </div>
            ) : <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">{n.txt}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CONVICTION PANEL ─────────────────────────────────────────────────────

const SC_CATS = [{k:'bq',l:'Business Quality',e:'🏢'},{k:'mq',l:'Management Quality',e:'👔'},{k:'gv',l:'Growth Visibility',e:'📈'},{k:'val',l:'Valuation',e:'💰'},{k:'ts',l:'Technical Setup',e:'📊'}];

function ConvictionPanel({stock, upd}) {
  const tot = Math.round((stock.sc.bq+stock.sc.mq+stock.sc.gv+stock.sc.val+stock.sc.ts)/5*10);
  const col = tot>=70?'#22c55e':tot>=50?'#f59e0b':tot>=25?'#3b82f6':'#94a3b8';
  const lbl = tot>=70?'High Conviction':tot>=50?'Moderate':tot>=15?'Low Conviction':'Not Scored';
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 flex items-center gap-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
        <Ring score={tot} sz={64}/>
        <div className="flex-1 min-w-0">
          <div className="text-xl font-black text-slate-800 dark:text-slate-100">{tot}<span className="text-sm text-slate-400 dark:text-slate-500 font-normal">/100</span></div>
          <div style={{color:col}} className="text-xs font-bold mt-0.5">{lbl}</div>
          <div className="mt-2.5 space-y-1.5">
            {SC_CATS.map(c=>(
              <div key={c.k} className="flex items-center gap-2">
                <div className="text-[9px] text-slate-500 dark:text-slate-400 w-14 truncate font-medium">{c.l.split(' ')[0]}</div>
                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div style={{width:`${stock.sc[c.k]*10}%`,background:col,transition:'width 0.5s ease'}} className="h-full rounded-full"/>
                </div>
                <div className="text-[9px] text-slate-500 dark:text-slate-400 w-3 text-right font-bold">{stock.sc[c.k]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {SC_CATS.map(c=>{
          const v=stock.sc[c.k], vc=v>=7?'#22c55e':v>=5?'#f59e0b':'#ef4444';
          return (
            <div key={c.k} className="rounded-2xl p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><span className="text-base">{c.e}</span><span className="text-[12px] text-slate-700 dark:text-slate-200 font-semibold">{c.l}</span></div>
                <span style={{color:vc}} className="text-base font-black">{v}<span className="text-xs text-slate-400 dark:text-slate-500">/10</span></span>
              </div>
              <input type="range" min="0" max="10" value={v} onChange={e=>upd({sc:{...stock.sc,[c.k]:+e.target.value}})} className="w-full cursor-pointer accent-blue-500"/>
              <div className="flex justify-between text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-500 mt-0.5"><span>0 Poor</span><span>5 Average</span><span>10 Excellent</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// (GeminiKeySetup removed — LLM keys now live server-side in env vars; see /app/api/llm/route.ts)

// ─── VERDICT PANEL ────────────────────────────────────────────────────────

const VD_COL: Record<string, string> = {'Strong Buy Candidate':'#22c55e','Research Further':'#3b82f6','Watch Closely':'#f59e0b','Wait For Better Entry':'#8b5cf6','Avoid For Now':'#f97316','Rejected':'#ef4444'};

function VSection({title, items, col}: any) {
  return (
    <div className="rounded-2xl p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
      <div style={{color:col}} className="text-[9px] font-bold uppercase tracking-widest mb-2.5">{title}</div>
      <ul className="space-y-1.5">
        {(items||[]).map((it,i)=>(
          <li key={i} className="flex items-start gap-2 text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
            <span style={{background:col}} className="mt-[6px] w-1.5 h-1.5 rounded-full flex-shrink-0"/>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerdictPanel({stock, upd}: any) {
  const [loading, setLoading] = useState(false);
  const [vd, setVd] = useState(stock.vd);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const vdchoices = ['Strong Buy Candidate','Research Further','Watch Closely','Wait For Better Entry','Avoid For Now'];
  const gen = async () => {
    setLoading(true); setApiStatus(null);
    try {
      const res = await callVerdict(stock);
      const v = {...res, ts:tdStr(), aiGenerated:true};
      setVd(v); upd({vd:v}); setApiStatus('ai');
    } catch(e) {
      const v = {...MOCK_VD, verdict:vdchoices[Math.floor(Math.random()*vdchoices.length)], confidence:52+Math.floor(Math.random()*35), ts:tdStr(), aiGenerated:false};
      setVd(v); upd({vd:v}); setApiStatus('mock');
    }
    setLoading(false);
  };
  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-14 h-14 relative">
        <div className="w-14 h-14 border-4 border-emerald-100 rounded-full"/>
        <div className="absolute inset-0 w-14 h-14 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
        <div className="absolute inset-0 flex items-center justify-center text-xl">⚡</div>
      </div>
      <div className="text-slate-700 dark:text-slate-200 text-sm font-semibold">NVIDIA is analysing {stock.name}…</div>
      <div className="text-slate-400 dark:text-slate-500 text-xs">Powered by NVIDIA NIM (Llama-3.1)</div>
    </div>
  );
  if (!vd) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg" style={{background:'linear-gradient(135deg,#76b900,#5a8c00)'}}>⚡</div>
      <div className="text-slate-800 dark:text-slate-100 font-bold text-sm">No Verdict Yet</div>
      <div className="text-slate-500 dark:text-slate-400 text-xs text-center px-6 leading-relaxed">Click below to have NVIDIA NIM generate a research verdict for <span className="font-semibold text-emerald-600 dark:text-emerald-400">{stock.name}</span></div>
      <button onClick={gen} style={{background:'linear-gradient(135deg,#76b900,#5a8c00)'}} className="text-white text-sm px-6 py-2.5 rounded-2xl font-semibold hover:opacity-90 transition-opacity shadow-lg">
        ⚡ Generate AI Verdict
      </button>
      <div className="text-[9px] text-slate-400 dark:text-slate-500">Powered by NVIDIA NIM</div>
    </div>
  );
  const vc = VD_COL[vd.verdict]||'#6366f1';
  return (
    <div className="space-y-3">
      <div style={{border:`2px solid ${vc}30`,background:`${vc}08`}} className="rounded-2xl p-4 flex items-center justify-between shadow-sm">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-medium">Research Verdict</div>
            {vd.aiGenerated && <span className="text-[8px] font-semibold px-1.5 py-[1px] rounded-full" style={{color:'#76b900',background:'rgba(118,185,0,0.08)',border:'1px solid rgba(118,185,0,0.25)'}}>✦ NVIDIA NIM</span>}
          </div>
          <div style={{color:vc}} className="text-base font-bold">{vd.verdict}</div>
          <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-1.5">Generated: {vd.ts}</div>
        </div>
        <div className="text-right">
          <div style={{color:vc}} className="text-3xl font-black font-mono">{vd.confidence}%</div>
          <div className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">Confidence</div>
        </div>
      </div>
      {apiStatus==='mock' && (
        <div className="flex items-center gap-2 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/25 rounded-xl px-3 py-2"><span>⚠</span><span>Demo data shown — NVIDIA NIM unreachable. Check NVIDIA_API_KEY env var.</span></div>
      )}
      <VSection title="✅ Bullish Factors" items={vd.bullish} col="#22c55e"/>
      <VSection title="⚠️ Bearish Factors" items={vd.bearish} col="#ef4444"/>
      <VSection title="🔴 Key Risks" items={vd.risks} col="#f97316"/>
      <VSection title="👀 Triggers to Monitor" items={vd.triggers} col="#0ea5e9"/>
      <VSection title="❓ Research Questions" items={vd.questions} col="#8b5cf6"/>
      <div className="flex gap-2">
        <button onClick={gen} className="flex-1 text-xs text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-200 dark:hover:border-emerald-500/40 transition-colors">⚡ Regenerate (NVIDIA NIM)</button>
      </div>
    </div>
  );
}

// ─── METRICS PANEL ────────────────────────────────────────────────────────

function MetricsPanel({stock}) {
  const { data: px, loading } = useMarketData(stock.name);

  if (loading) return (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4"/>
      {[...Array(10)].map((_,i)=>(
        <div key={i} className="flex justify-between items-center px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-24"/>
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-20"/>
        </div>
      ))}
    </div>
  );

  if (!px) return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="text-3xl opacity-40">📡</div>
      <div className="text-slate-500 dark:text-slate-400 text-sm font-medium">Could not load market data</div>
      <div className="text-slate-400 dark:text-slate-500 text-xs text-center px-6">
        Live quote not synced yet.<br/>
        Next sync at <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">4:00 PM IST</span>, or hit Refresh on the dashboard.
      </div>
    </div>
  );

  const pct52 = px.h52>px.l52 ? Math.max(0,Math.min(100,((px.px-px.l52)/(px.h52-px.l52)*100))) : 50;
  const rows = [
    ['Last Traded Price', fp(px.px),   null],
    ['Day Change',        `${px.chg>0?'+':''}${px.chg.toFixed(2)}%`, px.chg>0?'#22c55e':'#ef4444'],
    ['Day High',          fp(px.dayH), '#22c55e'],
    ['Day Low',           fp(px.dayL), '#ef4444'],
    ['Volume (Today)',    fvol(px.vol), null],
    ['Volume (Prev Day)', fvol(px.pvol), null],
    ['SMA 10',            fp(px.s10),  '#3b82f6'],
    ['SMA 20',            fp(px.s20),  '#6366f1'],
    ['EMA 10',            fp(px.e10),  '#f59e0b'],
    ['EMA 20',            fp(px.e20),  '#f97316'],
    ['52-Week High',      fp(px.h52),  '#22c55e'],
    ['52-Week Low',       fp(px.l52),  '#ef4444'],
  ];

  return (
    <div className="space-y-3">
      {/* Live badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-400/25 rounded-xl px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"/>
          <span>Live data from indianapi.in · synced daily 4 PM IST</span>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-800">
        {rows.map(([k,v,c],i)=>(
          <div key={k} className={`flex items-center justify-between px-4 py-2.5 border-b border-slate-50 dark:border-slate-700/50 ${i%2===0?'bg-slate-50/60 dark:bg-slate-900/40':'bg-white dark:bg-slate-800'}`}>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{k}</span>
            <span style={{color:c||undefined}} className={`text-xs font-bold font-mono ${c?'':'text-slate-800 dark:text-slate-100'}`}>{v||'—'}</span>
          </div>
        ))}
      </div>

      {/* 52W range bar */}
      <div className="rounded-2xl p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold">52-Week Range</div>
          <div className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">{pct52.toFixed(1)}% from low</div>
        </div>
        <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
          <div style={{width:`${pct52}%`,background:'linear-gradient(to right,#ef4444,#f59e0b,#22c55e)'}} className="h-full rounded-full transition-all duration-700"/>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-slate-400 dark:text-slate-500 font-mono">{fp(px.l52)}</span>
          <span className="text-slate-500 dark:text-slate-300 font-mono">{fp(px.px)}</span>
          <span className="text-slate-400 dark:text-slate-500 font-mono">{fp(px.h52)}</span>
        </div>
      </div>

      {/* EMA proximity */}
      {(px.e10||px.e20) && (
        <div className="rounded-2xl p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mb-2.5">EMA Proximity</div>
          {px.e10 && (
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">EMA 10</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{fp(px.e10)}</span>
                <span style={{color: px.px>=px.e10?'#22c55e':'#ef4444'}} className="text-[10px] font-bold">
                  {px.px>=px.e10?'▲ Above':'▼ Below'} ({Math.abs(((px.px-px.e10)/px.e10)*100).toFixed(1)}%)
                </span>
              </div>
            </div>
          )}
          {px.e20 && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">EMA 20</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{fp(px.e20)}</span>
                <span style={{color: px.px>=px.e20?'#22c55e':'#ef4444'}} className="text-[10px] font-bold">
                  {px.px>=px.e20?'▲ Above':'▼ Below'} ({Math.abs(((px.px-px.e20)/px.e20)*100).toFixed(1)}%)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SUB-SECTOR EDIT ──────────────────────────────────────────────────────

function SubSectorEdit({stock, upd}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(stock.subSector||'');
  // Reset when stock changes
  useEffect(() => { setEditing(false); setVal(stock.subSector||''); }, [stock.id, stock.subSector]);
  if (!editing) return (
    <button onClick={()=>{setVal(stock.subSector||'');setEditing(true);}}
      className="mt-1.5 flex items-center gap-1 group">
      <span className="text-[9px] text-slate-400 dark:text-slate-500 group-hover:text-violet-500 dark:group-hover:text-violet-400 transition-colors">
        {stock.subSector ? `✏ ${stock.subSector}` : '+ Add Sub-Sector'}
      </span>
    </button>
  );
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
        onKeyDown={e=>{ if(e.key==='Enter'){upd({subSector:val.trim()});setEditing(false);} if(e.key==='Escape') setEditing(false); }}
        placeholder="Sub-sector (e.g. EMS, API...)"
        className="flex-1 text-[11px] bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-400/30 rounded-lg px-2 py-1 text-violet-700 dark:text-violet-300 placeholder-violet-300 dark:placeholder-violet-500/60 focus:outline-none focus:border-violet-400"/>
      <button onClick={()=>{upd({subSector:val.trim()});setEditing(false);}} className="text-[9px] bg-violet-500 hover:bg-violet-600 text-white px-2 py-1 rounded-lg font-medium transition-colors">Save</button>
      <button onClick={()=>setEditing(false)} className="text-[9px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">✕</button>
    </div>
  );
}

// ─── NEWS PANEL ───────────────────────────────────────────────────────────

const NEWS_CATS = {
  'Corporate Action': {col:'#6366f1', bg:'rgba(99,102,241,0.09)', icon:'🏢'},
  'Results':          {col:'#f59e0b', bg:'rgba(245,158,11,0.09)',  icon:'📋'},
  'Order Win':        {col:'#22c55e', bg:'rgba(34,197,94,0.09)',   icon:'🏆'},
  'Management':       {col:'#3b82f6', bg:'rgba(59,130,246,0.09)', icon:'👔'},
  'Sector News':      {col:'#8b5cf6', bg:'rgba(139,92,246,0.09)', icon:'🏭'},
  'Analyst':          {col:'#0ea5e9', bg:'rgba(14,165,233,0.09)', icon:'🔍'},
  'General':          {col:'#94a3b8', bg:'rgba(148,163,184,0.09)','icon':'📰'},
};

async function fetchStockNews(stock: any) {
  // Pull raw headlines from stock_news (populated by market-sync-background),
  // then ask NVIDIA NIM (via /api/llm) to summarise into our existing shape.
  // sym field is the NSE symbol e.g. "NSE:ZYDUSLIFE" — fall back to name if missing.
  const symbol = stock.sym || `NSE:${(stock.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)}`;
  const rows = await fetchNews(symbol);
  const headlines = rows.map((r) => ({
    title: r.title,
    source: r.source,
    published_at: r.published_at,
    url: r.url,
  }));
  if (!headlines.length) {
    // Nothing yet — return mock so the UI still has something to show.
    throw new Error('no news yet');
  }
  return await llmNewsSummary(
    { name: stock.name, sector: stock.sector, subSector: stock.subSector },
    headlines
  );
}

const MOCK_NEWS = (name) => ({
  fetchedAt: tdStr(),
  headline: `${name} sees steady institutional interest amid sector tailwinds`,
  sentiment: 'Positive',
  items: [
    { title: `${name} secures new order worth ₹320 Cr`, category: 'Order Win', date: '10 Jun 2025', summary: `${name} announced receipt of a new order worth approximately ₹320 Cr from a government entity. Management guided for execution over 18-24 months, adding to order book visibility.`, impact: 'Positive', source: 'BSE Filing' },
    { title: `Q4 FY25 Results — Revenue beats estimates`, category: 'Results', date: '28 May 2025', summary: `Q4 FY25 revenue grew 22% YoY, slightly ahead of street estimates. EBITDA margins expanded 80bps. Management commentary highlighted strong order pipeline and margin improvement trajectory.`, impact: 'Positive', source: 'Moneycontrol' },
    { title: `Brokerage upgrades to BUY with revised target`, category: 'Analyst', date: '15 May 2025', summary: `A leading domestic brokerage upgraded the stock to BUY from HOLD, citing improved earnings visibility and reasonable valuations. Revised target price implies 25% upside from current levels.`, impact: 'Positive', source: 'Economic Times' },
    { title: `Management interview: Growth outlook for FY26`, category: 'Management', date: '05 May 2025', summary: `CMD discussed FY26 guidance in a media interview. Highlighted 20-25% revenue growth target, margin expansion on operating leverage, and continued capex investments in capacity.`, impact: 'Neutral', source: 'CNBC TV18' },
    { title: `Sector capex cycle remains strong — Industry report`, category: 'Sector News', date: '28 Apr 2025', summary: `Industry body released annual report indicating continued government push in the sector. Companies with strong execution track records positioned to benefit disproportionately.`, impact: 'Positive', source: 'Industry Report' },
  ],
  catalysts: ['Q1 FY26 results in July 2025 — watch margin trajectory', 'New order announcements from government tenders', 'Annual general meeting — management guidance update'],
  riskEvents: ['Commodity price spike could pressure margins', 'Delay in government payments may stretch working capital'],
});

function NewsPanel({ stock, upd }: any) {
  const [loading, setLoading] = useState(false);
  const [news, setNews] = useState(stock.news || null);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true); setApiStatus(null);
    try {
      const res = await fetchStockNews(stock);
      if (res?.items) {
        const n = { ...res, aiGenerated: true };
        setNews(n); upd({ news: n }); setApiStatus('ai');
      } else throw new Error('bad');
    } catch {
      const n = { ...MOCK_NEWS(stock.name), aiGenerated: false };
      setNews(n); upd({ news: n }); setApiStatus('mock');
    }
    setLoading(false);
  };

  useEffect(() => { if (!stock.news) refresh(); }, [stock.id]);

  const sentCol = { 'Positive': '#22c55e', 'Neutral': '#f59e0b', 'Negative': '#ef4444' };
  const impCol  = { 'Positive': '#22c55e', 'Neutral': '#94a3b8', 'Negative': '#ef4444' };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-14 h-14 relative flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-sky-100"/>
        <div className="absolute inset-0 rounded-full border-4 border-sky-500 border-t-transparent animate-spin"/>
        <span className="text-xl">📰</span>
      </div>
      <div className="text-slate-700 dark:text-slate-200 text-sm font-semibold">Fetching this week's news…</div>
      <div className="text-slate-400 dark:text-slate-500 text-xs text-center px-8">NVIDIA is summarising recent headlines for <span className="font-medium text-slate-600 dark:text-slate-300">{stock.name}</span></div>
    </div>
  );

  if (!news) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg" style={{background:'linear-gradient(135deg,#76b900,#5a8c00)'}}>📰</div>
      <div className="text-slate-800 dark:text-slate-100 font-bold text-sm">No Weekly Digest Yet</div>
      <div className="text-slate-400 dark:text-slate-500 text-xs text-center px-6 leading-relaxed">Weekly news for <span className="font-semibold text-blue-600 dark:text-blue-400">{stock.name}</span> · synced every Monday via indianapi.in · NVIDIA NIM summarises sentiment</div>
      <button onClick={refresh} style={{background:'linear-gradient(135deg,#76b900,#5a8c00)'}} className="text-white text-sm px-6 py-2.5 rounded-2xl font-semibold hover:opacity-90 transition-opacity shadow-lg">
        📡 Fetch This Week's News
      </button>
      <div className="text-[9px] text-slate-400 dark:text-slate-500">Powered by indianapi.in + NVIDIA NIM · refreshes weekly</div>
    </div>
  );

  const sc = sentCol[news.sentiment] || '#94a3b8';
  return (
    <div className="space-y-3">
      {/* Header card */}
      <div style={{border:`2px solid ${sc}30`, background:`${sc}06`}} className="rounded-2xl p-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold">🗞️ This Week's News</div>
              {news.aiGenerated && <span className="text-[8px] font-semibold px-1.5 py-[1px] rounded-full" style={{color:'#76b900',background:'rgba(118,185,0,0.08)',border:'1px solid rgba(118,185,0,0.25)'}}>✦ NVIDIA NIM</span>}
            </div>
            <div className="text-[12px] text-slate-700 dark:text-slate-200 font-medium leading-snug">{news.headline}</div>
          </div>
          <div className="flex-shrink-0 text-right">
            <span style={{color:sc, background:`${sc}15`, border:`1px solid ${sc}40`}} className="text-[9px] px-2 py-[3px] rounded-full font-bold">{news.sentiment}</span>
            <div className="text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-500 mt-1">{news.fetchedAt}</div>
          </div>
        </div>
      </div>

      {apiStatus==='mock' && (
        <div className="flex items-center gap-2 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/25 rounded-xl px-3 py-2"><span>⚠</span><span>No live news synced yet — showing demo data. The weekly sync (every Monday) will populate this automatically.</span></div>
      )}

      {/* News items */}
      <div className="space-y-2">
        {news.items.map((item: any, i: number) => {
          const cat = NEWS_CATS[item.category] || NEWS_CATS['General'];
          const isOpen = expanded === i;
          return (
            <div key={i} onClick={() => setExpanded(isOpen ? null : i)}
              className={`rounded-2xl overflow-hidden cursor-pointer transition-all shadow-sm hover:shadow-md border ${isOpen ? '' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}
              style={isOpen ? {borderColor: cat.col+'50', background: cat.bg} : undefined}>
              <div className="px-3.5 py-2.5 flex items-start gap-2.5">
                <div style={{background:cat.bg, border:`1px solid ${cat.col}30`}} className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 text-sm mt-0.5">{cat.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[12px] text-slate-800 dark:text-slate-100 font-semibold leading-tight flex-1">{item.title}</div>
                    <span style={{color:impCol[item.impact]}} className="text-[9px] font-bold flex-shrink-0 ml-1">{item.impact==='Positive'?'↑':item.impact==='Negative'?'↓':'→'}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span style={{color:cat.col, background:cat.bg}} className="text-[8px] px-1.5 py-[1px] rounded-full font-semibold">{item.category}</span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500">{item.date}</span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 truncate">· {item.source}</span>
                  </div>
                </div>
              </div>
              {isOpen && (
                <div style={{borderTop:`1px solid ${cat.col}20`}} className="px-3.5 py-2.5">
                  <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">{item.summary}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Catalysts & Risk Events */}
      {news.catalysts?.length > 0 && (
        <div className="rounded-2xl p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-400/25">
          <div className="text-[9px] text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-widest mb-2">🚀 Upcoming Catalysts</div>
          <ul className="space-y-1.5">
            {news.catalysts.map((c: string, i: number)=>(
              <li key={i} className="flex items-start gap-2 text-[11px] text-emerald-800 dark:text-emerald-200">
                <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"/>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {news.riskEvents?.length > 0 && (
        <div className="rounded-2xl p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-400/25">
          <div className="text-[9px] text-red-600 dark:text-red-300 font-bold uppercase tracking-widest mb-2">⚠ Risk Events to Watch</div>
          <ul className="space-y-1.5">
            {news.riskEvents.map((r: string, i: number)=>(
              <li key={i} className="flex items-start gap-2 text-[11px] text-red-700 dark:text-red-200">
                <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0"/>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={refresh} className="flex-1 text-xs text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-200 dark:hover:border-blue-500/40 transition-colors">📡 Refresh This Week's Digest</button>
      </div>
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────
// A custom, in-app confirmation dialog — NOT window.confirm(). Native
// confirm() is unreliable across mobile browsers, in-app webviews, and PWA
// contexts (it can silently resolve false without ever showing anything to
// the user), which made permanent-delete confirmations look like "delete
// just doesn't work" on some devices.
function ConfirmModal({message, confirmLabel='Delete', onConfirm, onCancel}: {message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void}) {
  return (
    <div onClick={onCancel} style={{background:'rgba(10,10,10,0.55)', backdropFilter:'blur(4px)'}} className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div onClick={e=>e.stopPropagation()} className="w-full max-w-sm rounded-2xl shadow-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
        <div className="text-[13px] text-slate-700 dark:text-slate-200 mb-4 leading-relaxed">{message}</div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2.5 sm:py-2 rounded-xl text-[12px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2.5 sm:py-2 rounded-xl text-[12px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── DETAIL PANEL ─────────────────────────────────────────────────────────

function DetailPanel({stock, onClose, upd, onMove, onDup, onArc, onDel}: any) {
  const [tab, setTab] = useState('notes');
  const [showAct, setShowAct] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // false = panel closed; 'move' / 'dup' = panel open showing the relevant action's tab grid
  const [showMov, setShowMov] = useState<false | 'move' | 'dup'>(false);
  const { data: px, loading: pxLoading } = useMarketData(stock.name);
  const pos = px ? px.chg >= 0 : true;
  const ptabs = [{id:'notes',l:'Research',e:'📝'},{id:'conv',l:'Conviction',e:'🎯'},{id:'verd',l:'Verdict',e:'⚡'},{id:'news',l:'News',e:'📰'},{id:'mets',l:'Metrics',e:'📊'}];
  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] flex flex-col shadow-2xl bg-white dark:bg-slate-900 border-l-2 border-slate-200 dark:border-slate-700">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-900">
        <div className="flex items-start gap-2 justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <h2 className="text-slate-800 dark:text-slate-100 font-bold text-sm leading-tight">{stock.name}</h2>
              <span className="text-[9px] text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded uppercase tracking-wide font-medium flex-shrink-0">{stock.sector}</span>
              {stock.subSector && <span className="text-[9px] text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/15 border border-violet-100 dark:border-violet-400/20 px-1.5 py-[2px] rounded font-medium flex-shrink-0">{stock.subSector}</span>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge st={stock.st} sm/>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">{stock.cap}</span>
              <div className="flex gap-1 flex-wrap">{stock.src.map(s=><span key={s} title={TAB_FULL[s]||s} className="text-[10px] sm:text-[8px] text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded font-mono cursor-default">{s}</span>)}</div>
            </div>
            <SubSectorEdit stock={stock} upd={upd}/>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <select value={stock.st} onChange={e=>upd({st:e.target.value})} className="text-[10px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none cursor-pointer max-w-[108px]">
              {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <div className="relative">
              <button onClick={()=>setShowAct(!showAct)} aria-label="More actions" className="w-10 h-10 sm:w-7 sm:h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 text-xl leading-none transition-colors">⋮</button>
              {showAct && (
                <div className="absolute right-0 top-8 rounded-2xl shadow-xl z-20 py-1 overflow-hidden min-w-[10rem] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <button onClick={()=>{setShowMov('move');setShowAct(false);}} className="w-full text-left px-3.5 py-2 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">Move to Tab</button>
                  <button onClick={()=>{setShowMov('dup');setShowAct(false);}} className="w-full text-left px-3.5 py-2 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">Duplicate to Tab</button>
                  <div className="my-0.5 border-t border-slate-100 dark:border-slate-700"/>
                  <button onClick={()=>{onArc(stock.id);onClose();}} className="w-full text-left px-3.5 py-2 text-[11px] text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">Archive</button>
                  <button onClick={()=>{setConfirmDel(true);setShowAct(false);}} className="w-full text-left px-3.5 py-2 text-[11px] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">Delete</button>
                </div>
              )}
              {confirmDel && (
                <ConfirmModal
                  message={stock.st === 'High Conviction'
                    ? `"${stock.name}" is a High Conviction idea. Delete it permanently? This cannot be undone — consider Archive instead.`
                    : `Delete "${stock.name}" permanently? This cannot be undone — consider Archive instead if you might want it back.`}
                  onConfirm={()=>{setConfirmDel(false);onDel(stock.id);onClose();}}
                  onCancel={()=>setConfirmDel(false)}
                />
              )}
            </div>
            <button onClick={onClose} aria-label="Close detail panel" className="w-10 h-10 sm:w-7 sm:h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 transition-colors text-base sm:text-sm">✕</button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          {pxLoading ? (
            <div className="flex items-center gap-2 animate-pulse">
              <div className="h-6 w-24 bg-slate-200 dark:bg-slate-700 rounded-xl"/>
              <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded-xl"/>
            </div>
          ) : px ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-black text-slate-800 dark:text-slate-100 font-mono">{fp(px.px)}</span>
              <span className={`text-xs font-bold font-mono ${pos?'text-emerald-500':'text-red-500'}`}>{pos?'+':''}{px.chg.toFixed(2)}%</span>
              <span className="text-[10px] sm:text-[7px] text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/25 px-1.5 py-[2px] rounded-full font-bold">● LIVE NSE</span>
            </div>
          ) : (
            <span className="text-sm text-slate-400 dark:text-slate-500">Data unavailable</span>
          )}
          {px && <div className="text-right text-[10px] text-slate-400 dark:text-slate-500 font-mono">52W: {fp(px.l52)} – {fp(px.h52)}</div>}
        </div>
        <div className="mt-2 h-12 bg-slate-50 dark:bg-slate-800 rounded-xl overflow-hidden"><MiniChart name={stock.name} pos={pos}/></div>
        {showMov && (
          <div className="mt-3 rounded-2xl p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 font-semibold">{showMov==='dup'?'Duplicate to:':'Move to:'}</div>
            <div className="flex flex-wrap gap-1.5">
              {TABS.map(t=>(
                <button key={t} onClick={()=>{showMov==='dup'?onDup(stock.id,t):onMove(stock.id,t);setShowMov(false);}}
                  title={TAB_FULL[t]||t}
                  className="text-[10px] px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 hover:bg-blue-600 hover:text-white hover:border-blue-600 text-slate-600 dark:text-slate-300 transition-colors font-mono">{t}</button>
              ))}
            </div>
            <button onClick={()=>setShowMov(false)} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 mt-1.5 block transition-colors">Cancel</button>
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 px-3 bg-slate-50/60 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
        {ptabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex items-center gap-1 px-2.5 py-2.5 text-[11px] font-semibold transition-colors -mb-px border-b-2 ${tab===t.id?'border-blue-500 text-blue-600 dark:text-blue-400':'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>
            <span>{t.e}</span><span className="hidden sm:inline">{t.l}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50/40 dark:bg-slate-900/60">
        {tab==='notes' && <NotesPanel stock={stock} upd={upd}/>}
        {tab==='conv'  && <ConvictionPanel stock={stock} upd={upd}/>}
        {tab==='verd'  && <VerdictPanel stock={stock} upd={upd}/>}
        {tab==='news'  && <NewsPanel stock={stock} upd={upd}/>}
        {tab==='mets'  && <MetricsPanel stock={stock}/>}
      </div>
    </div>
  );
}

// ─── ADD STOCK MODAL ──────────────────────────────────────────────────────

function AddStockModal({activeTab, stocks, onAdd, onClose}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState(activeTab);
  const [sector, setSector] = useState('');
  const [subSector, setSubSector] = useState('');
  const [subSectorSugg, setSubSectorSugg] = useState([]);
  const [showSubSugg, setShowSubSugg] = useState(false);
  const [cap, setCap] = useState('Small Cap');
  const iRef = useRef(null);
  useEffect(()=>{ iRef.current?.focus(); },[]);
  const known = useMemo(()=>new Set(Object.values(stocks).map((s:any)=>s.name)),[stocks]);
  // Instant local suggestions from the small hardcoded shortlist, while a
  // debounced query against the full NSE-listed universe (~2,400 companies,
  // via nse_equity_master) fills in — so typing an uncommon name still finds
  // its real ticker instead of "Custom — will be added as entered".
  const [nseSugg, setNseSugg] = useState<{n:string;s:string;sym?:string}[]>([]);
  useEffect(()=>{
    if (!q.trim() || tab==='MF') { setNseSugg([]); return; }
    const t = setTimeout(async()=>{
      const matches = await searchNseEquities(q.trim());
      // No sector data in NSE's equity master (it's just symbol/name/ISIN) —
      // leave sector blank for these; `sym` is the real ticker, shown as a
      // preview badge, and kept OUT of the `s` field pick() writes into
      // sector so it can't get mistaken for one.
      setNseSugg(matches.map(m=>({n:m.company_name, s:'', sym:m.symbol})));
    }, 250);
    return ()=>clearTimeout(t);
  },[q, tab]);
  const sugg = useMemo(()=>{
    const qq=q.trim().toLowerCase();
    const local = qq ? UNIVERSE.filter(x=>x.n.toLowerCase().includes(qq)) : UNIVERSE.slice(0,10);
    const seen = new Set(local.map(x=>x.n));
    const merged = [...local] as {n:string;s:string;sym?:string}[];
    for (const m of nseSugg) { if (!seen.has(m.n)) { merged.push(m); seen.add(m.n); } }
    return merged.slice(0,10);
  },[q, nseSugg]);
  // Sector-aware sub-sector suggestions: preset list first, then user-added ones
  const allSubSectors = useMemo(()=>Array.from(new Set(Object.values(stocks).map((s:any)=>s.subSector).filter(Boolean))).sort() as string[],[stocks]);
  const filteredSubSugg = useMemo(()=>{
    const preset = SECTOR_SUBSECTORS[sector] || [];
    const userAdded = allSubSectors.filter(x=>!preset.includes(x));
    const combined = [...preset, ...userAdded];
    if (!subSector.trim()) return combined.slice(0,12);
    const qq = subSector.toLowerCase();
    return combined.filter(x=>x.toLowerCase().includes(qq)).slice(0,12);
  },[subSector, sector, allSubSectors]);
  const pick = (u) => { setSel(u); setQ(u.n); setSector(u.s); };
  // MF tab = free-form name only, no sector / sub-sector / cap. Edge Function
  // skips quote sync for these (they aren't on the stock API).
  const isMF = tab === 'MF';
  const doAdd = () => {
    const nm=sel?sel.n:q.trim(); if (!nm) return;
    const id=uid();
    if (isMF) {
      onAdd(id,{id,name:nm,sector:'Mutual Fund',subSector:'',cap:'—',src:[tab],st:'New Idea',notes:[],sc:{bq:0,mq:0,gv:0,val:0,ts:0},arc:false,vd:null,news:null,kind:'MF'},tab);
    } else {
      const sc=sector||(sel?.s)||SECTORS[0];
      onAdd(id,{id,name:nm,sector:sc,subSector:subSector.trim(),cap,src:[tab],st:'New Idea',notes:[],sc:{bq:0,mq:0,gv:0,val:0,ts:0},arc:false,vd:null,news:null,kind:tab==='ETF'?'ETF':'Stock'},tab);
    }
    onClose();
  };
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{background:'rgba(15,23,42,0.45)',backdropFilter:'blur(8px)'}} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-md rounded-3xl shadow-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-800">
          <h3 className="text-slate-800 dark:text-slate-100 font-bold text-sm">{isMF ? '💼 Add Mutual Fund' : tab==='ETF' ? '📈 Add ETF' : 'Add Stock Idea'}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none transition-colors w-10 h-10 sm:w-auto sm:h-auto flex items-center justify-center -mr-2 sm:m-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative">
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">{isMF ? 'Mutual Fund Name' : 'Stock Name'}</div>
            <input ref={iRef} value={q} onChange={e=>{setQ(e.target.value);setSel(null);}}
              placeholder={isMF ? 'e.g. Parag Parikh Flexi Cap Fund…' : 'Search or enter stock name…'}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20"/>
            {!isMF && q && !sel && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-2xl shadow-xl z-10 max-h-52 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                {sugg.length===0 && <div className="px-3 py-3 text-[11px] text-slate-400 dark:text-slate-500">Custom — will be added as entered</div>}
                {sugg.map(u=>(
                  <button key={u.n} onClick={()=>pick(u)} className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-slate-700 flex items-center justify-between transition-colors">
                    <span className="text-sm text-slate-800 dark:text-slate-100 font-medium">{u.n}</span>
                    <div className="flex items-center gap-1.5">{known.has(u.n)&&<span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">✓ tracked</span>}<span className="text-[9px] text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded font-mono">{u.sym || u.s}</span></div>
                  </button>
                ))}
              </div>
            )}
            {isMF && (
              <div className="mt-2 text-[10px] text-violet-500 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-400/25 rounded-xl px-3 py-2">
                ✦ Type any MF name — we don't auto-fetch fund data. Use the notes inside to track NAV, expense ratio, AUM yourself.
              </div>
            )}
          </div>
          {!isMF && (<>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Sector</div>
              <select value={sector} onChange={e=>setSector(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer">
                <option value="">Select sector…</option>
                {SECTORS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="relative">
              <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold flex items-center gap-1">
                Sub-Sector <span className="text-violet-400 dark:text-violet-400/80 normal-case tracking-normal font-normal">(your own)</span>
              </div>
              <input value={subSector} onChange={e=>{setSubSector(e.target.value);setShowSubSugg(true);}}
                onFocus={()=>setShowSubSugg(true)} onBlur={()=>setTimeout(()=>setShowSubSugg(false),150)}
                placeholder="e.g. EMS, API, T&D…"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-violet-200 dark:border-violet-400/30 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-500/20"/>
              {showSubSugg && filteredSubSugg.length>0 && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-2xl shadow-xl z-20 max-h-36 overflow-y-auto bg-white dark:bg-slate-800 border border-violet-100 dark:border-violet-400/20">
                  {filteredSubSugg.map(s=>(
                    <button key={s} onMouseDown={()=>{setSubSector(s);setShowSubSugg(false);}} className="w-full text-left px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors font-medium">{s}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Market Cap</div>
            <div className="grid grid-cols-4 gap-2">
              {CAPS.map(c=>(
                <button key={c} onClick={()=>setCap(c)}
                  className={`text-[10px] px-1 py-1.5 rounded-xl transition-all font-medium ${cap===c?'':'border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-400'}`}
                  style={cap===c?{border:'2px solid #3b82f6',background:'#eff6ff',color:'#2563eb'}:undefined}>{c.replace(' Cap','')}</button>
              ))}
            </div>
          </div>
          </>)}
          <div>
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Add to Watchlist</div>
            <div className="flex flex-wrap gap-1.5">
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)} title={TAB_FULL[t]||t}
                  className={`text-[10px] px-2.5 py-1 rounded-full transition-all font-mono font-medium ${tab===t?'':'border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-400'}`}
                  style={tab===t?{border:'2px solid #3b82f6',background:'#eff6ff',color:'#2563eb'}:undefined}>{t.toUpperCase()}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-sm transition-colors border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 font-medium">Cancel</button>
          <button onClick={doAdd} disabled={!q.trim()} style={q.trim()?{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}:{}} className="flex-1 py-2.5 rounded-2xl disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:opacity-50 text-white font-semibold text-sm transition-all hover:opacity-90 shadow-lg shadow-blue-200">Add to Notebook</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD WATCH MODAL ──────────────────────────────────────────────────────

function AddWatchModal({onAdd, onClose}) {
  const [name, setName] = useState('');
  const [tags, setTags] = useState([]);
  const [note, setNote] = useState('');
  const [sel, setSel] = useState(null);
  const iRef = useRef(null);
  useEffect(()=>{ iRef.current?.focus(); },[]);
  const sugg = useMemo(()=>{ if (!name.trim()) return UNIVERSE.slice(0,8); const q=name.toLowerCase(); return UNIVERSE.filter(x=>x.n.toLowerCase().includes(q)).slice(0,8); },[name]);
  const toggleTag = (id) => setTags(t=>t.includes(id)?t.filter(x=>x!==id):[...t,id]);
  const doAdd = () => {
    const nm=sel?.n||name.trim(); if (!nm) return;
    onAdd({id:uid(),name:nm,sector:sel?.s||'',tags,note:note.trim()}); onClose();
  };
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{background:'rgba(15,23,42,0.45)',backdropFilter:'blur(8px)'}} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-sky-50 to-white dark:from-slate-800 dark:to-slate-800">
          <div className="flex items-center justify-between">
            <div><h3 className="text-slate-800 dark:text-slate-100 font-bold text-sm">Add to Watch Radar</h3><div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Track stocks near EMAs or upcoming events</div></div>
            <button onClick={onClose} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none transition-colors w-10 h-10 sm:w-auto sm:h-auto flex items-center justify-center -mr-2 sm:m-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative">
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Stock Name</div>
            <input ref={iRef} value={name} onChange={e=>{setName(e.target.value);setSel(null);}} placeholder="Search stock name…"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400"/>
            {name && !sel && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-2xl shadow-xl z-10 max-h-44 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                {sugg.map(u=>(
                  <button key={u.n} onClick={()=>{setSel(u);setName(u.n);}} className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-slate-700 flex items-center justify-between transition-colors">
                    <span className="text-sm text-slate-800 dark:text-slate-100">{u.n}</span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded">{u.s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 font-semibold">Watch Reason</div>
            <div className="grid grid-cols-2 gap-2">
              {WATCH_TAGS.map(t=>(
                <button key={t.id} onClick={()=>toggleTag(t.id)}
                  className={`text-[10px] px-2.5 py-2 rounded-2xl transition-all flex items-center gap-1.5 font-semibold ${tags.includes(t.id)?'':'border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-400'}`}
                  style={tags.includes(t.id)?{border:`2px solid ${t.col}`,background:t.bg,color:t.col}:undefined}>
                  <span>{t.icon}</span><span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Quick Note</div>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Setup or event notes…"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-sm border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 font-medium transition-colors">Cancel</button>
          <button onClick={doAdd} disabled={!name.trim()} style={name.trim()?{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}:{}} className="flex-1 py-2.5 rounded-2xl disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:opacity-50 text-white font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-blue-200">Add to Radar</button>
        </div>
      </div>
    </div>
  );
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────

function GlobalSearch({stocks, onClose, onSel}) {
  const [q, setQ] = useState('');
  const iRef = useRef(null);
  useEffect(()=>{ iRef.current?.focus(); },[]);
  useEffect(()=>{ const h=e=>{if(e.key==='Escape') onClose();}; window.addEventListener('keydown',h); return()=>window.removeEventListener('keydown',h); },[onClose]);
  const res = useMemo(()=>{
    if (!q.trim()) return [];
    const qq=q.toLowerCase();
    return (Object.values(stocks) as any[]).filter((s:any)=>!s.arc&&(s.name.toLowerCase().includes(qq)||s.sector.toLowerCase().includes(qq)||(s.subSector||'').toLowerCase().includes(qq)||s.st.toLowerCase().includes(qq)||s.src.some((x:string)=>x.toLowerCase().includes(qq)||(TAB_FULL[x]||'').toLowerCase().includes(qq))||s.notes.some((n:any)=>n.txt.toLowerCase().includes(qq))));
  },[q,stocks]);
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{background:'rgba(15,23,42,0.45)',backdropFilter:'blur(10px)'}} className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <span className="text-slate-400 text-sm">🔍</span>
          <input ref={iRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search stocks, notes, sectors, sources…" className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"/>
          <button onClick={onClose} aria-label="Close search" className="text-[11px] sm:text-[9px] text-slate-400 dark:text-slate-300 bg-slate-200 dark:bg-slate-700 px-2 sm:px-1.5 py-1 sm:py-0.5 rounded font-mono hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors min-h-[32px] sm:min-h-0">ESC</button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {!q && <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-xs">Search across all stocks, notes, sectors &amp; sources</div>}
          {q && res.length===0 && <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-xs">No results found</div>}
          {res.map(s=>{
            const mn = q && s.notes.find(n=>n.txt.toLowerCase().includes(q.toLowerCase()));
            return (
              <button key={s.id} onClick={()=>onSel(s.id)} className="w-full text-left px-4 py-3 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors border-b border-slate-50 dark:border-slate-700/50">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2"><span className="text-sm text-slate-800 dark:text-slate-100 font-semibold">{s.name}</span><span className="text-[9px] text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-[2px] rounded">{s.sector}</span></div>
                  <Badge st={s.st} sm/>
                </div>
                <div className="flex items-center gap-2">{s.src.map(x=><span key={x} title={TAB_FULL[x]||x} className="text-[9px] text-slate-400 dark:text-slate-500 font-mono">{x}</span>)}{s.notes.length>0&&<span className="text-[9px] text-slate-400 dark:text-slate-500">✎{s.notes.length}</span>}</div>
                {mn && <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 italic truncate">"{mn.txt.slice(0,90)}…"</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── IPO VIEW ─────────────────────────────────────────────────────────────

const IPO_SIGNALS = [
  {id:'Strong Buy', col:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'🟢'},
  {id:'Watch',      col:'#f59e0b', bg:'rgba(245,158,11,0.12)', icon:'🟡'},
  {id:'Avoid',      col:'#ef4444', bg:'rgba(239,68,68,0.12)',  icon:'🔴'},
];

function daysToListing(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr).getTime() - new Date().getTime()) / (1000*60*60*24));
  if (diff < 0) return `Listed ${Math.abs(diff)}d ago`;
  if (diff === 0) return 'Listing Today! 🚀';
  return `${diff}d to listing`;
}

function AddIpoModal({onAdd, onClose}) {
  const [name, setName]            = useState('');
  const [issuePrice, setIssuePrice]= useState('');
  const [listingDate, setListingDate]=useState('');
  const [gmp, setGmp]              = useState('');
  const [signal, setSignal]        = useState('Watch');
  const [notes, setNotes]          = useState('');
  const iRef = useRef(null);
  useEffect(()=>{ iRef.current?.focus(); },[]);

  const doAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: uid(), name: name.trim(),
      issuePrice: issuePrice ? +issuePrice : null,
      listingDate: listingDate || null,
      gmp: gmp ? +gmp : null,
      signal, notes: notes.trim(),
      addedDate: tdStr(),
    });
    onClose();
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{background:'rgba(15,23,42,0.45)',backdropFilter:'blur(8px)'}}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-amber-50 to-white dark:from-slate-800 dark:to-slate-800">
          <div>
            <div className="text-slate-800 dark:text-slate-100 font-bold text-sm">Add IPO</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Track upcoming IPO · Buy signal on listing</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-lg transition-colors w-10 h-10 sm:w-auto sm:h-auto flex items-center justify-center -mr-2 sm:m-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Company Name</div>
            <input ref={iRef} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. HDB Financial Services"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-400"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Issue Price ₹</div>
              <input type="number" value={issuePrice} onChange={e=>setIssuePrice(e.target.value)} placeholder="₹ 0"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-400"/>
            </div>
            <div>
              <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">GMP ₹ <span className="text-slate-400 dark:text-slate-500 normal-case font-normal">(optional)</span></div>
              <input type="number" value={gmp} onChange={e=>setGmp(e.target.value)} placeholder="₹ GMP"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-400"/>
            </div>
          </div>
          <div>
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Listing Date</div>
            <input type="date" value={listingDate} onChange={e=>setListingDate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-amber-400"/>
          </div>
          <div>
            <div className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 font-semibold">Buy Signal on Listing</div>
            <div className="grid grid-cols-3 gap-2">
              {IPO_SIGNALS.map(s=>(
                <button key={s.id} onClick={()=>setSignal(s.id)}
                  className={`text-[11px] py-2 rounded-2xl transition-all font-bold text-center ${signal===s.id?'':'border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-400'}`}
                  style={signal===s.id?{border:`2px solid ${s.col}`,background:s.bg,color:s.col}:undefined}>
                  {s.icon} {s.id}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] sm:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">Notes</div>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2}
              placeholder="Research notes, reasons, key metrics…"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none"/>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={doAdd} disabled={!name.trim()}
            style={name.trim()?{background:'linear-gradient(135deg,#f59e0b,#d97706)'}:{}}
            className="flex-1 py-2.5 rounded-2xl disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:opacity-50 text-white font-bold text-sm hover:opacity-90 transition-all shadow-lg shadow-amber-200">
            Add IPO
          </button>
        </div>
      </div>
    </div>
  );
}

// Live IPO feed from indianapi.in. Shows ONLY currently-actionable IPOs
// (open for bidding, closed awaiting listing, recently listed). Upcoming
// and pre-apply buckets are omitted — those are info-only.
//
// For Active IPOs, the user can save their view (Strong Buy / Watch /
// Avoid). Views persist to notebook_store.ipo_views keyed by IPO symbol.
const IPO_VIEWS = [
  { id: 'Strong Buy', col: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '🟢' },
  { id: 'Watch',      col: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🟡' },
  { id: 'Avoid',      col: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: '🔴' },
];

function LiveIposSection() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Persistent per-IPO user views: { "CSM": "Strong Buy", "SPGCL": "Avoid", … }
  const [views, setViews] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      try {
        const [ipos, savedViews] = await Promise.all([fetchIpos(), sbGet('ipo_views')]);
        setRows(ipos);
        if (savedViews && typeof savedViews === 'object') setViews(savedViews);
      } catch {}
      setLoading(false);
    })();
  }, []);
  const setView = (symbol: string, v: string | null) => {
    setViews(prev => {
      const next = { ...prev };
      if (v === null) delete next[symbol]; else next[symbol] = v;
      sbSet('ipo_views', next).catch(() => {});
      return next;
    });
  };
  // Only "active" (currently open for bidding) is shown — upcoming, pre_apply,
  // closed, and listed are all dropped. This mirrors what the backend now
  // fetches/stores: market_ipos only ever holds status='active' rows.
  const buckets: Array<{key: string; label: string; icon: string; col: string}> = [
    {key:'active', label:'Currently Open (Apply Now)', icon:'🟢', col:'#22c55e'},
  ];
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of rows) {
      const k = String(r?.status || '').toLowerCase();
      if (k !== 'active') continue;
      (g[k] = g[k] || []).push(r);
    }
    return g;
  }, [rows]);
  const visibleCount = Object.values(grouped).reduce((n, l) => n + l.length, 0);
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '—';
  return (
    <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🌐</span>
          <div>
            <div className="text-[13px] sm:text-[12px] font-bold text-slate-800 dark:text-slate-100">Live IPO Feed</div>
            <div className="text-[10px] sm:text-[9px] text-slate-400 dark:text-slate-500">From indianapi.in · synced daily 4 PM IST · actionable only</div>
          </div>
        </div>
        <div className="text-[11px] sm:text-[10px] text-slate-400 dark:text-slate-500">{loading ? 'Loading…' : `${visibleCount} IPOs`}</div>
      </div>
      {!loading && visibleCount === 0 && (
        <div className="px-4 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500">No IPOs are currently open for bidding.</div>
      )}
      {buckets.map(b => {
        const list = grouped[b.key] || [];
        if (list.length === 0) return null;
        return (
          <div key={b.key} className="border-t border-slate-100 dark:border-slate-700 first:border-t-0">
            <div className="px-4 py-2 flex items-center gap-2 bg-slate-50/60 dark:bg-slate-900/40">
              <span className="text-[10px]">{b.icon}</span>
              <span style={{color:b.col}} className="text-[9px] font-bold uppercase tracking-widest">{b.label}</span>
              <span className="text-[9px] text-slate-400 ml-auto">{list.length}</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {list.map((x: any) => {
                const userView = views[x.symbol] || null;
                return (
                  <div key={x.symbol} className="px-3 sm:px-4 py-2.5 flex items-start gap-2 sm:gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate">{x.name}</span>
                        <span className="text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-500 font-mono">{x.symbol}</span>
                        {x.is_sme && <span className="text-[10px] sm:text-[8px] bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-[1px] rounded-full font-semibold">SME</span>}
                        {/* Show the user's saved view as a tiny inline badge */}
                        {userView && (
                          <span style={{color: IPO_VIEWS.find(v=>v.id===userView)?.col, background: IPO_VIEWS.find(v=>v.id===userView)?.bg}} className="text-[10px] sm:text-[8px] font-bold px-1.5 py-[1px] rounded-full">
                            {IPO_VIEWS.find(v=>v.id===userView)?.icon} {userView}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] sm:text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{x.additional_text || '—'}</div>
                      {/* On phones the metadata fields stack vertically; on sm+ they flow inline */}
                      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-y-0.5 gap-x-3 mt-1 text-[11px] sm:text-[9px] text-slate-400 dark:text-slate-500">
                        {(x.min_price || x.max_price) && <span>Band: ₹{x.min_price ?? '?'}–₹{x.max_price ?? '?'}</span>}
                        {x.lot_size && <span>Lot: {x.lot_size}</span>}
                        {x.bidding_start_date && <span>Bid: {fmtDate(x.bidding_start_date)} → {fmtDate(x.bidding_end_date)}</span>}
                        {x.listing_date && <span>Listing: {fmtDate(x.listing_date)}</span>}
                        {x.total_subscription_rate != null && <span style={{color:x.total_subscription_rate>=1?'#22c55e':'#94a3b8'}} className="font-bold">Sub: {Number(x.total_subscription_rate).toFixed(2)}x</span>}
                      </div>
                      {/* MY VIEW — saves to notebook_store. Only "active" IPOs ever reach
                          this component now, so no status gate needed. */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold mr-1 w-full sm:w-auto">My View</span>
                        {IPO_VIEWS.map(v => {
                          const sel = userView === v.id;
                          return (
                            <button key={v.id} onClick={() => setView(x.symbol, sel ? null : v.id)}
                              title={sel ? `Clear ${v.id}` : `Mark as ${v.id}`}
                              className={`text-[11px] sm:text-[9px] px-3 sm:px-2 py-1.5 sm:py-[3px] rounded-full font-bold transition-all min-h-[36px] sm:min-h-0 ${sel ? '' : 'border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'}`}
                              style={sel ? {color:v.col, background:v.bg, border:`1.5px solid ${v.col}`} : undefined}>
                              {v.icon} {v.id}
                            </button>
                          );
                        })}
                        {userView && (
                          <button onClick={() => setView(x.symbol, null)} className="text-[10px] sm:text-[8px] text-slate-300 dark:text-slate-600 hover:text-red-400 transition-colors ml-0.5 px-2 py-1">clear</button>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {x.document_url && (
                        <a href={x.document_url} target="_blank" rel="noopener noreferrer" className="text-[11px] sm:text-[9px] text-blue-500 dark:text-blue-400 hover:underline">RHP →</a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IpoView({ipoList, onAdd, onDelete, onUpdateSignal}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId]   = useState(null);

  const upcoming = ipoList.filter((x:any)=>x.listingDate && new Date(x.listingDate) >= new Date()).sort((a:any,b:any)=>new Date(a.listingDate).getTime()-new Date(b.listingDate).getTime());
  const past     = ipoList.filter((x:any)=>!x.listingDate || new Date(x.listingDate) < new Date()).sort((a:any,b:any)=>new Date(b.listingDate||0).getTime()-new Date(a.listingDate||0).getTime());

  const IpoCard = ({ipo}) => {
    const sig = IPO_SIGNALS.find(s=>s.id===ipo.signal)||IPO_SIGNALS[1];
    const daysLeft = daysToListing(ipo.listingDate);
    const gmpPct = ipo.issuePrice && ipo.gmp ? ((ipo.gmp/ipo.issuePrice)*100).toFixed(1) : null;
    return (
      <div style={{borderColor:`${sig.col}25`,boxShadow:`0 2px 12px ${sig.col}12`}} className="rounded-2xl p-4 transition-all hover:shadow-md bg-white dark:bg-slate-800 border-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-black text-slate-800 dark:text-slate-100 leading-tight">{ipo.name}</div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {/* Signal badge */}
              <span style={{color:sig.col,background:sig.bg,border:`1px solid ${sig.col}40`}} className="text-[10px] font-bold px-2 py-[3px] rounded-full">{sig.icon} {sig.id}</span>
              {/* Days to listing */}
              {daysLeft && (
                <span className="text-[10px] font-semibold px-2 py-[3px] rounded-full"
                  style={daysLeft.includes('Today')?{color:'#22c55e',background:'rgba(34,197,94,0.10)'}:daysLeft.includes('ago')?{color:'#94a3b8',background:'rgba(148,163,184,0.12)'}:{color:'#3b82f6',background:'rgba(59,130,246,0.10)'}}>
                  🗓 {daysLeft}
                </span>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            {ipo.issuePrice && <div className="text-[13px] font-black text-slate-800 dark:text-slate-100 font-mono">₹{ipo.issuePrice.toLocaleString('en-IN')}</div>}
            {ipo.issuePrice && <div className="text-[9px] text-slate-400 dark:text-slate-500">Issue Price</div>}
          </div>
        </div>

        {/* GMP row */}
        {ipo.gmp != null && (
          <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
            <div className="text-center">
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">GMP</div>
              <div className="text-[13px] font-black text-emerald-600 dark:text-emerald-400 font-mono">+₹{ipo.gmp}</div>
            </div>
            {gmpPct && <>
              <div className="w-px h-8 bg-slate-200 dark:bg-slate-700"/>
              <div className="text-center">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">GMP %</div>
                <div className="text-[13px] font-black text-emerald-600 dark:text-emerald-400">+{gmpPct}%</div>
              </div>
              <div className="w-px h-8 bg-slate-200 dark:bg-slate-700"/>
              <div className="text-center">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Est. Listing</div>
                <div className="text-[13px] font-black text-slate-800 dark:text-slate-100 font-mono">₹{(ipo.issuePrice+ipo.gmp).toLocaleString('en-IN')}</div>
              </div>
            </>}
          </div>
        )}

        {/* Listing date */}
        {ipo.listingDate && (
          <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            📅 Listing: <span className="font-bold text-slate-700 dark:text-slate-200">{new Date(ipo.listingDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
          </div>
        )}

        {/* Notes */}
        {ipo.notes && <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-700 pt-2">{ipo.notes}</p>}

        {/* Change signal + delete */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-1.5">
            {IPO_SIGNALS.map(s=>(
              <button key={s.id} onClick={()=>onUpdateSignal(ipo.id, s.id)}
                className={`text-[9px] px-2 py-1 rounded-full transition-all font-bold ${ipo.signal===s.id?'':'border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-400'}`}
                style={ipo.signal===s.id?{border:`1.5px solid ${s.col}`,background:s.bg,color:s.col}:undefined}>{s.icon} {s.id}</button>
            ))}
          </div>
          <button onClick={()=>onDelete(ipo.id)} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">Delete</button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 pb-10 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}} className="w-9 h-9 rounded-2xl flex items-center justify-center text-xl shadow-md shadow-amber-200">🏷</div>
          <div>
            <div className="text-slate-800 dark:text-slate-100 font-black text-base">IPO Watch</div>
            <div className="text-slate-400 dark:text-slate-500 text-[10px]">{upcoming.length} upcoming · {past.length} listed</div>
          </div>
        </div>
        <button onClick={()=>setShowAdd(true)}
          style={{background:'linear-gradient(135deg,#f59e0b,#d97706)',boxShadow:'0 2px 8px rgba(245,158,11,0.35)'}}
          className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-white text-[11px] font-black hover:opacity-90 transition-opacity">
          + Add IPO
        </button>
      </div>

      {/* Live IPO feed from indianapi.in (above user's tracked IPOs) */}
      <LiveIposSection/>

      {/* Empty */}
      {ipoList.length===0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-100 dark:border-amber-400/25 flex items-center justify-center text-3xl">🏷</div>
          <div className="text-slate-500 dark:text-slate-400 text-sm text-center">No IPOs added yet</div>
          <button onClick={()=>setShowAdd(true)} style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}} className="text-white text-sm px-5 py-2.5 rounded-2xl font-bold hover:opacity-90 transition-opacity shadow-lg shadow-amber-200">
            + Add First IPO
          </button>
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length>0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Upcoming</span>
            <span className="text-[9px] text-blue-500 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-400/25 px-1.5 py-[2px] rounded-full font-bold">{upcoming.length}</span>
            <div className="flex-1 h-px bg-blue-100 dark:bg-blue-500/20"/>
          </div>
          <div className="space-y-3">{upcoming.map(ipo=><IpoCard key={ipo.id} ipo={ipo}/>)}</div>
        </div>
      )}

      {/* Listed / Past */}
      {past.length>0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Listed / No Date</span>
            <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700"/>
          </div>
          <div className="space-y-3">{past.map(ipo=><IpoCard key={ipo.id} ipo={ipo}/>)}</div>
        </div>
      )}

      {showAdd && <AddIpoModal onAdd={ipo=>{onAdd(ipo);setShowAdd(false);}} onClose={()=>setShowAdd(false)}/>}
    </div>
  );
}

// ─── SECTORS NOTEBOOK ────────────────────────────────────────────────────

// ─── SECTOR TAGS ─────────────────────────────────────────────────────────

const SECTOR_TAGS = {
  'Hot':  { col:'#ef4444', bg:'#fee2e2', border:'#fca5a5', icon:'🔥' },
  'Wait': { col:'#f59e0b', bg:'#fef3c7', border:'#fcd34d', icon:'⏳' },
  'Dead': { col:'#94a3b8', bg:'#f1f5f9', border:'#cbd5e1', icon:'💀' },
};

const SECT_ICON = {'Aerospace & Defence':'✈️','Agrochemicals & Fertilisers':'🌱','Auto Sector':'🚗','Auto Ancillary':'⚙️','Chemicals':'⚗️','Construction':'🏗️','Consumer Discretionary':'🛍️','Consumer Durables':'📺','Consumer Services':'🛎️','Dredging':'⚓','Electric Equipment':'⚡','Electronics':'💻','Energy':'⛽','Finance':'💰','FMCG':'🛒','Ghar Gharana':'🏠','Healthcare':'💊','Industrial Manufacturing':'🏭','Infrastructure':'🛤️','IT':'🖥️','Leisure Services':'🎭','Metal, Mineral & Mining':'⛏️','Oil & Gas':'🛢️','Paper, Forest & Jute':'📄','Pharma':'💉','Power':'🔋','Printing & Publication':'📰','Railways':'🚂','Real Estate':'🏢','Retailing':'🏪','Telecom':'📡','Textile':'🧵','Transport Infrastructure':'🚢','Transport Services':'🚛','Utility':'💧','Aviation':'✈️'};

function SectorsView({sectorNotes, sectorTags, onSave, onTag}) {

  // ── Key helpers (~ separator; backward-compatible with plain sector keys) ──
  const SEP          = '~';
  const subsListKey  = (s)          => `${s}${SEP}subs`;
  const pcKey        = (s, sub)     => sub ? `${s}${SEP}${sub}${SEP}pc` : `${s}${SEP}pc`;
  const noteKey      = (s, sub, pg) => { const b = sub ? `${s}${SEP}${sub}` : s; return pg > 1 ? `${b}${SEP}p${pg}` : b; };
  const getSubs      = (s)          => { const v = sectorNotes[subsListKey(s)]; return Array.isArray(v) ? v : []; };
  const getPageCount = (s, sub)     => Math.max(1, +(sectorNotes[pcKey(s, sub)] || 1));

  // ── State ─────────────────────────────────────────────────────────────────
  const [sel,          setSel]          = useState(SECTORS[0]);
  const [selSub,       setSelSub]       = useState(null);
  const [page,         setPage]         = useState(1);
  const [draft,        setDraft]        = useState('');
  const [saved,        setSaved]        = useState(true);
  const [tagFilter,    setTagFilter]    = useState('All');
  const [expanded,     setExpanded]     = useState({});
  const [addingSubFor, setAddingSubFor] = useState(null);
  const [newSubName,   setNewSubName]   = useState('');

  // Load draft whenever selection or page changes
  useEffect(() => {
    setDraft(sectorNotes[noteKey(sel, selSub, page)] || '');
    setSaved(true);
  }, [sel, selSub, page]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const doSave      = (val?: string) => { onSave(noteKey(sel, selSub, page), val ?? draft); setSaved(true); };
  const selectSec   = (s)         => { setSel(s); setSelSub(null); setPage(1); setExpanded(p=>({...p,[s]:true})); };
  const selectSub   = (s, sub)    => { setSel(s); setSelSub(sub);  setPage(1); };

  const addSubsector = (sectorName) => {
    const name = newSubName.trim();
    if (!name) return;
    const existing = getSubs(sectorName);
    if (!existing.includes(name)) onSave(subsListKey(sectorName), [...existing, name]);
    setAddingSubFor(null); setNewSubName('');
    selectSub(sectorName, name);
  };

  const deleteSub = (sectorName, subName) => {
    onSave(subsListKey(sectorName), getSubs(sectorName).filter(x => x !== subName));
    if (sel === sectorName && selSub === subName) selectSec(sectorName);
  };

  const addPage = () => {
    const newPc = getPageCount(sel, selSub) + 1;
    onSave(pcKey(sel, selSub), newPc);
    if (!saved) doSave();
    setPage(newPc);
    setDraft('');
    setSaved(true);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const tag       = sectorTags?.[sel] || null;
  const tagMeta   = tag ? SECTOR_TAGS[tag] : null;
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const pageCount = getPageCount(sel, selSub);
  const pages     = Array.from({length: pageCount}, (_, i) => i + 1);

  const filteredSectors = tagFilter === 'All'
    ? SECTORS
    : SECTORS.filter(s => (sectorTags?.[s] || null) === tagFilter);

  return (
    <div className="flex" style={{height:'calc(100vh - 108px)'}}>

      {/* ── LEFT SIDEBAR ────────────────────────────────────────────────── */}
      <div className="w-40 sm:w-48 lg:w-56 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-3 pt-4 pb-2 text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          📒 Sectors
        </div>

        {/* Tag filter */}
        <div className="px-2 py-2 flex gap-1 flex-wrap border-b border-slate-100 dark:border-slate-800 flex-shrink-0 bg-white dark:bg-slate-900">
          {['All','Hot','Wait','Dead'].map(f => {
            const meta   = f !== 'All' ? SECTOR_TAGS[f] : null;
            const active = tagFilter === f;
            return (
              <button key={f} onClick={() => setTagFilter(f)}
                className={`text-[8px] font-bold px-2 py-[3px] rounded-full transition-all whitespace-nowrap ${active?'':'text-slate-400 dark:text-slate-500 bg-transparent border border-slate-200 dark:border-slate-700'}`}
                style={active && meta
                  ? {color:meta.col, background:meta.bg, border:`1.5px solid ${meta.col}`}
                  : active
                    ? {color:'#2563eb', background:'#eff6ff', border:'1.5px solid #3b82f6'}
                    : undefined}>
                {meta ? `${meta.icon} ${f}` : '☰ All'}
              </button>
            );
          })}
        </div>

        {/* Sector + subsector list */}
        <div className="flex-1 overflow-y-auto">
          {filteredSectors.length === 0 && (
            <div className="text-center text-slate-400 dark:text-slate-500 text-[10px] py-10 px-3 leading-relaxed">
              No sectors tagged<br/>"{tagFilter}"
            </div>
          )}
          {filteredSectors.map(s => {
            const t       = sectorTags?.[s] || null;
            const tm      = t ? SECTOR_TAGS[t] : null;
            const sActive = sel === s && !selSub;
            const subs    = getSubs(s);
            const isExp   = !!(expanded[s] || sel === s);
            const hasNote = !!(sectorNotes[s]?.trim());

            return (
              <div key={s}>
                {/* Sector row */}
                <div className={`flex items-center ${sActive?'bg-blue-50 dark:bg-blue-500/10 border-r-[2.5px] border-blue-500':''}`}>
                  <button
                    onClick={() => setExpanded(p=>({...p,[s]:!isExp}))}
                    className="pl-2 pr-1 py-2 text-[8px] text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 flex-shrink-0 transition-colors w-5">
                    {isExp ? '▼' : '▶'}
                  </button>
                  <button
                    onClick={() => selectSec(s)}
                    className="flex-1 text-left py-2 pr-2 flex items-center justify-between gap-1 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className={`text-[11px] font-semibold truncate ${sActive?'text-blue-700 dark:text-blue-300':'text-slate-600 dark:text-slate-300'}`}>{s}</div>
                      {(hasNote||subs.length>0) && (
                        <div className="text-[7px] text-slate-400 dark:text-slate-500 flex gap-1">
                          {hasNote && <span>✎</span>}
                          {subs.length>0 && <span>{subs.length} sub</span>}
                        </div>
                      )}
                    </div>
                    {tm && <span style={{color:tm.col,background:tm.bg,border:`1px solid ${tm.border}`}} className="flex-shrink-0 text-[9px] font-bold px-1.5 py-[2px] rounded-full leading-none">{tm.icon}</span>}
                  </button>
                </div>

                {/* Expanded subsectors */}
                {isExp && (
                  <div className="pl-5">
                    {/* Subsector items */}
                    {subs.map(sub => {
                      const subActive  = sel===s && selSub===sub;
                      const subHasNote = !!(sectorNotes[noteKey(s, sub, 1)]?.trim());
                      return (
                        <div key={sub}
                          className={`flex items-center group/sub ${subActive?'bg-emerald-50 dark:bg-emerald-500/10 border-r-2 border-emerald-500':''}`}>
                          <button
                            onClick={() => selectSub(s, sub)}
                            className="flex-1 text-left px-2 py-1 flex items-center gap-1.5 min-w-0">
                            <span className="text-slate-300 dark:text-slate-600 text-[8px] flex-shrink-0">└</span>
                            <span className={`text-[10px] font-medium truncate flex-1 ${subActive?'text-emerald-700 dark:text-emerald-300':'text-slate-500 dark:text-slate-400'}`}>{sub}</span>
                            {subHasNote && <span className="text-[7px] text-slate-400 dark:text-slate-500">✎</span>}
                          </button>
                          <button
                            onClick={() => deleteSub(s, sub)}
                            className="opacity-0 group-hover/sub:opacity-100 pr-2 text-[9px] text-slate-300 dark:text-slate-600 hover:text-red-400 transition-all flex-shrink-0 leading-none">
                            ×
                          </button>
                        </div>
                      );
                    })}

                    {/* Add subsector input or button */}
                    {addingSubFor === s ? (
                      <div className="flex items-center gap-1 px-2 py-1">
                        <span className="text-slate-300 dark:text-slate-600 text-[8px] flex-shrink-0">└</span>
                        <input
                          autoFocus
                          value={newSubName}
                          onChange={e => setNewSubName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key==='Enter') addSubsector(s);
                            if (e.key==='Escape') { setAddingSubFor(null); setNewSubName(''); }
                          }}
                          placeholder="Sub-sector name…"
                          className="flex-1 min-w-0 text-[10px] bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-400/30 rounded-lg px-2 py-0.5 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                        />
                        <button onClick={() => addSubsector(s)} aria-label="Confirm sub-sector"
                          className="flex-shrink-0 text-[11px] sm:text-[9px] bg-emerald-500 hover:bg-emerald-600 text-white w-7 h-7 sm:w-5 sm:h-5 rounded-md font-bold transition-colors flex items-center justify-center">✓</button>
                        <button onClick={() => { setAddingSubFor(null); setNewSubName(''); }} aria-label="Cancel"
                          className="flex-shrink-0 text-[11px] sm:text-[9px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 w-7 h-7 sm:w-5 sm:h-5 flex items-center justify-center transition-colors">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingSubFor(s); setNewSubName(''); }}
                        className="w-full text-left px-2 py-1 flex items-center gap-1.5 text-[9px] text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors group/add">
                        <span className="text-slate-200 dark:text-slate-700 flex-shrink-0 text-[8px]">└</span>
                        <span className="group-hover/add:text-emerald-600 dark:group-hover/add:text-emerald-400">+ Add Sub-Sector</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── NOTEBOOK AREA ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-[#d1d5db] dark:bg-slate-950">
        <div className="max-w-2xl mx-auto py-6 px-4">
          <div className="rounded-sm overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.18),0_1px_4px_rgba(0,0,0,0.10)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)]">

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex-wrap gap-y-1 bg-slate-50 dark:bg-slate-800 backdrop-blur">

              {/* Left: breadcrumb */}
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span className="text-sm">{(SECT_ICON||{})[sel]||'📋'}</span>
                <span className="font-black text-slate-800 dark:text-slate-100 text-[13px] truncate">{sel}</span>
                {selSub && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600 text-[10px]">›</span>
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 truncate">{selSub}</span>
                  </>
                )}
                {tagMeta && (
                  <span style={{color:tagMeta.col,background:tagMeta.bg,border:`1.5px solid ${tagMeta.border}`}}
                    className="text-[9px] font-bold px-2 py-[2px] rounded-full flex-shrink-0">
                    {tagMeta.icon} {tag}
                  </span>
                )}
              </div>

              {/* Right: tags + pages + save */}
              <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                {/* Hot/Wait/Dead tags — only for root sector */}
                {!selSub && Object.entries(SECTOR_TAGS).map(([k,v]) => (
                  <button key={k} onClick={() => onTag(sel, tag===k ? null : k)}
                    className={`text-[8px] font-bold px-1.5 py-[2px] rounded-full transition-all ${tag===k?'':'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600'}`}
                    style={tag===k ? {color:v.col,background:v.bg,border:`1.5px solid ${v.col}`} : undefined}>
                    {v.icon} {k}
                  </button>
                ))}

                <div className="w-px h-3.5 bg-slate-200 dark:bg-slate-600 mx-0.5"/>

                {/* Page tabs + add page */}
                <div className="flex items-center gap-0.5">
                  {pages.map(pg => (
                    <button key={pg}
                      onClick={() => { if (!saved) doSave(); setPage(pg); }}
                      className={`text-[11px] sm:text-[9px] font-bold w-8 h-8 sm:w-6 sm:h-6 rounded-md transition-all hover:border-slate-400 flex-shrink-0 ${page===pg?'bg-slate-800 dark:bg-blue-500 text-white border border-slate-800 dark:border-blue-500':'text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600'}`}>
                      {pg}
                    </button>
                  ))}
                  <button onClick={addPage}
                    title="Add new page"
                    aria-label="Add new page"
                    className="w-8 h-8 sm:w-6 sm:h-6 rounded-md text-[11px] sm:text-[9px] font-bold text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 flex items-center justify-center ml-0.5 flex-shrink-0 transition-all">
                    +
                  </button>
                </div>

                <div className="w-px h-3.5 bg-slate-200 dark:bg-slate-600 mx-0.5"/>

                {/* Save indicator */}
                {saved
                  ? <span className="text-[8px] text-emerald-500 dark:text-emerald-400 font-semibold">✓ {wordCount}w</span>
                  : <button onClick={() => doSave()} className="text-[9px] bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1 rounded-lg font-bold transition-colors">Save</button>
                }
              </div>
            </div>

            {/* A4 sheet (paper styling stays consistent; dark mode gets a dark paper) */}
            <div className="bg-white dark:bg-slate-800 relative" style={{minHeight:'75vh'}}>
              <textarea
                key={`${sel}||${selSub||''}||${page}`}
                value={draft}
                onChange={e => { setDraft(e.target.value); setSaved(false); }}
                onBlur={() => { if (!saved) doSave(); }}
                placeholder={selSub
                  ? `Notes for ${sel} › ${selSub}${page>1?` · Page ${page}`:''}…`
                  : `Notes for ${sel}${page>1?` · Page ${page}`:''}…`}
                className="w-full bg-transparent focus:outline-none resize-none placeholder-slate-300 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100"
                style={{
                  minHeight:'75vh',
                  fontSize:'14.5px',
                  fontFamily:"'Georgia','Times New Roman',serif",
                  lineHeight:'1.85',
                  padding:'36px 52px 48px 52px',
                  caretColor:'#3b82f6',
                  display:'block',
                }}
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────

const MARKET_TILES = [
  {key:'NIFTY',     label:'Nifty 50',      icon:'📈', col:'#3b82f6', curr:'₹', flag:'🇮🇳'},
  {key:'BANKNIFTY', label:'Bank Nifty',     icon:'🏦', col:'#8b5cf6', curr:'₹', flag:'🇮🇳'},
  {key:'MIDCAP',    label:'Midcap 100',     icon:'📊', col:'#10b981', curr:'₹', flag:'🇮🇳'},
  {key:'SMALLCAP',  label:'Smallcap 100',   icon:'📉', col:'#f59e0b', curr:'₹', flag:'🇮🇳'},
  {key:'NASDAQ',    label:'NASDAQ',         icon:'💹', col:'#6366f1', curr:'$', flag:'🇺🇸'},
  {key:'GOLD',      label:'Gold /10g',      icon:'🥇', col:'#d97706', curr:'₹', flag:'🏅'},
  {key:'SILVER',    label:'Silver /kg',     icon:'🥈', col:'#64748b', curr:'₹', flag:'🏅'},
];

// ── INDEX TILE + PINNED NOTE ──
// Tile shows index price + change. Below it, an inline note slot the user
// can pin (saved per-index to notebook_store.pinned_index_notes).
function IndexTile({tile, data, marketLoading, fmtPrice, note, onSaveNote}: any) {
  const pos = !data || data.change >= 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note || '');
  useEffect(() => { setDraft(note || ''); }, [note]);
  const save = () => { onSaveNote(draft.trim()); setEditing(false); };
  const remove = () => { onSaveNote(''); setEditing(false); };
  const noteCol = pos ? '#16a34a' : '#dc2626';
  return (
    <div
      style={{background:`linear-gradient(135deg,${tile.col}10,${tile.col}05)`,border:`1px solid ${tile.col}20`}}
      className="rounded-2xl p-2.5 transition-all hover:shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm leading-none">{tile.icon}</span>
          <span className="text-[10px] sm:text-[7px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wide truncate leading-tight">{tile.label}</span>
        </div>
        <button onClick={()=>setEditing(true)} title="Pin a note to this index" className="text-[10px] text-slate-300 hover:text-amber-500 transition-colors leading-none">📌</button>
      </div>
      {data ? (
        <>
          <div className="text-[14px] sm:text-[12px] font-black text-slate-800 dark:text-slate-100 font-mono leading-tight">{fmtPrice(data.price, tile.curr)}</div>
          <div className={`text-[11px] sm:text-[9px] font-bold font-mono mt-0.5 ${pos?'text-emerald-600':'text-red-500'}`}>
            {pos?'▲ +':'▼ '}{Math.abs(data.change).toFixed(2)}%
          </div>
        </>
      ) : (
        <div className="text-[10px] text-slate-300 mt-2">
          {marketLoading ? <span className="animate-pulse">Loading…</span> : '—'}
        </div>
      )}
      {/* Pinned note (or editor) */}
      {(note || editing) && (
        editing ? (
          <div className="mt-1.5 pt-1.5" style={{borderTop:`1px dashed ${tile.col}40`}}>
            <textarea
              autoFocus value={draft} rows={2}
              onChange={(e)=>setDraft(e.target.value)}
              onKeyDown={(e)=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();save();} if(e.key==='Escape') setEditing(false); }}
              placeholder="Pin a note…"
              style={{borderColor: `${tile.col}50`}}
              className="w-full bg-white dark:bg-slate-900 border rounded-lg px-1.5 py-1 text-[10px] text-slate-700 dark:text-slate-200 focus:outline-none resize-none"/>
            <div className="flex justify-between mt-1">
              <button onClick={remove} className="text-[8px] text-red-400 hover:text-red-600">{note?'Remove':'Cancel'}</button>
              <button onClick={save} style={{background:tile.col}} className="text-[9px] text-white font-bold px-2 py-[2px] rounded">Pin ✓</button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setEditing(true)} className="block w-full text-left mt-1.5 pt-1.5" style={{borderTop:`1px dashed ${tile.col}40`}}>
            <div style={{color:noteCol}} className="text-[9px] font-medium leading-snug line-clamp-2">📌 {note}</div>
          </button>
        )
      )}
    </div>
  );
}

// ── THEME TOGGLE ──
function ThemeToggle({mode, onToggle}: {mode: 'light'|'dark'; onToggle: () => void}) {
  return (
    <button onClick={onToggle} title={`Switch to ${mode==='dark'?'light':'dark'} mode`}
      className="flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition-all border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white">
      <span className="text-[12px] leading-none">{mode==='dark'?'☀':'☾'}</span>
      <span className="hidden sm:inline">{mode==='dark'?'Light':'Dark'}</span>
    </button>
  );
}

function DashboardView({stocks, wl, marketData, marketLoading, onRefreshMarket, indexNotes, onSaveIndexNote, onSelectStock}: any) {
  const liveQuotes = useContext(QuoteContext);
  const all = Object.values(stocks).filter((s: any)=>!s.arc) as any[];
  const arc = Object.values(stocks).filter((s: any)=>s.arc).length;
  const bySect = useMemo(()=>{ const m: any={}; all.forEach(s=>{m[s.sector]=(m[s.sector]||0)+1;}); return Object.entries(m).sort((a: any,b: any)=>b[1]-a[1]); },[all]);
  // Count per tab via `wl` (the same watchlist-by-tab membership the tab
  // strip badges and "Watchlist Overview" grid below both use), NOT via
  // each stock's own `src` array — those two data shapes can legitimately
  // diverge for a stock duplicated to a second tab (src stays fixed at
  // creation-order tabs; wl reflects live tab membership), and counting
  // via src made this chart disagree with what you'd actually see if you
  // opened that tab. Counting via wl keeps every "count per tab" display
  // in the app consistent with each other and with observable reality.
  const bySrc  = useMemo(()=>{
    const m: any={};
    TABS.forEach(t=>{
      const c=(wl[t]||[]).filter((id:string)=>stocks[id]&&!stocks[id].arc).length;
      if (c>0) m[TAB_FULL[t]||t]=c;
    });
    return Object.entries(m).sort((a: any,b: any)=>b[1]-a[1]);
  },[wl,stocks]);
  const bySt   = useMemo(()=>{ const m: any={}; all.forEach(s=>{m[s.st]=(m[s.st]||0)+1;}); return Object.entries(m).sort((a: any,b: any)=>b[1]-a[1]); },[all]);
  const hc = all.filter((s:any)=>(Object.values(s.sc) as number[]).reduce((a:number,b:number)=>a+b,0)>25||s.st==='High Conviction');
  const recentNotes = useMemo(()=>{ const ns: any[]=[]; all.forEach(s=>s.notes.forEach((n: any)=>ns.push({...n,sn:s.name,sid:s.id}))); return ns.sort((a,b)=>b.id.localeCompare(a.id)).slice(0,5); },[all]);
  const Bar = ({label,count,max,col='#3b82f6'}: any) => (
    <div className="flex items-center gap-2">
      <div className="text-[11px] text-slate-600 dark:text-slate-300 w-20 sm:w-28 truncate font-medium">{label}</div>
      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div style={{width:`${count/max*100}%`,background:col,transition:'width 0.8s ease'}} className="h-full rounded-full"/>
      </div>
      <div className="text-[10px] text-slate-500 w-4 text-right font-bold">{count}</div>
    </div>
  );
  const mx1=(bySect[0] as any)?.[1]||1, mx2=(bySrc[0] as any)?.[1]||1;
  const fmtPrice = (p: number, curr: string) => curr==='$' ? `$${p.toLocaleString('en-US',{maximumFractionDigits:0})}` : `₹${p.toLocaleString('en-IN',{maximumFractionDigits:0})}`;
  const lastUpdated = marketData?.fetchedAt ? new Date(marketData.fetchedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}) : null;

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* ── MARKET TILES (live from market_indices) ── */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Market Overview</div>
            {lastUpdated && <span className="text-[10px] sm:text-[8px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-[2px] rounded-full">Updated {lastUpdated} IST</span>}
          </div>
          <button onClick={onRefreshMarket} disabled={marketLoading}
            title="Refresh from market_indices table"
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-600 disabled:opacity-40 transition-colors border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg hover:border-blue-300 bg-white dark:bg-slate-800">
            <span className={marketLoading?'animate-spin':''}>{marketLoading?'↻':'↻'}</span>
            <span>{marketLoading?'Fetching…':'Refresh'}</span>
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {MARKET_TILES.map(tile => (
            <IndexTile key={tile.key} tile={tile} data={marketData?.prices?.[tile.key]} marketLoading={marketLoading} fmtPrice={fmtPrice} note={indexNotes?.[tile.key]} onSaveNote={(txt: string)=>onSaveIndexNote(tile.key, txt)}/>
          ))}
        </div>
      </div>

      {/* ── HIGH CONVICTION BANNER ── */}
      <div className="grid grid-cols-1 gap-4">

        {/* High Conviction Ideas */}
        <div style={{background:'linear-gradient(135deg,rgba(99,102,241,0.10),rgba(139,92,246,0.06))',border:'1px solid rgba(99,102,241,0.22)',backdropFilter:'blur(12px)'}} className="rounded-3xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}} className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-base shadow-md">⭐</div>
              <div>
                <div className="text-[11px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">High Conviction</div>
                <div className="text-[9px] text-slate-500">{hc.length} idea{hc.length!==1?'s':''} · Click to open</div>
              </div>
            </div>
            <span style={{color:'#6366f1',background:'rgba(99,102,241,0.10)',border:'1px solid rgba(99,102,241,0.25)'}} className="text-[10px] font-bold px-2 py-1 rounded-full">{hc.length}</span>
          </div>
          {!hc.length && <div className="text-slate-400 text-xs text-center py-4">Score stocks to build conviction list</div>}
          <div className="space-y-2">
            {hc.slice(0,5).map((s:any)=>{
              const tot=Math.round((Object.values(s.sc) as number[]).reduce((a:number,b:number)=>a+b,0)/5*10);
              const lq = liveQuotes?.[s.name];
              const kd = lq ? { px: lq.price, chg: lq.day_pct } : DEMO_QUOTE_FALLBACK[s.name];
              return (
                <button key={s.id} onClick={()=>onSelectStock(s.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-2xl transition-all hover:scale-[1.01] group bg-white/70 dark:bg-slate-800/60 border border-indigo-500/10 dark:border-indigo-400/15 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <div style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}} className="w-1.5 h-6 rounded-full flex-shrink-0"/>
                    <div className="min-w-0 text-left">
                      <div className="text-[12px] text-slate-800 dark:text-slate-100 font-bold truncate">{s.name}</div>
                      <div className="text-[9px] text-slate-400 dark:text-slate-500">{s.sector}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {kd && <div className={`text-[10px] font-bold font-mono ${kd.chg>=0?'text-emerald-500':'text-red-500'}`}>{kd.chg>=0?'+':''}{kd.chg.toFixed(2)}%</div>}
                    {kd && <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono">₹{kd.px.toLocaleString('en-IN')}</div>}
                    {tot>0&&<Ring score={tot} sz={28}/>}
                    <Badge st={s.st} sm/>
                  </div>
                </button>
              );
            })}
            {hc.length>5 && <div className="text-[10px] text-center text-slate-400 pt-1">+{hc.length-5} more in watchlist</div>}
          </div>
        </div>

      </div>

      {/* ── REST OF DASHBOARD ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="text-[9px] text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-3 font-bold">By Sector</div>
          <div className="space-y-2">{bySect.map(([s,c]:any)=><Bar key={s} label={s} count={c} max={mx1} col="#3b82f6"/>)}{!bySect.length&&<div className="text-[11px] text-slate-400">No stocks yet</div>}</div>
        </div>
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="text-[9px] text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-3 font-bold">By Time Frame</div>
          <div className="space-y-2">{bySrc.map(([s,c]:any)=><Bar key={s} label={s} count={c} max={mx2} col="#8b5cf6"/>)}{!bySrc.length&&<div className="text-[11px] text-slate-400">No sources</div>}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="text-[9px] text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-3 font-bold">By Watch Status</div>
          <div className="space-y-2">{bySt.map(([st,c]:any)=>{ const m=SM[st]||SM['New Idea']; return (<div key={st} className="flex items-center justify-between py-0.5"><div className="flex items-center gap-2"><div style={{background:m.c}} className="w-2 h-2 rounded-full"/><span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">{st}</span></div><span style={{color:m.c}} className="text-xs font-bold">{c as number}</span></div>); })}{!bySt.length&&<div className="text-[11px] text-slate-400">No stocks</div>}</div>
        </div>
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="text-[9px] text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-3 font-bold">✎ Recent Research Notes</div>
          <div className="space-y-2">{!recentNotes.length&&<div className="text-[11px] text-slate-400">No notes yet</div>}{recentNotes.map(n=>(<div key={n.id} className="py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 rounded-xl px-1 transition-colors border-b border-slate-50 dark:border-slate-700/50" onClick={()=>onSelectStock(n.sid)}><div className="flex items-center gap-2 mb-0.5"><span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">{n.sn}</span><span className="text-[9px] text-slate-400">{n.date}</span></div><p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-1">{n.txt}</p></div>))}</div>
        </div>
      </div>
      <div className="rounded-2xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="text-[9px] text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-3 font-bold">Watchlist Overview</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {TABS.map((t,i)=>{ const c=(wl[t]||[]).filter(id=>stocks[id]&&!stocks[id].arc).length; const g=['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#f97316'][i%8]; return(<div key={t} style={{background:`${g}12`,border:`1px solid ${g}30`}} className="text-center p-2.5 rounded-2xl" title={TAB_FULL[t]||t}><div style={{color:g}} className="text-base font-black">{c}</div><div className="text-[8px] text-slate-500 mt-0.5 truncate font-mono font-medium">{t}</div></div>); })}
        </div>
      </div>
    </div>
  );
}
// ─── ARCHIVE VIEW ─────────────────────────────────────────────────────────

function ArchiveView({stocks, onRestore, onSel}) {
  const arc = (Object.values(stocks) as any[]).filter((s:any)=>s.arc);
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-xl shadow-sm">🗄️</div>
        <div><div className="text-slate-800 font-bold">Archive</div><div className="text-slate-400 text-xs">{arc.length} archived stock{arc.length!==1?'s':''}</div></div>
      </div>
      {arc.length===0 ? <div className="text-center text-slate-400 py-16 text-sm">No archived stocks</div> : (
        <div className="space-y-2">
          {arc.map(s=>(
            <div key={s.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3"><div><div className="text-sm text-slate-800 font-semibold">{s.name}</div><div className="text-[10px] text-slate-400">{s.sector} · {s.cap}</div></div><Badge st={s.st} sm/></div>
              <div className="flex items-center gap-2">
                <button onClick={()=>onSel(s.id)} className="text-xs text-slate-400 hover:text-slate-700 transition-colors font-medium">View</button>
                <button onClick={()=>onRestore(s.id)} className="text-[11px] px-2.5 py-1 rounded-xl transition-colors bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 font-semibold">Restore</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────

function Sidebar({view, setView, onTabSel, activeTab, stocks, wl, col, setCol, watchItems, onRemoveWatch, onAddWatch, onWatchClick, onChangePass}) {
  const allCnt  = (Object.values(stocks) as any[]).filter((s:any)=>!s.arc).length;
  const arcCnt  = (Object.values(stocks) as any[]).filter((s:any)=>s.arc).length;
  const [wrExpand, setWrExpand] = useState(true);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string|null>(null);
  const NAV = [
    {id:'dashboard', l:'Dashboard',   e:'◈', isActive:view==='dashboard', action:()=>setView('dashboard')},
    {id:'watchlist', l:'Watchlist',   e:'◉', isActive:view==='watchlist', action:()=>setView('watchlist')},
    {id:'sectors',   l:'Sectors',     e:'📒', isActive:view==='sectors',   action:()=>setView('sectors')},
  ];
  return (
    <div className={`${col?'w-[52px]':'w-56'} flex-shrink-0 flex flex-col transition-all duration-300 overflow-hidden shadow-sm bg-white dark:bg-slate-900 border-r-2 border-slate-200 dark:border-slate-800`}>
      {/* Logo / header */}
      {col ? (
        <div className="flex flex-col items-center gap-2 py-3.5 flex-shrink-0 border-b border-slate-100 dark:border-slate-800">
          <div style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}} className="w-7 h-7 rounded-xl flex items-center justify-center shadow-md shadow-blue-200 dark:shadow-blue-900/40">
            <span className="text-white text-xs font-black">N</span>
          </div>
          <button onClick={()=>setCol(false)} title="Expand sidebar" aria-label="Expand sidebar"
            className="w-11 h-11 sm:w-8 sm:h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-base transition-colors">»</button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-3.5 py-4 flex-shrink-0 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-sky-50 to-white dark:from-slate-900 dark:to-slate-900">
          <div style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}} className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-200 dark:shadow-blue-900/40">
            <span className="text-white text-xs font-black">N</span>
          </div>
          <div className="flex-1 min-w-0"><div className="text-[11px] font-bold text-slate-800 dark:text-slate-100 leading-tight">Stock Idea</div><div className="text-[8px] text-slate-400 dark:text-slate-500 tracking-widest uppercase">Notebook</div></div>
          <button onClick={()=>setCol(true)} title="Collapse sidebar" aria-label="Collapse sidebar" className="w-9 h-9 sm:w-auto sm:h-auto rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-base sm:text-sm flex-shrink-0 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">‹</button>
        </div>
      )}
      {/* Nav */}
      <nav className="p-2 space-y-0.5 flex-shrink-0">
        {NAV.map(x=>(
          <button key={x.id} onClick={x.action}
            className={`w-full flex items-center ${col?'justify-center px-1.5':'gap-2.5 px-2.5'} py-2 rounded-xl transition-all ${x.isActive?'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 shadow-sm':'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>
            <span className="text-sm flex-shrink-0">{x.e}</span>
            {!col&&<span className="text-[12px] font-semibold flex-1">{x.l}</span>}
          </button>
        ))}
      </nav>
      {/* Scrollable lower section */}
      {!col && (
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <div className="text-[10px] sm:text-[8px] text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2.5 pt-4 pb-1.5 font-bold">Time Frame</div>
          {TABS.filter(t=>t!=='USA').map((t,i)=>{
            const cnt=(wl[t]||[]).filter(id=>stocks[id]&&!stocks[id].arc).length;
            const act=view==='watchlist'&&activeTab===t;
            const cols=['#3b82f6','#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#f97316'];
            const c=cols[i%cols.length];
            return (
              <button key={t} onClick={()=>onTabSel(t)} title={TAB_FULL[t]||t}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all"
                style={act?{background:`${c}12`,color:c,border:`1px solid ${c}25`}:{color:'#94a3b8'}}>
                <div style={{background:act?c:'#e2e8f0'}} className="w-1.5 h-1.5 rounded-full flex-shrink-0"/>
                <span className="text-[11px] flex-1 text-left font-mono font-medium">{t.toUpperCase()}</span>
                <span className={`text-[9px] font-bold ${act?'':'text-slate-400'}`}>{cnt}</span>
              </button>
            );
          })}
          {/* Watch Radar */}
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between px-2.5 mb-2">
              <button onClick={()=>setWrExpand(!wrExpand)} className="flex items-center gap-1.5 flex-1">
                <span className="text-[9px] font-bold tracking-widest uppercase" style={{background:'linear-gradient(to right,#6366f1,#0ea5e9)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>📡 Watch Radar</span>
                <span className="text-[8px] text-slate-400 ml-0.5">{wrExpand?'▼':'▶'}</span>
                <span className="text-[8px] text-slate-400 ml-auto bg-slate-100 dark:bg-slate-800 px-1.5 py-[1px] rounded-full">{watchItems.length}</span>
              </button>
              <button onClick={onAddWatch} aria-label="Add to Watch Radar" className="w-7 h-7 sm:w-5 sm:h-5 rounded-lg flex items-center justify-center text-white text-sm sm:text-xs font-bold ml-1.5 transition-all hover:scale-105" style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}}>+</button>
            </div>
            {wrExpand && (
              <div className="space-y-1.5">
                {watchItems.length===0 && (<div className="text-center text-slate-400 text-[9px] py-3 px-2">No stocks on radar.<br/>Click + to add.</div>)}
                {watchItems.map(wi=>{
                  const wt = WATCH_TAGS.filter(t=>wi.tags.includes(t.id));
                  return (
                    <div key={wi.id} onClick={()=>onWatchClick(wi)}
                      className="px-2.5 py-2 rounded-2xl cursor-pointer hover:shadow-sm transition-all group bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-500/40">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] text-slate-700 dark:text-slate-200 font-semibold truncate flex-1 leading-tight">{wi.name}</div>
                        <button onClick={e=>{e.stopPropagation(); setConfirmRemoveId(wi.id);}} aria-label={`Remove ${wi.name} from Watch Radar`}
                          className="w-6 h-6 flex items-center justify-center text-[14px] text-slate-300 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 transition-all ml-1 flex-shrink-0 leading-none">×</button>
                      </div>
                      {wt.length>0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {wt.map(t=>(
                            <span key={t.id} style={{color:t.col,background:t.bg,border:`1px solid ${t.col}30`}} className="text-[8px] px-1.5 py-[2px] rounded-full font-semibold">
                              {t.icon} {t.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {wi.note && <div className="text-[9px] text-slate-400 mt-1 truncate">{wi.note}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {!col && (
        <div className="p-3 flex-shrink-0 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between"><span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">{allCnt} ideas · {arcCnt} archived</span><button onClick={onChangePass} title="Change Password" className="text-[10px] text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">🔑</button></div>
        </div>
      )}
      {confirmRemoveId && (
        <ConfirmModal
          message={`Remove "${watchItems.find((w:any)=>w.id===confirmRemoveId)?.name}" from Watch Radar permanently?`}
          onConfirm={()=>{onRemoveWatch(confirmRemoveId);setConfirmRemoveId(null);}}
          onCancel={()=>setConfirmRemoveId(null)}
        />
      )}
    </div>
  );
}

// ─── DATA — sbGet / sbSet are now imported from @/lib/data ────────

// ─── CHANGE PASSWORD MODAL ────────────────────────────────────────────────

function ChangePasswordModal({onSave, onClose}) {
  const [step, setStep]             = useState(1);
  const [master, setMaster]         = useState('');
  const [newPass, setNewPass]       = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showM, setShowM]           = useState(false);
  const [showN, setShowN]           = useState(false);
  const [err, setErr]               = useState('');
  const [busy, setBusy]             = useState(false);

  const verifyMaster = async () => {
    setBusy(true);
    try {
      const { ok } = await verifyMasterPassword(master);
      if (ok) { setStep(2); setErr(''); }
      else { setErr('Incorrect master password'); setTimeout(()=>setErr(''),1800); }
    } catch { setErr('Network error — try again'); setTimeout(()=>setErr(''),1800); }
    setBusy(false);
  };
  const savePass = async () => {
    if (!newPass.trim()) { setErr('Password cannot be empty'); return; }
    if (newPass !== confirmPass) { setErr('Passwords do not match'); return; }
    setBusy(true);
    try {
      const { ok } = await changeNotebookPassword(master, newPass.trim());
      if (ok) onSave(newPass.trim());
      else { setErr('Could not save — try again'); setTimeout(()=>setErr(''),1800); }
    } catch { setErr('Network error — try again'); setTimeout(()=>setErr(''),1800); }
    setBusy(false);
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{background:'rgba(10,10,10,0.7)',backdropFilter:'blur(12px)'}}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl bg-white border border-slate-200">
        <div className="px-5 py-4 flex items-center justify-between" style={{background:'linear-gradient(to right,#f8fafc,#fff)',borderBottom:'1px solid #f1f5f9'}}>
          <div>
            <div className="font-bold text-slate-800 text-sm">🔑 Change Password</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{step===1?'Enter master password to continue':'Set your new notebook password'}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 text-lg transition-colors w-10 h-10 sm:w-auto sm:h-auto flex items-center justify-center -mr-2 sm:m-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {step === 1 ? (
            <>
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Master Password</div>
              <div className="relative">
                <input type={showM?'text':'password'} value={master}
                  onChange={e=>{setMaster(e.target.value);setErr('');}}
                  onKeyDown={e=>e.key==='Enter'&&verifyMaster()}
                  placeholder="Enter master password…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400"/>
                <button onClick={()=>setShowM(!showM)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{showM?'🙈':'👁'}</button>
              </div>
              {err && <div className="text-[11px] text-red-500 text-center">{err}</div>}
              <button onClick={verifyMaster} disabled={!master||busy}
                style={master?{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}:{}}
                className="w-full py-2.5 rounded-xl text-white font-bold text-sm disabled:bg-slate-200 disabled:opacity-50 hover:opacity-90 transition-all">
                {busy?'Verifying…':'Verify →'}
              </button>
            </>
          ) : (
            <>
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">New Password</div>
              <div className="relative">
                <input type={showN?'text':'password'} value={newPass}
                  onChange={e=>{setNewPass(e.target.value);setErr('');}}
                  placeholder="New password…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400"/>
                <button onClick={()=>setShowN(!showN)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{showN?'🙈':'👁'}</button>
              </div>
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Confirm Password</div>
              <input type="password" value={confirmPass}
                onChange={e=>{setConfirmPass(e.target.value);setErr('');}}
                onKeyDown={e=>e.key==='Enter'&&savePass()}
                placeholder="Confirm new password…"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400"/>
              {err && <div className="text-[11px] text-red-500 text-center">{err}</div>}
              {newPass && confirmPass && newPass===confirmPass && (
                <div className="text-[11px] text-emerald-600 text-center font-semibold">✓ Passwords match</div>
              )}
              <button onClick={savePass} disabled={!newPass||!confirmPass||busy}
                style={newPass&&confirmPass?{background:'linear-gradient(135deg,#22c55e,#16a34a)'}:{}}
                className="w-full py-2.5 rounded-xl text-white font-bold text-sm disabled:bg-slate-200 disabled:opacity-50 hover:opacity-90 transition-all">
                {busy?'Saving…':'Save New Password ✓'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CEREBRUM LOGIN ───────────────────────────────────────────────────────

function CerebrumLogin({onUnlock}) {
  const [pw, setPw]       = useState('');
  const [show, setShow]   = useState(false);
  const [err, setErr]     = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [checking, setChecking] = useState(false);

  const tryUnlock = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const { ok } = await loginWithPassword(pw);
      if (ok) {
        setErr(false);
        setUnlocking(true);
        setTimeout(()=> onUnlock(), 2400);
      } else {
        setErr(true);
        setTimeout(()=>setErr(false), 1500);
      }
    } catch {
      setErr(true);
      setTimeout(()=>setErr(false), 1500);
    }
    setChecking(false);
  };

  // Unlock animation overlay
  if (unlocking) return (
    <div style={{position:'fixed',inset:0,zIndex:9999,background:'#0a0a0a',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:"'Georgia',serif"}}>
      <style>{`
        @keyframes chartRise { 0%{transform:scaleY(0);opacity:0} 30%{transform:scaleY(0.3);opacity:0.6} 60%{transform:scaleY(0.7);opacity:0.9} 100%{transform:scaleY(1);opacity:1} }
        @keyframes fadeUp { 0%{opacity:0;transform:translateY(30px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 20px rgba(212,175,55,0.3)} 50%{box-shadow:0 0 60px rgba(212,175,55,0.6)} }
        @keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        .chart-bar { transform-origin:bottom; animation:chartRise 1.8s ease-out forwards; }
        .welcome-text { animation:fadeUp 0.8s ease-out 1.4s both; }
        .brain-glow { animation:glow 1.5s ease-in-out infinite; }
      `}</style>
      {/* Rising chart bars */}
      <div style={{display:'flex',alignItems:'flex-end',gap:6,height:140,marginBottom:40}}>
        {[35,55,42,70,58,85,65,95,78,110,92,125,105,135].map((h,i)=>(
          <div key={i} className="chart-bar"
            style={{width:8,height:h,borderRadius:4,
              background:`linear-gradient(180deg,#d4af37,#b8860b)`,
              animationDelay:`${i*0.1}s`,opacity:0}}/>
        ))}
      </div>
      {/* Brain icon */}
      <div className="brain-glow" style={{width:60,height:60,borderRadius:16,background:'linear-gradient(135deg,#d4af37,#b8860b)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,marginBottom:16}}>🧠</div>
      {/* Welcome text */}
      <div className="welcome-text" style={{color:'#d4af37',fontSize:28,fontWeight:900,letterSpacing:4,textTransform:'uppercase'}}>CEREBRUM</div>
      <div className="welcome-text" style={{color:'rgba(212,175,55,0.6)',fontSize:12,letterSpacing:8,textTransform:'uppercase',marginTop:8,animationDelay:'1.6s'}}>UNLOCKED</div>
    </div>
  );

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Georgia','Times New Roman',serif",overflow:'hidden'}}>
      <style>{`
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes fadeIn { 0%{opacity:0;transform:scale(0.95) translateY(20px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes particleFloat { 0%{transform:translateY(100vh) scale(0);opacity:0} 50%{opacity:0.8} 100%{transform:translateY(-10vh) scale(1);opacity:0} }
        .cerebrum-card { animation:fadeIn 0.8s ease-out both; }
        .logo-float { animation:float 4s ease-in-out infinite; }
        .btn-shimmer { background-size:200% 100%; animation:shimmer 3s linear infinite; }
        .shake { animation:shake 0.4s ease-in-out; }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
        @keyframes ecgDraw { 0%{stroke-dashoffset:480} 65%{stroke-dashoffset:0} 100%{stroke-dashoffset:0} }
        @keyframes ecgFade { 0%,100%{opacity:0.15} 8%{opacity:0.85} 60%{opacity:0.85} 72%{opacity:0.15} }
        .ecg-path { stroke-dasharray:480; animation:ecgDraw 2.6s ease-in-out infinite, ecgFade 2.6s ease-in-out infinite; }
      `}</style>

      {/* Dark bg with particles */}
      <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 30% 80%, #1a1206 0%, #0a0a0a 50%, #0d0d0d 100%)'}}>
        {/* Gold particles */}
        {Array.from({length:30}).map((_,i)=>(
          <div key={i} style={{
            position:'absolute',
            left:`${Math.random()*100}%`,
            bottom:'-10px',
            width: Math.random()*4+2,
            height: Math.random()*4+2,
            borderRadius:'50%',
            background:`rgba(212,175,55,${Math.random()*0.5+0.2})`,
            animation:`particleFloat ${Math.random()*8+6}s linear ${Math.random()*5}s infinite`,
          }}/>
        ))}
        {/* Candlestick chart silhouette top-right — shrinks on narrow phones so it never overflows the card */}
        <svg viewBox="0 0 400 200" style={{position:'absolute',top:20,right:20,width:'clamp(140px, 38vw, 260px)',opacity:0.12,pointerEvents:'none'}}>
          {[30,60,90,120,150,180,210,240,270,300,330,360].map((x,i)=>{
            const h=Math.random()*80+40, y=Math.random()*60+20;
            return <g key={i}><line x1={x} y1={y} x2={x} y2={y+h} stroke="#d4af37" strokeWidth="2"/><rect x={x-5} y={y+h*0.3} width="10" height={h*0.4} fill="#d4af37" rx="1"/></g>;
          })}
        </svg>
      </div>

      {/* Glass card — responsive: tighter padding + smaller side gutters on narrow phones */}
      <div className="cerebrum-card" style={{
        position:'relative',zIndex:10,
        width:'100%',maxWidth:420,margin:'0 12px',
        padding:'clamp(24px, 6vw, 40px) clamp(18px, 5vw, 32px) clamp(20px, 5vw, 32px)',
        borderRadius:20,
        background:'rgba(20,18,12,0.65)',
        backdropFilter:'blur(24px) saturate(140%)',
        border:'1px solid rgba(212,175,55,0.25)',
        boxShadow:'0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(212,175,55,0.15)',
      }}>
        {/* Brain logo, with a live ECG/uptrend chart line running behind it */}
        <div className="logo-float" style={{textAlign:'center',marginBottom:24,position:'relative'}}>
          <svg viewBox="0 0 220 90" style={{position:'absolute',top:'50%',left:'50%',width:230,height:94,transform:'translate(-50%,-50%)',pointerEvents:'none'}}>
            <defs>
              <linearGradient id="ecgGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#d4af37"/>
                <stop offset="55%" stopColor="#22c55e"/>
                <stop offset="100%" stopColor="#4ade80"/>
              </linearGradient>
              <filter id="ecgGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <path className="ecg-path" d="M0,68 L18,66 L34,71 L48,58 L60,63 L70,36 L80,80 L90,6 L100,57 L116,44 L134,51 L154,26 L174,35 L194,12 L220,3"
              fill="none" stroke="url(#ecgGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#ecgGlow)"/>
          </svg>
          <div style={{position:'relative',zIndex:1,display:'inline-flex',alignItems:'center',justifyContent:'center',width:72,height:72,borderRadius:18,background:'linear-gradient(135deg,#d4af37,#b8860b)',boxShadow:'0 8px 32px rgba(212,175,55,0.3)',fontSize:36}}>🧠</div>
        </div>

        {/* Title */}
        <div style={{textAlign:'center',marginBottom:8}}>
          <div style={{color:'#e8dcc8',fontSize:'clamp(24px, 7vw, 32px)',fontWeight:900,letterSpacing:'clamp(3px, 1.2vw, 6px)',textTransform:'uppercase',textShadow:'0 2px 8px rgba(0,0,0,0.5)'}}>CEREBRUM</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:4}}>
            <div style={{width:40,height:1,background:'linear-gradient(90deg,transparent,#d4af37)'}}/>
            <span style={{color:'#d4af37',fontSize:12,letterSpacing:4,textTransform:'uppercase',fontWeight:600}}>LOGIC 🤝 WEALTH</span>
            <div style={{width:40,height:1,background:'linear-gradient(90deg,#d4af37,transparent)'}}/>
          </div>
          <div style={{color:'#d4af37',fontSize:10,marginTop:8,opacity:0.5}}>◇</div>
        </div>

        {/* Quote */}
        <div style={{textAlign:'center',margin:'24px 0',padding:'0 8px'}}>
          <div style={{color:'#c4b28a',fontSize:16,fontStyle:'italic',lineHeight:1.6,textShadow:'0 1px 4px rgba(0,0,0,0.3)'}}>
            "Price is what you pay.<br/>Value is what you get."
          </div>
          <div style={{color:'rgba(212,175,55,0.6)',fontSize:13,fontStyle:'italic',marginTop:8}}>— Warren Buffett</div>
        </div>

        {/* Password field */}
        <div style={{position:'relative',marginBottom:16}}>
          <div style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(212,175,55,0.5)',fontSize:14}}>🔒</div>
          <input
            type={show?'text':'password'}
            value={pw}
            onChange={e=>{setPw(e.target.value);setErr(false);}}
            onKeyDown={e=>e.key==='Enter'&&tryUnlock()}
            placeholder="Enter Password"
            className={err?'shake':''}
            style={{
              width:'100%',
              padding:'14px 44px 14px 40px',
              borderRadius:12,
              border: err ? '1.5px solid #ef4444' : '1px solid rgba(212,175,55,0.3)',
              background:'rgba(10,10,10,0.6)',
              color:'#e8dcc8',
              fontSize:14,
              fontFamily:'inherit',
              outline:'none',
              transition:'border 0.3s',
            }}
          />
          <button onClick={()=>setShow(!show)} aria-label={show?'Hide password':'Show password'} style={{position:'absolute',right:4,top:'50%',transform:'translateY(-50%)',color:'rgba(212,175,55,0.5)',fontSize:14,background:'none',border:'none',cursor:'pointer',width:44,height:44,display:'flex',alignItems:'center',justifyContent:'center'}}>
            {show?'🙈':'👁'}
          </button>
        </div>
        {err && <div style={{color:'#ef4444',fontSize:11,textAlign:'center',marginBottom:8,fontFamily:'sans-serif'}}>Incorrect password</div>}

        {/* Unlock button */}
        <button onClick={tryUnlock}
          className="btn-shimmer"
          style={{
            width:'100%',
            padding:'14px 0',
            borderRadius:12,
            border:'none',
            background:'linear-gradient(90deg,#b8860b,#d4af37,#f0d060,#d4af37,#b8860b)',
            color:'#1a1206',
            fontSize:14,
            fontWeight:900,
            letterSpacing:3,
            textTransform:'uppercase',
            cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',gap:10,
            fontFamily:'inherit',
            boxShadow:'0 4px 20px rgba(212,175,55,0.3)',
            transition:'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e=>{const t=e.currentTarget;t.style.transform='translateY(-1px)';t.style.boxShadow='0 6px 28px rgba(212,175,55,0.45)';}}
          onMouseLeave={e=>{const t=e.currentTarget;t.style.transform='translateY(0)';t.style.boxShadow='0 4px 20px rgba(212,175,55,0.3)';}}
        >
          UNLOCK CEREBRUM <span style={{fontSize:16}}>→</span>
        </button>

        {/* Bottom brain divider */}
        <div style={{textAlign:'center',marginTop:20,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          <div style={{width:40,height:1,background:'linear-gradient(90deg,transparent,rgba(212,175,55,0.25))'}}/>
          <span style={{fontSize:14,opacity:0.4}}>🧠</span>
          <div style={{width:40,height:1,background:'linear-gradient(90deg,rgba(212,175,55,0.25),transparent)'}}/>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────

export default function StockIdeaNotebook() {
  // Persist unlock across page refreshes within the same browser tab/session —
  // only the password itself gates real access (checked server-side), this
  // is purely a "don't make me re-type it on every reload" convenience.
  const [authed, setAuthed]         = useState(() => {
    try { return sessionStorage.getItem('cerebrum_authed') === '1'; } catch { return false; }
  });
  const [loaded, setLoaded]         = useState(false);
  const [passLoaded, setPassLoaded]   = useState(false);
  const [marketData, setMarketData]   = useState<any>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [showChangePass, setShowChangePass] = useState(false);
  const [stocks, setStocks] = useState<any>(IS);
  const [wl, setWl] = useState<any>(IW);
  const [watchItems, setWatchItems] = useState<any>(INIT_WATCH);
  const [ipoList, setIpoList]       = useState<any>(INIT_IPO);
  const [sectorNotes, setSectorNotes] = useState<any>({});
  const [sectorTags,  setSectorTags]  = useState<any>({});
  const [activeTab, setActiveTab] = useState('Short');
  const [view, setView] = useState<string>('dashboard');
  const [selId, setSelId] = useState<string|null>(null);
  const [coll, setColl] = useState<any>({});
  const [sectFil, setSectFil] = useState('All');
  const [subSectQ, setSubSectQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAddWatch, setShowAddWatch] = useState(false);
  const [sideCol, setSideCol] = useState(false);
  const [mobMenu, setMobMenu] = useState(false);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | saving | saved | error
  // New live-data slices (populated by netlify/functions/market-sync-background)
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [indexNotes, setIndexNotes] = useState<Record<string, string>>({});
  const [themeMode, setThemeMode] = useState<'light'|'dark'>('light');

  // ── PRE-AUTH: load password + theme + light market cache ──
  useEffect(()=>{
    const preload = async () => {
      try {
        const theme = await sbGet('theme_mode');
        if (theme === 'dark' || theme === 'light') {
          setThemeMode(theme);
          try { document.documentElement.classList.toggle('dark', theme === 'dark'); localStorage.setItem('cerebrum_theme', theme); } catch {}
        } else {
          try {
            const local = localStorage.getItem('cerebrum_theme');
            if (local === 'dark' || local === 'light') {
              setThemeMode(local as any);
              document.documentElement.classList.toggle('dark', local === 'dark');
            }
          } catch {}
        }
      } catch {}
      setPassLoaded(true);
    };
    preload();
  },[]);

  // ── LOAD from Netlify DB on mount ──
  useEffect(()=>{
    const load = async () => {
      try {
        const [sData, wData, wiData, ipoData, snData, stData, notesData] = await Promise.all([
          sbGet('stocks'), sbGet('watchlists'), sbGet('watch_radar'), sbGet('ipo_list'),
          sbGet('sector_notes'), sbGet('sector_tags'), sbGet('pinned_index_notes'),
        ]);
        if (sData && Object.keys(sData).length > 0) setStocks(sData);
        if (wData && Object.keys(wData).length > 0) setWl(wData);
        if (Array.isArray(wiData) && wiData.length > 0) setWatchItems(wiData);
        if (Array.isArray(ipoData) && ipoData.length > 0) setIpoList(ipoData);
        if (snData && typeof snData === 'object') setSectorNotes(snData);
        if (stData && typeof stData === 'object') setSectorTags(stData);
        if (notesData && typeof notesData === 'object') setIndexNotes(notesData);
      } catch {}
      setLoaded(true);
    };
    load();
  },[]);

  // ── LIVE MARKET DATA: pull from Netlify DB tables (no auth gating) ──
  useEffect(()=>{
    const loadMarket = async () => {
      try {
        const [sparks, qts] = await Promise.all([fetchSparklines(), fetchQuotes()]);
        setSparklines(sparks);
        setQuotes(qts);
      } catch {}
    };
    loadMarket();
  },[]);

  // ── SAVE to Netlify DB (debounced 800ms) ──
  // Also flushes immediately (bypassing the 800ms debounce) the moment the
  // tab is hidden/closed/refreshed — otherwise a change made right before a
  // refresh (e.g. deleting a Watch Radar item, then reloading out of habit)
  // can be lost: the debounce timer never fires, so the old pre-change data
  // is still what's in the DB, and reloading brings that stale state back
  // ("delete doesn't stick").
  useEffect(()=>{
    if (!loaded) return;
    setSyncStatus('saving');
    const flush = () => Promise.all([
      sbSet('stocks', stocks), sbSet('watchlists', wl), sbSet('watch_radar', watchItems),
      sbSet('ipo_list', ipoList), sbSet('sector_notes', sectorNotes), sbSet('sector_tags', sectorTags),
    ]);
    const t = setTimeout(async()=>{
      try {
        await flush();
        setSyncStatus('saved');
        setTimeout(()=>setSyncStatus('idle'), 2000);
      } catch { setSyncStatus('error'); }
    }, 800);
    const onHide = () => { if (document.visibilityState === 'hidden') flush().catch(()=>{}); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return ()=>{
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  },[stocks, wl, watchItems, ipoList, sectorNotes, sectorTags, loaded]);

  // ── Market data refresh (re-reads market_indices) ──
  const refreshMarket = async () => {
    if (marketLoading) return;
    setMarketLoading(true);
    try {
      const [data, qts] = await Promise.all([fetchMarketPrices(), fetchQuotes()]);
      if (data?.prices) setMarketData(data);
      setQuotes(qts);
    } catch {}
    setMarketLoading(false);
  };

  // Manual "Refresh" button on the Dashboard — unlike the passive auto-load
  // refresh above, this also kicks off a real market-sync-background run
  // (there's no automatic schedule; this is the only way a sync happens)
  // before re-reading the DB. Note: the sync itself can take a while, and
  // its writes may take a while longer to become readable — clicking this
  // won't show new numbers instantly, but it does queue a real sync.
  const manualRefreshMarket = async () => {
    triggerSync().catch(()=>{});
    await refreshMarket();
  };

  // Auto-refresh on load
  useEffect(()=>{
    if (!loaded) return;
    refreshMarket();
  },[loaded]);

  // Password change already persisted server-side by ChangePasswordModal via /api/auth.
  const savePassword = () => {
    setShowChangePass(false);
  };

  // Theme toggle persistence
  const toggleTheme = () => {
    const next = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    try {
      document.documentElement.classList.toggle('dark', next === 'dark');
      localStorage.setItem('cerebrum_theme', next);
    } catch {}
    sbSet('theme_mode', next).catch(()=>{});
  };

  // Pinned index notes
  const saveIndexNote = (key: string, text: string) => {
    setIndexNotes((p) => {
      const next = { ...p };
      if (text.trim()) next[key] = text.trim(); else delete next[key];
      sbSet('pinned_index_notes', next).catch(()=>{});
      return next;
    });
  };

  const saveSectorNote = (sector: string, text: string) => setSectorNotes((p: any)=>({...p,[sector]:text}));
  const saveSectorTag  = (sector: string, tag: string|null)  => setSectorTags((p: any)=>({...p,[sector]:tag}));

  useEffect(()=>{
    const h=(e: KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();setShowSearch(true);}};
    window.addEventListener('keydown',h); return()=>window.removeEventListener('keydown',h);
  },[]);

  const addStock    = (id: string, data: any, tab: string) => {
    setStocks((p: any)=>({...p,[id]:data}));
    setWl((p: any)=>({...p,[tab]:Array.from(new Set([...(p[tab]||[]),id]))}));
    // Fetch this stock's live quote + news from indianapi.in right away
    // instead of waiting for the next scheduled sync. MF isn't a tradeable
    // ticker on the stock API, so skip it (matches the sync's own filter).
    if (data?.kind !== 'MF' && data?.name) fetchOneStockNow(data.name).catch(()=>{});
  };
  const updStock    = (id: string, u: any)        => setStocks((p: any)=>({...p,[id]:{...p[id],...u}}));
  const delStock    = (id: string)          => { setStocks((p: any)=>{ const n={...p}; delete n[id]; return n; }); setWl((p: any)=>{ const n: any={}; TABS.forEach(t=>{n[t]=(p[t]||[]).filter((x: string)=>x!==id);}); return n; }); if(selId===id) setSelId(null); };
  const arcStock    = (id: string)          => { updStock(id,{arc:true}); if(selId===id) setSelId(null); };
  const restStock   = (id: string)          => updStock(id,{arc:false});
  const moveStock   = (id: string, toTab: string)    => { setWl((p: any)=>{ const n: any={}; TABS.forEach(t=>{n[t]=(p[t]||[]).filter((x: string)=>x!==id);}); n[toTab]=[...(n[toTab]||[]),id]; return n; }); updStock(id,{src:[toTab]}); setActiveTab(toTab); };
  const dupStock    = (id: string, toTab: string)    => { setWl((p: any)=>({...p,[toTab]:Array.from(new Set([...(p[toTab]||[]),id]))})); setStocks((p: any)=>({...p,[id]:{...p[id],src:Array.from(new Set([...p[id].src,toTab]))}})); };

  const addWatchItem    = (item: any) => setWatchItems((p: any)=>[...p,item]);
  const removeWatchItem = (id: string)   => setWatchItems((p: any)=>p.filter((x: any)=>x.id!==id));

  const addIpo          = (ipo: any)  => setIpoList((p: any)=>[ipo,...p]);
  const deleteIpo       = (id: string)   => setIpoList((p: any)=>p.filter((x: any)=>x.id!==id));
  const updateIpoSignal = (id: string, signal: string) => setIpoList((p: any)=>p.map((x: any)=>x.id===id?{...x,signal}:x));
  const handleWatchClick = (wi: any) => {
    const found: any = Object.values(stocks).find((s: any)=>s.name===wi.name&&!s.arc);
    if (found) { const t=TABS.find(t=>(wl[t]||[]).includes(found.id)); if(t){setActiveTab(t);navTo('watchlist');} setSelId(found.id); }
    if (mobMenu) setMobMenu(false);
  };

  const navTo  = (v: string) => { setView(v); if(v!=='watchlist') setSelId(null); };
  const tabSel = (t: string) => { setView('watchlist'); setActiveTab(t); setSectFil('All'); setSubSectQ(''); setSelId(null); setMobMenu(false); };

  const sel = selId ? stocks[selId] : null;
  const tabIds = wl[activeTab]||[];
  const tabStocks: any[] = tabIds.filter((id: string)=>stocks[id]&&!stocks[id].arc).map((id: string)=>stocks[id]);

  const bySect = useMemo(()=>{
    let filt = sectFil==='All' ? tabStocks : tabStocks.filter((s: any)=>s.sector===sectFil);
    if (subSectQ.trim()) { const qq=subSectQ.toLowerCase(); filt=filt.filter((s: any)=>(s.subSector||'').toLowerCase().includes(qq)); }
    const g: any = {}; filt.forEach((s: any)=>{ if(!g[s.sector])g[s.sector]=[]; g[s.sector].push(s); });
    return g;
  },[tabStocks,sectFil,subSectQ]);

  const sectOpts = useMemo(()=>['All',...Array.from(new Set(tabStocks.map((s: any)=>s.sector)))],[tabStocks]);

  // ── AUTH GATE ──
  if (!passLoaded) return (
    <div style={{background:'#0a0a0a',position:'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:32,height:32,borderRadius:'50%',border:'3px solid rgba(212,175,55,0.3)',borderTopColor:'#d4af37'}} className="animate-spin"/>
    </div>
  );
  if (!authed) return <CerebrumLogin onUnlock={()=>{ try { sessionStorage.setItem('cerebrum_authed','1'); } catch {} setAuthed(true); }}/>;

  if (!loaded) return (
    <div style={{background:'#f8fafc'}} className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-3 border-blue-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" style={{borderWidth:'3px'}}/>
        <div className="text-slate-400 text-xs font-medium">Loading notebook…</div>
      </div>
    </div>
  );

  const sidebarProps = { view, setView:navTo, onTabSel:tabSel, activeTab, stocks, wl, col:sideCol, setCol:setSideCol, watchItems, onRemoveWatch:removeWatchItem, onAddWatch:()=>setShowAddWatch(true), onWatchClick:handleWatchClick, onChangePass:()=>setShowChangePass(true) };

  return (
    <QuoteContext.Provider value={quotes}>
    <SparkContext.Provider value={sparklines}>
    <div className="h-screen overflow-hidden text-slate-800 dark:text-slate-100 flex bg-slate-100 dark:bg-slate-950">
      <div className="hidden md:flex"><Sidebar {...sidebarProps}/></div>
      {mobMenu && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <Sidebar {...sidebarProps} col={false} setCol={()=>{}}/>
          <div className="flex-1 bg-slate-900/40 backdrop-blur-sm" onClick={()=>setMobMenu(false)}/>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
          <button onClick={()=>setMobMenu(true)} aria-label="Open menu" className="md:hidden text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mr-1 text-xl leading-none transition-colors w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 -ml-2">☰</button>
          <div className="flex-1 min-w-0">
            {view==='watchlist'&&activeTab!=='IPO'&&<div className="flex items-center gap-1.5 text-[12px] truncate"><span className="hidden sm:inline text-slate-400 dark:text-slate-500">Notebook</span><span className="hidden sm:inline text-slate-300 dark:text-slate-600">/</span><span className="text-slate-800 dark:text-slate-100 font-bold font-mono">{activeTab.toUpperCase()}</span><span className="text-slate-300 dark:text-slate-600 mx-1">·</span><span className="hidden sm:inline text-slate-500 dark:text-slate-400">{TAB_FULL[activeTab]||activeTab}</span><span className="hidden sm:inline text-slate-300 dark:text-slate-600 mx-1">·</span><span className="text-slate-400 dark:text-slate-500">{tabStocks.length} {activeTab==='MF'?'funds':activeTab==='ETF'?'ETFs':'stocks'}</span></div>}
            {view==='watchlist'&&activeTab==='IPO'&&<div className="flex items-center gap-1.5 text-[12px] truncate"><span className="hidden sm:inline text-slate-400 dark:text-slate-500">Notebook</span><span className="hidden sm:inline text-slate-300 dark:text-slate-600">/</span><span className="text-amber-600 dark:text-amber-400 font-bold">🏷 IPO Watch</span><span className="text-slate-300 dark:text-slate-600 mx-1">·</span><span className="text-slate-400 dark:text-slate-500">{ipoList.length} IPOs</span></div>}
            {view==='dashboard'&&<div className="text-sm font-bold text-slate-800 dark:text-slate-100">Dashboard</div>}

          </div>
          <ThemeToggle mode={themeMode} onToggle={toggleTheme}/>
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-400/25">
            <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-300">🟢 Live</span>
            <span className="text-[8px] text-emerald-500 dark:text-emerald-400">NSE via indianapi.in</span>
          </div>
          {/* Netlify DB sync indicator */}
          <div className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-bold transition-all ${
            syncStatus==='saved' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-400/30 text-emerald-600 dark:text-emerald-300' :
            syncStatus==='saving' ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-400/30 text-blue-600 dark:text-blue-300' :
            syncStatus==='error' ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-400/30 text-red-600 dark:text-red-300' :
            'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
          }`}>
            {syncStatus==='saving'&&<span className="animate-spin text-[8px]">↻</span>}
            {syncStatus==='saved'&&'✓'}
            {syncStatus==='error'&&'✗'}
            {syncStatus==='idle'&&'☁'}
            <span>{syncStatus==='saving'?'Saving…':syncStatus==='saved'?'Saved':syncStatus==='error'?'Sync Error':'Netlify DB'}</span>
          </div>
          <button onClick={()=>setShowSearch(true)} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 text-[11px] transition-colors bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700">
            🔍<span className="hidden sm:inline font-medium">Search</span><span className="hidden sm:inline text-[9px] text-slate-400 dark:text-slate-400 bg-slate-200 dark:bg-slate-700 px-1 py-[2px] rounded font-mono">⌘K</span>
          </button>
          {view==='watchlist' && activeTab!=='IPO' && (
            <button onClick={()=>setShowAdd(true)} style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)',boxShadow:'0 2px 8px rgba(59,130,246,0.35)'}} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-white text-[11px] font-bold hover:opacity-90 transition-opacity">
              + Add Stock
            </button>
          )}
        </div>

        {/* Expert tab strip */}
        {view==='watchlist'&&(
          <div className="flex items-center overflow-x-auto flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
        {/* Expert tabs */}
            {TABS.filter(t=>t!=='USA').map((t,i)=>{
              const isIPO = t === 'IPO';
              const isETF = t === 'ETF';
              const isMF  = t === 'MF';
              const cols=['#3b82f6','#6366f1','#10b981','#f59e0b','#0ea5e9','#a855f7','#ef4444','#8b5cf6'];
              const c = isIPO ? '#f59e0b' : isETF ? '#0ea5e9' : isMF ? '#a855f7' : cols[i%cols.length];
              const cnt = isIPO ? ipoList.length : (wl[t]||[]).filter(id=>stocks[id]&&!stocks[id].arc).length;
              const act = activeTab===t&&view==='watchlist';
              // All labels in UPPERCASE; special tabs keep their icon prefix.
              const label = isIPO ? '🏷 IPO' : isETF ? '📈 ETF' : isMF ? '💼 MF' : t.toUpperCase();
              return (
                <button key={t} onClick={()=>tabSel(t)} title={TAB_FULL[t]||t}
                  style={act?{borderBottom:`2px solid ${c}`,color:c,background:`${c}06`}:{borderBottom:'2px solid transparent'}}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-bold transition-all hover:text-slate-600 dark:hover:text-slate-300 ${act?'':'text-slate-400 dark:text-slate-500'} ${isIPO||isETF||isMF?'':'font-mono'}`}>
                  {label}
                  <span style={act?{background:`${c}20`,color:c}:undefined} className={`text-[9px] px-1.5 py-[2px] rounded-full font-bold ${act?'':'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-400'}`}>{cnt}</span>
                </button>
              );
            })}
            {/* USA tab — always last */}
            {(()=>{
              const c='#f97316';
              const cnt=(wl['USA']||[]).filter(id=>stocks[id]&&!stocks[id].arc).length;
              const act=activeTab==='USA'&&view==='watchlist';
              return (
                <button onClick={()=>tabSel('USA')} title="US Market"
                  style={act?{borderBottom:`2px solid ${c}`,color:c,background:`${c}06`}:{borderBottom:'2px solid transparent'}}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-bold transition-all hover:text-orange-500 font-mono ${act?'':'text-slate-400 dark:text-slate-500'}`}>
                  🌎 USA
                  <span style={act?{background:`${c}20`,color:c}:undefined} className={`text-[9px] px-1.5 py-[2px] rounded-full font-bold ${act?'':'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-400'}`}>{cnt}</span>
                </button>
              );
            })()}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {view==='sectors'&&<div className="flex-1 overflow-hidden"><SectorsView sectorNotes={sectorNotes} sectorTags={sectorTags} onSave={saveSectorNote} onTag={saveSectorTag}/></div>}
          {view==='dashboard'&&<div className="p-4 md:p-6 pb-10"><DashboardView stocks={stocks} wl={wl} marketData={marketData} marketLoading={marketLoading} onRefreshMarket={manualRefreshMarket} indexNotes={indexNotes} onSaveIndexNote={saveIndexNote} onSelectStock={(id: string)=>{setSelId(id);navTo('watchlist');const t=TABS.find(t=>(wl[t]||[]).includes(id));if(t)setActiveTab(t);}}/></div>}
          {view==='watchlist' && activeTab==='IPO' && <IpoView ipoList={ipoList} onAdd={addIpo} onDelete={deleteIpo} onUpdateSignal={updateIpoSignal}/>}
          {view==='watchlist' && activeTab!=='IPO' && (
            <div className="p-4 pb-10">
              <div className="mb-4 space-y-2">
                {sectOpts.length>2&&(
                  <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest flex-shrink-0 font-semibold">Sector</span>
                    {sectOpts.map(s=>(
                      <button key={s} onClick={()=>setSectFil(s)}
                        className={`flex-shrink-0 text-[10px] px-3 py-0.5 rounded-full transition-all hover:border-blue-200 hover:text-blue-500 font-medium ${sectFil===s?'border-2 border-blue-500 bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 shadow-[0_1px_4px_rgba(59,130,246,0.2)]':'border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-400 bg-white dark:bg-slate-800'}`}>{s}</button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest flex-shrink-0 font-semibold">Sub-Sector</span>
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-violet-400 text-[10px]">🔍</span>
                    <input value={subSectQ} onChange={e=>setSubSectQ(e.target.value)}
                      placeholder="Filter by sub-sector…"
                      className="w-full pl-7 pr-3 py-1 text-[11px] bg-white dark:bg-slate-800 border border-violet-200 dark:border-violet-400/30 rounded-full text-slate-700 dark:text-slate-200 placeholder-violet-300 dark:placeholder-violet-500/70 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-500/20 font-medium"/>
                    {subSectQ && <button onClick={()=>setSubSectQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-violet-400 hover:text-violet-600 text-xs leading-none">×</button>}
                  </div>
                  {subSectQ && (
                    <span className="text-[9px] text-violet-500 dark:text-violet-300 font-semibold bg-violet-50 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-400/25 px-2 py-0.5 rounded-full">{subSectQ}</span>
                  )}
                </div>
              </div>
              {tabStocks.length===0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-100 to-violet-100 dark:from-blue-500/15 dark:to-violet-500/15 flex items-center justify-center text-3xl">📋</div>
                  <div className="text-slate-500 dark:text-slate-400 text-sm text-center">No stocks in <span className="text-blue-600 dark:text-blue-400 font-bold font-mono">{activeTab}</span> <span className="text-slate-400 dark:text-slate-500">({TAB_FULL[activeTab]})</span></div>
                  <button onClick={()=>setShowAdd(true)} style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)',boxShadow:'0 4px 12px rgba(59,130,246,0.35)'}} className="text-sm text-white px-6 py-2.5 rounded-2xl font-bold hover:opacity-90 transition-opacity">+ Add First Stock</button>
                </div>
              ) : (
                Object.entries(bySect).map(([sector,ss])=>(
                  <SectorGroup key={sector} sector={sector} stocks={ss} onSelect={setSelId} selId={selId}
                    collapsed={coll[sector]||false} onToggle={()=>setColl(p=>({...p,[sector]:!p[sector]}))}/>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {sel&&(
        <>
          <div className="fixed inset-0 z-40 sm:hidden bg-slate-900/40 backdrop-blur-sm" onClick={()=>setSelId(null)}/>
          <DetailPanel stock={sel} onClose={()=>setSelId(null)} upd={(u: any)=>updStock(sel.id,u)} onMove={moveStock} onDup={dupStock} onArc={arcStock} onDel={delStock}/>
        </>
      )}

      {showAdd      && <AddStockModal activeTab={activeTab} stocks={stocks} onAdd={addStock} onClose={()=>setShowAdd(false)}/>}
      {showAddWatch && <AddWatchModal onAdd={addWatchItem} onClose={()=>setShowAddWatch(false)}/>}
      {showChangePass && <ChangePasswordModal onSave={savePassword} onClose={()=>setShowChangePass(false)}/>}
      {showSearch   && <GlobalSearch stocks={stocks} onClose={()=>setShowSearch(false)} onSel={(id: string)=>{ setSelId(id); setShowSearch(false); const t=TABS.find(t=>(wl[t]||[]).includes(id)); if(t){setActiveTab(t);navTo('watchlist');} }}/>}
    </div>
    </SparkContext.Provider>
    </QuoteContext.Provider>
  );
}
